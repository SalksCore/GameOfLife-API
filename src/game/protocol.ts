/**
 * Protocole temps réel GameOfLife (V2).
 * Ce fichier est la RÉFÉRENCE : PHONE et ADMIN en ont une copie (src/protocol.ts).
 * Toute modification ici doit être reportée dans les deux clients.
 *
 * L'exposé entier est une suite d'étapes (« deck ») pilotée par la régie, comme un diaporama :
 * diapositives, sondages, tirage des familles, années de jeu, bac, vote, Parcoursup, emploi, pyramide…
 * Pendant une année, chaque joueur répartit son temps (jetons) et prend une décision.
 */

/** lobby = salle d'attente · playing = exposé lancé · ended = exposé terminé */
export type Phase = 'lobby' | 'playing' | 'ended';
export type ChatChannel = 'all' | 'system';

export const LIMITS = {
  roomNameMin: 3,
  roomNameMax: 40,
  chatMax: 300,
  maxPlayersMin: 2,
  maxPlayersMax: 100,
  codeLength: 6,
  yearSecondsMin: 30,
  yearSecondsMax: 150,
  giveMax: 1_000_000,
  slideTitleMax: 120,
  slideTextMax: 400,
  slideBulletsMax: 8,
  notesMax: 1_500,
  wishesMax: 5,
  cardsMax: 60,
} as const;

/** Alphabet des codes de partie : sans caractères ambigus (0/O, 1/I/L) */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Normalise une saisie utilisateur : majuscules, sans espaces ni tirets */
export const normalizeCode = (input: string) => input.toUpperCase().replace(/[\s-]/g, '');

// ================================================================= Classes sociales

export type SocialClass = 'populaire' | 'moyenne' | 'superieure';
export const SOCIAL_CLASSES: readonly SocialClass[] = ['populaire', 'moyenne', 'superieure'];
export const CLASS_LABELS: Record<SocialClass, string> = {
  populaire: 'Classe populaire',
  moyenne: 'Classe moyenne',
  superieure: 'Classe supérieure',
};
export const CLASS_SHORT: Record<SocialClass, string> = { populaire: 'Populaire', moyenne: 'Moyenne', superieure: 'Supérieure' };

/** Répartition des familles au tirage (préréglages de la régie) */
export type Distribution = 'realiste' | 'equilibre' | 'inegal';
export const DISTRIBUTIONS: Record<Distribution, { label: string; weights: Record<SocialClass, number> }> = {
  realiste: { label: 'Retenue (35 / 40 / 25)', weights: { populaire: 35, moyenne: 40, superieure: 25 } },
  equilibre: { label: 'Équilibrée (⅓ chacune)', weights: { populaire: 1, moyenne: 1, superieure: 1 } },
  inegal: { label: 'Très inégalitaire (55 / 35 / 10)', weights: { populaire: 55, moyenne: 35, superieure: 10 } },
};

export interface GameConfig {
  /** Durée d'une année de jeu, en secondes (30 à 90) */
  yearSeconds: number;
  distribution: Distribution;
  /** Effet adresse à l'embauche (malus 0,04 pour le lycée de quartier) */
  addressEffect: boolean;
}
export const DEFAULT_GAME_CONFIG: GameConfig = { yearSeconds: 90, distribution: 'realiste', addressEffect: true };

export type Stage = 'lycee' | 'etudes' | 'travail';
export const STAGES: readonly Stage[] = ['lycee', 'etudes', 'travail'];
export const STAGE_LABELS: Record<Stage, string> = { lycee: 'Lycée', etudes: 'Études', travail: 'Vie active' };

export type Tone = 'good' | 'bad' | 'neutral';

// ================================================================= Contenus de l'exposé

export interface SlideContent {
  title: string;
  subtitle: string;
  bullets: string[];
  /** Notes de l'orateur (visibles seulement dans la régie) */
  notes: string;
}

/** Carte « Le saviez-vous » : un chiffre publié et sa source */
export interface FactCard {
  id: string;
  title: string;
  figure: string;
  text: string;
  source: string;
  /** Moment de l'exposé où la lancer */
  moment: string;
  link: string;
}

export type StepKind =
  | 'slide'
  | 'poll'
  | 'pollCompare'
  | 'draw'
  | 'year'
  | 'bac'
  | 'vote'
  | 'parcoursup'
  | 'parcoursupResults'
  | 'parcoursupFinal'
  | 'diploma'
  | 'jobs'
  | 'final'
  | 'stats'
  | 'debrief';

/** Étape du diaporama. Les étapes de jeu ne peuvent être ni supprimées ni déplacées. */
export interface DeckStep {
  id: string;
  kind: StepKind;
  /** Année de jeu, sondage… selon le type */
  ref: string | null;
  enabled: boolean;
  slide: SlideContent;
  /** Orateur (A narrateur, B expert) */
  who: string;
  /** Cartes suggérées pour l'étape */
  cards: string[];
  /** Durée prévue, en secondes (budget de l'exposé) */
  plan: number;
}

/** Contenus modifiables depuis le panneau (diaporama et cartes) */
export interface ExposeContent {
  steps: Record<string, { enabled: boolean; slide: SlideContent }>;
  cards: FactCard[];
}

// ================================================================= Joueur (téléphone)

export interface OptionView {
  id: string;
  emoji: string;
  label: string;
  /** Indication courte : coût, effet, risque… */
  hint: string;
  /** Raison du blocage, ou null si accessible */
  locked: string | null;
}

export interface TokenCategory {
  id: string;
  emoji: string;
  label: string;
  hint: string;
}

/** Élément du parcours : titre obtenu, porte ouverte, porte fermée, coup du sort */
export interface PathItem {
  year: string;
  kind: 'title' | 'open' | 'close' | 'event' | 'choice';
  text: string;
  /** Identifiant stable de la décision (indépendant du libellé affiché) ; absent des anciennes parties. */
  action?: string;
}

export interface ReportLine {
  emoji: string;
  text: string;
  tone: Tone;
}

/** Carte de famille, découverte au tirage */
export interface FamilyCard {
  parents: string;
  grade: number;
  contacts: number;
  budget: number;
  school: string;
  informed: boolean;
  /** Efficacité de l'aide aux devoirs (0,8 / 1 / 1,2) */
  help: number;
  /** Part des études payée par la famille (0 / 50 / 100 %) */
  support: number;
  /** Don à l'entrée dans la vie active */
  gift: number;
  forced: string | null;
}

export interface CharacterView {
  origin: SocialClass;
  /** Partenaire de binôme (nom), le cas échéant */
  partner: string | null;
  school: { name: string; reputation: number };
  status: string;
  stats: {
    /** Moyenne générale /20 */
    grade: number;
    contacts: number;
    /** Énergie 0-5 */
    energy: number;
    budget: number;
    engagement: number;
  };
  family: FamilyCard;
  boursier: boolean;
  diploma: string | null;
  job: string | null;
  /** Trajectoire estimée par rapport à la classe d'origine */
  trend: 'up' | 'flat' | 'down';
  path: PathItem[];
}

/** Mini-jeu de l'année (en plus des jetons et de la décision) */
export interface MiniGameView {
  id: string;
  /** cards = situations à trancher · budget = budget du mois · offers = candidatures · wheel = pari */
  kind: 'cards' | 'budget' | 'offers' | 'wheel';
  emoji: string;
  title: string;
  intro: string;
  items: {
    id: string;
    emoji: string;
    title: string;
    text: string;
    options: { id: string; label: string; hint: string; cost: number | null; locked: string | null }[];
  }[];
  /** Candidatures : nombre maximum */
  maxPicks: number | null;
  /** élément -> option choisie (candidatures : liste séparée par des virgules) */
  answers: Record<string, string>;
  budget: { start: number; spent: number } | null;
  done: boolean;
}

export interface YearView {
  id: string;
  label: string;
  stage: Stage;
  /** Numéro de l'année (1 à 7) */
  number: number;
  totalTokens: number;
  /** Jetons imposés (aide à la famille, job obligatoire…) */
  forced: { category: string; count: number; reason: string }[];
  categories: TokenCategory[];
  tokens: Record<string, number>;
  decision: { id: string; emoji: string; title: string; text: string; options: OptionView[]; choice: string | null };
  mini: MiniGameView | null;
  /** open = on joue · report = bulletin affiché */
  phase: 'open' | 'report';
  submitted: boolean;
  /** Bulletin de fin d'année */
  report: { title: string; grade: number; before: number; appreciation: string; lines: ReportLine[] } | null;
}

export interface FormationView {
  id: string;
  label: string;
  emoji: string;
  hint: string;
  selective: boolean;
  capacity: number;
  /** Coût annuel restant à la charge du joueur (avant bourse) */
  cost: number;
  /** Raison pour laquelle le vœu est impossible */
  locked: string | null;
}

export type WishStatus = 'admis' | 'attente' | 'refuse';

export interface ParcoursupView {
  phase: 'wishes' | 'results' | 'final';
  /** Sans bac : pas de Parcoursup */
  eligible: boolean;
  formations: FormationView[];
  /** Formations que le joueur ne voit pas (information inégale) : nombre seulement */
  hidden: number;
  canAskBourse: boolean;
  wishes: string[];
  bourse: boolean;
  submitted: boolean;
  results: { formation: string; label: string; emoji: string; status: WishStatus; rank: number | null }[];
  response: string | null;
  final: { formation: string | null; label: string; emoji: string; text: string } | null;
}

export interface JobsView {
  phase: 'aim' | 'result';
  options: OptionView[];
  choice: string | null;
  employability: number;
  result: { job: string; label: string; text: string; tone: Tone } | null;
}

export interface PollView {
  id: string;
  questions: { question: string; options: string[] }[];
  answers: (number | null)[];
  open: boolean;
}

export interface VoteView {
  options: { id: string; emoji: string; label: string; description: string }[];
  myVote: string | null;
  open: boolean;
  winner: string | null;
}

/** Ce que voit un joueur pendant l'exposé */
export interface PlayerGameView {
  step: { id: string; kind: StepKind; index: number; total: number; title: string; replay: boolean };
  timer: { endsAt: number | null; paused: boolean; remaining: number | null };
  poll: PollView | null;
  vote: VoteView | null;
  character: CharacterView | null;
  year: YearView | null;
  parcoursup: ParcoursupView | null;
  jobs: JobsView | null;
  /** Résultat personnel (bac, diplôme) */
  outcome: { emoji: string; title: string; text: string; tone: Tone } | null;
  final: {
    rank: number;
    total: number;
    origin: SocialClass;
    cls: SocialClass;
    ascending: boolean;
    job: string;
    diploma: string;
    budget: number;
    text: string;
  } | null;
  /** Annonce ponctuelle (argent donné, événement collectif) */
  flash: { id: string; text: string } | null;
}

// ================================================================= Écran projeté

export interface ScreenPlayer {
  id: string;
  displayName: string;
  avatar: string;
  color: string;
  connected: boolean;
  origin: SocialClass;
  /** Validé pour l'étape en cours */
  done: boolean;
  grade: number;
  status: string;
  trend: 'up' | 'flat' | 'down';
  /** Dernier effet marquant (bulle au-dessus de l'avatar) */
  pop: { id: string; text: string; tone: Tone } | null;
}

export interface FinalView {
  pyramid: Record<SocialClass, string[]>;
  matrix: Record<SocialClass, Record<SocialClass, number>>;
  podium: string[];
  ascending: string[];
  climbed: number;
  fell: number;
  stayed: number;
  takeaways: string[];
  /** Étages révélés : 0 à 3 (puis 4 = podium) */
  revealed: number;
}

export interface StatLine {
  label: string;
  /** Valeur (pourcentage ou nombre) par classe d'origine */
  values: Record<SocialClass, number>;
  unit: '%' | '€' | '';
  /** Chiffre réel en regard */
  real: string | null;
}

export type ScreenStep =
  | { kind: 'slide'; slide: SlideContent }
  | {
      kind: 'poll';
      questions: { question: string; options: string[]; counts: number[] | null }[];
      answered: number;
      total: number;
      open: boolean;
    }
  | { kind: 'pollCompare'; items: { question: string; options: string[]; before: number[]; after: number[] }[] }
  | { kind: 'draw'; counts: Record<SocialClass, number>; families: { cls: SocialClass; parents: string; grade: string; budget: string; contacts: number }[] }
  | {
      kind: 'year';
      label: string;
      stage: Stage;
      number: number;
      phase: 'open' | 'report';
      done: number;
      total: number;
      mini: { emoji: string; title: string } | null;
      /** Terminale : joueurs informés des filières sélectives */
      informed: number | null;
      /** Choix de l'année : options et nombre de joueurs (après clôture) */
      choices: { label: string; emoji: string; count: number }[] | null;
      averages: Record<SocialClass, number>;
    }
  | {
      kind: 'bac';
      revealed: boolean;
      results: { label: string; count: number }[];
      successByOrigin: Record<SocialClass, number>;
      mentionByOrigin: Record<SocialClass, number>;
      averageByOrigin: Record<SocialClass, number>;
    }
  | {
      kind: 'vote';
      options: { id: string; emoji: string; label: string; description: string }[];
      counts: number[] | null;
      winner: string | null;
      answered: number;
      total: number;
    }
  | { kind: 'parcoursup'; done: number; total: number; formations: { id: string; label: string; emoji: string; capacity: number; demand: number }[]; bourses: number; hiddenPrepa: number }
  | {
      kind: 'parcoursupResults';
      revealed: boolean;
      done: number;
      total: number;
      formations: { id: string; label: string; emoji: string; capacity: number; admis: number; attente: number; refuse: number }[];
    }
  | {
      kind: 'parcoursupFinal';
      formations: { id: string; label: string; emoji: string; capacity: number; players: string[]; selective: boolean }[];
      vieActive: string[];
      selectiveByOrigin: Record<SocialClass, number>;
    }
  | { kind: 'diploma'; revealed: boolean; results: { label: string; count: number }[]; bac5ByOrigin: Record<SocialClass, number>; levelByOrigin: Record<SocialClass, number> }
  | { kind: 'jobs'; phase: 'aim' | 'result'; revealed: boolean; done: number; total: number; tiers: { id: string; label: string; cls: SocialClass; seats: number | null; players: string[] }[] }
  | { kind: 'final'; final: FinalView }
  | { kind: 'stats'; lines: StatLine[] }
  | { kind: 'debrief'; debrief: DebriefView };

/** Diapositive de débrief : un résultat de la partie, interprété et comparé à la réalité */
export interface DebriefView {
  id: string;
  index: number;
  total: number;
  eyebrow: string;
  title: string;
  question: string;
  charts: {
    label: string;
    unit: '%' | '/20' | '';
    /** Valeur de la partie par classe d'origine (null = personne dans cette classe) */
    game: Record<SocialClass, number | null>;
    /** Valeur réelle en regard, quand elle existe par classe */
    real: Record<SocialClass, number | null> | null;
    max: number;
  }[];
  interpretation: string[];
  reality: { figure: string; text: string; source: string; cards: string[] } | null;
  verdict: string;
  notes: string;
}

export interface ScreenView {
  roomId: string;
  code: string;
  name: string;
  phase: Phase;
  now: number;
  maxPlayers: number;
  lobby: { id: string; displayName: string; avatar: string; color: string; connected: boolean; partner: string | null }[];
  deck: { index: number; total: number; kind: StepKind; title: string; replay: boolean } | null;
  timer: { endsAt: number | null; paused: boolean; remaining: number | null };
  players: ScreenPlayer[];
  show: ScreenStep | null;
  /** Carte « Le saviez-vous » affichée par-dessus la scène */
  card: FactCard | null;
  feed: { id: string; text: string; tone: Tone | 'admin' }[];
}

export interface GameEventInfo {
  id: string;
  emoji: string;
  label: string;
  description: string;
}

/** Joueur vu par la régie */
/** Régie : modification à la main d'un personnage (chaque champ est facultatif) */
export interface PlayerPatch {
  budget?: number;
  grade?: number;
  contacts?: number;
  energy?: number;
  engagement?: number;
  boursier?: boolean;
  info?: boolean;
  cordees?: boolean;
  homeOwner?: boolean;
  school?: 'quartier' | 'centre' | 'prive' | 'elite';
}

export interface ControlPlayer {
  id: string;
  members: string[];
  origin: SocialClass;
  grade: number;
  contacts: number;
  energy: number;
  budget: number;
  status: string;
  done: boolean;
  school: string;
  schoolId: 'quartier' | 'centre' | 'prive' | 'elite';
  boursier: boolean;
  diploma: string | null;
  info: boolean;
  cordees: boolean;
  homeOwner: boolean;
  engagement: number;
  formation: string | null;
  job: string | null;
  bac: string | null;
}

/** Régie : ce que les joueurs ne voient pas */
export interface ControlView {
  config: GameConfig;
  /** Classe imposée avant le tirage au sort (null = aléatoire) */
  roles: Record<string, SocialClass | null>;
  /** Binômes formés : joueur -> partenaire */
  pairs: Record<string, string>;
  deck: { id: string; kind: StepKind; title: string; enabled: boolean; who: string; plan: number; played: boolean }[];
  cursor: number;
  /** Étape la plus avancée déjà jouée */
  furthest: number;
  /** Début de l'exposé (heure serveur) : budget de 25 min */
  startedAt: number | null;
  notes: string;
  /** Peut-on clore l'étape (année, vœux…) / révéler (résultats, sondage) ? */
  canClose: boolean;
  canReveal: boolean;
  /** Libellé de la prochaine révélation : Révéler, Étage suivant, Lecture, Résultats */
  revealLabel: string;
  /** L'étape a une lecture (débrief) disponible */
  lecture: boolean;
  cards: FactCard[];
  stepCards: string[];
  shownCard: string | null;
  characters: ControlPlayer[];
  events: GameEventInfo[];
  reform: string | null;
}

export type DeckAction = 'next' | 'prev' | 'close' | 'reveal' | 'extend' | 'pause' | 'resume' | 'goto';

// ================================================================= Salle

export interface PlayerView {
  id: string;
  displayName: string;
  avatar: string;
  color: string;
  connected: boolean;
}

/** État d'une partie tel que vu par un joueur */
export interface RoomView {
  id: string;
  code: string;
  name: string;
  phase: Phase;
  maxPlayers: number;
  players: PlayerView[];
  startedAt: number | null;
  /** Heure serveur à l'envoi : permet au client de corriger le décalage d'horloge */
  now: number;
  /** Binôme : partenaire, demandes reçues et envoyée */
  pairing: { partnerId: string | null; requestsFrom: string[]; requestedTo: string | null; locked: boolean };
  game: PlayerGameView | null;
}

export interface ChatMessage {
  id: string;
  channel: ChatChannel;
  authorId: string | null;
  author: string;
  text: string;
  at: number;
}

export type Ack<T = undefined> = { ok: true; data: T } | { ok: false; error: string };
export type AckFn<T = undefined> = (res: Ack<T>) => void;

/** Saisie d'un joueur pendant l'exposé */
export type GameInput =
  | { type: 'tokens'; tokens: Record<string, number> }
  | { type: 'decide'; optionId: string }
  | { type: 'mini'; item: string; option: string }
  | { type: 'submit' }
  | { type: 'poll'; question: number; option: number }
  | { type: 'vote'; optionId: string }
  | { type: 'wishes'; wishes: string[]; bourse: boolean; submit: boolean }
  | { type: 'response'; accept: string | null }
  | { type: 'job'; optionId: string };

// ---- Namespace joueurs "/" ----

export interface ClientToServerEvents {
  /** Rejoint une partie grâce à son code (les parties sont créées par un admin) */
  'room:join': (input: { code: string }, cb: AckFn) => void;
  'room:leave': (cb: AckFn) => void;
  /** Binôme : demander, accepter, refuser, se séparer */
  'room:pair': (input: { action: 'request' | 'accept' | 'decline' | 'leave'; playerId: string | null }, cb: AckFn) => void;
  /** Binôme avec le code imprimé sur la fiche du partenaire (même si son téléphone est éteint) */
  'room:pairCode': (input: { code: string }, cb: AckFn) => void;
  'chat:send': (input: { text: string }, cb: AckFn) => void;
  'game:input': (input: GameInput, cb: AckFn) => void;
}

export interface ServerToClientEvents {
  'room:state': (state: RoomView | null) => void;
  'chat:message': (msg: ChatMessage) => void;
  /** Session coupée (connexion ailleurs, expulsion, suspension…) */
  'session:kicked': (reason: string) => void;
  /** Sortie forcée de la partie (partie fermée, expulsion) */
  'room:notice': (message: string) => void;
  /** Le jeu passe en maintenance : le client affiche l'écran de maintenance */
  'server:maintenance': (info: { message: string; endsAt: string | null }) => void;
}

// ---- Namespace "/admin" ----

export interface AdminStats {
  connectedPlayers: number;
  rooms: number;
  gamesInProgress: number;
  uptimeSec: number;
  memoryMb: number;
  maintenance: boolean;
}

export interface AdminRoom {
  id: string;
  code: string;
  name: string;
  phase: Phase;
  maxPlayers: number;
  createdBy: string;
  createdAt: number;
  startedAt: number | null;
  players: { id: string; username: string; displayName: string; avatar: string; color: string; connected: boolean }[];
}

/** Flux temps réel d'une partie suivie par un admin */
export interface LiveRoom {
  roomId: string;
  screen: ScreenView;
  control: ControlView;
  /** Tablettes Stream Deck ouvertes sur cette partie */
  decks?: number;
}

/** Export des chiffres d'une partie (dossier écrit) */
export interface GameExport {
  name: string;
  code: string;
  date: string;
  players: number;
  reform: string | null;
  stats: StatLine[];
  rows: Record<string, string | number>[];
}

export interface AdminClientToServerEvents {
  'admin:rooms': (cb: AckFn<AdminRoom[]>) => void;
  'admin:createRoom': (input: { name: string; maxPlayers: number }, cb: AckFn<{ id: string; code: string }>) => void;
  /** Lance l'exposé (première diapositive) */
  'admin:startRoom': (input: { roomId: string }, cb: AckFn) => void;
  'admin:endRoom': (input: { roomId: string }, cb: AckFn) => void;
  'admin:closeRoom': (input: { roomId: string }, cb: AckFn) => void;
  'admin:kick': (input: { roomId: string; playerId: string }, cb: AckFn) => void;
  /** Suivre une partie en direct (écran + régie) : réponse immédiate puis événements admin:live */
  'admin:watch': (input: { roomId: string; deck?: boolean }, cb: AckFn<LiveRoom>) => void;
  'admin:unwatch': (input: { roomId: string }, cb: AckFn) => void;
  /** Avant le tirage : impose une classe à un joueur (null = tirage au sort) */
  'admin:setRole': (input: { roomId: string; playerId: string; role: SocialClass | null }, cb: AckFn) => void;
  /** Avant le tirage : forme (ou défait, partner = null) un binôme */
  'admin:pair': (input: { roomId: string; playerId: string; partnerId: string | null }, cb: AckFn) => void;
  'admin:configure': (input: { roomId: string; config: Partial<GameConfig> }, cb: AckFn) => void;
  /** Pilotage du diaporama (goto : index d'une étape déjà jouée ou de la suivante) */
  'admin:deck': (input: { roomId: string; action: DeckAction; index?: number }, cb: AckFn) => void;
  /** Affiche (ou retire, cardId = null) une carte « Le saviez-vous » sur l'écran projeté */
  'admin:card': (input: { roomId: string; cardId: string | null }, cb: AckFn) => void;
  /** Donne (ou retire) de l'argent : target = 'all', 'class:<classe>' ou l'id d'un joueur */
  'admin:give': (input: { roomId: string; target: string; amount: number }, cb: AckFn) => void;
  /** Déclenche un événement collectif (crise, héritage, bourse au mérite) */
  'admin:event': (input: { roomId: string; eventId: string }, cb: AckFn) => void;
  /** Modifie à la main un paramètre d'un personnage (argent, moyenne, contacts, énergie, statuts…) */
  'admin:editPlayer': (input: { roomId: string; characterId: string; patch: PlayerPatch }, cb: AckFn) => void;
  'admin:export': (input: { roomId: string }, cb: AckFn<GameExport>) => void;
}

export interface AdminServerToClientEvents {
  'admin:stats': (stats: AdminStats) => void;
  /** Une partie a changé (création, joueur, phase…) : la liste doit être rafraîchie */
  'admin:roomsChanged': () => void;
  'admin:live': (live: LiveRoom) => void;
}
