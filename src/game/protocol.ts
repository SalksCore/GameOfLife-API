/**
 * Protocole temps réel GameOfLife.
 * Ce fichier est la RÉFÉRENCE : PHONE et ADMIN en ont une copie (src/protocol.ts).
 * Toute modification ici doit être reportée dans les deux clients.
 *
 * Le jeu : une vie en 3 étapes (lycée, université, monde du travail). Chaque joueur naît dans une
 * classe sociale et fait des choix à chaque tour ; à la fin, la pyramide sociale montre qui a monté.
 */

/** lobby = salle d'attente · playing = partie lancée · ended = partie terminée */
export type Phase = 'lobby' | 'playing' | 'ended';
export type ChatChannel = 'all' | 'system';

export const LIMITS = {
  roomNameMin: 3,
  roomNameMax: 40,
  chatMax: 300,
  maxPlayersMin: 2,
  maxPlayersMax: 100,
  codeLength: 6,
  stageMinutesMin: 1,
  stageMinutesMax: 10,
  giveMax: 1_000_000,
} as const;

/** Alphabet des codes de partie : sans caractères ambigus (0/O, 1/I/L) */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Normalise une saisie utilisateur : majuscules, sans espaces ni tirets */
export const normalizeCode = (input: string) => input.toUpperCase().replace(/[\s-]/g, '');

// ---------------------------------------------------------------- Jeu

export type SocialClass = 'basse' | 'moyenne' | 'riche';
export const SOCIAL_CLASSES: readonly SocialClass[] = ['basse', 'moyenne', 'riche'];
export const CLASS_LABELS: Record<SocialClass, string> = {
  basse: 'Classe basse',
  moyenne: 'Classe moyenne',
  riche: 'Classe riche',
};

/** Position sociale (0-100) à partir de laquelle on entre dans chaque classe */
export const CLASS_THRESHOLDS = { moyenne: 42, riche: 70 } as const;

export type Stage = 'lycee' | 'universite' | 'travail';
export const STAGES: readonly Stage[] = ['lycee', 'universite', 'travail'];
export const STAGE_LABELS: Record<Stage, string> = {
  lycee: 'Lycée',
  universite: 'Université',
  travail: 'Monde du travail',
};

/** Répartition des classes au tirage au sort (préréglages de la régie) */
export type Distribution = 'realiste' | 'equilibre' | 'inegal';
export const DISTRIBUTIONS: Record<Distribution, { label: string; weights: Record<SocialClass, number> }> = {
  realiste: { label: 'Réaliste (35 / 45 / 20)', weights: { basse: 35, moyenne: 45, riche: 20 } },
  equilibre: { label: 'Équilibrée (⅓ chacune)', weights: { basse: 1, moyenne: 1, riche: 1 } },
  inegal: { label: 'Très inégalitaire (55 / 35 / 10)', weights: { basse: 55, moyenne: 35, riche: 10 } },
};

export interface GameConfig {
  /** Durée de chaque étape (lycée, université, travail) en minutes */
  stageMinutes: number;
  distribution: Distribution;
}
export const DEFAULT_GAME_CONFIG: GameConfig = { stageMinutes: 5, distribution: 'realiste' };

/** Les trois capitaux (Bourdieu) + le moral */
export interface Capitals {
  /** Capital économique, en euros (peut être négatif : dettes) */
  money: number;
  /** Capital culturel : savoirs, notes (0-100) */
  savoir: number;
  /** Capital social : réseau, relations (0-100) */
  reseau: number;
  /** Moral / santé (0-100) : un moral bas fait rater les choix risqués */
  moral: number;
}

/**
 * Déroulé d'une étape (commun à tous) : intro -> play (temps libre) -> milestone (bilan).
 * Pendant « play », chacun joue à son rythme : il va dans les lieux de la scène, lance des activités
 * qui prennent du temps, et reçoit des événements de vie personnels.
 * final = pyramide de fin de partie.
 */
export type GameStep = 'intro' | 'play' | 'milestone' | 'final';
export type Tone = 'good' | 'bad' | 'neutral';

/** Lieu d'une scène : position (en % de l'illustration) où se tiennent les avatars */
export interface PlaceInfo {
  id: string;
  name: string;
  emoji: string;
  /** Point d'ancrage au sol, en % de la largeur et de la hauteur de la scène */
  x: number;
  y: number;
}

/** Les trois scènes (illustrations public/scenes/<étape>.svg, 1600 × 900) */
export const SCENES: Record<Stage, { title: string; places: PlaceInfo[] }> = {
  lycee: {
    title: 'Le lycée',
    places: [
      { id: 'maison', name: 'Maison', emoji: '🏠', x: 7, y: 80 },
      { id: 'classe', name: 'Salle de classe', emoji: '📚', x: 30, y: 78 },
      { id: 'cdi', name: 'CDI', emoji: '📖', x: 49, y: 79 },
      { id: 'cour', name: 'La cour', emoji: '🌳', x: 40, y: 92 },
      { id: 'gymnase', name: 'Gymnase', emoji: '🏀', x: 66, y: 80 },
      { id: 'cantine', name: 'Cantine', emoji: '🍽️', x: 64, y: 93 },
      { id: 'boulot', name: 'Fast-food', emoji: '🍔', x: 88, y: 81 },
    ],
  },
  universite: {
    title: 'Le campus',
    places: [
      { id: 'residence', name: 'Logement', emoji: '🛏️', x: 8, y: 80 },
      { id: 'amphi', name: 'Amphithéâtre', emoji: '🏛️', x: 29, y: 80 },
      { id: 'bu', name: 'Bibliothèque', emoji: '📚', x: 50, y: 80 },
      { id: 'bde', name: 'Bar du BDE', emoji: '🎉', x: 41, y: 93 },
      { id: 'job', name: 'Supermarché', emoji: '🛒', x: 69, y: 81 },
      { id: 'entreprise', name: 'Entreprises', emoji: '🏢', x: 89, y: 80 },
    ],
  },
  travail: {
    title: 'La ville',
    places: [
      { id: 'maison', name: 'Maison', emoji: '🏠', x: 7, y: 81 },
      { id: 'agence', name: 'Pôle emploi', emoji: '📋', x: 23, y: 82 },
      { id: 'usine', name: 'Atelier', emoji: '🏭', x: 39, y: 80 },
      { id: 'bureau', name: 'Bureaux', emoji: '🏙️', x: 57, y: 80 },
      { id: 'banque', name: 'Banque', emoji: '🏦', x: 74, y: 81 },
      { id: 'ecole', name: 'Cours du soir', emoji: '🎓', x: 48, y: 93 },
      { id: 'club', name: 'Club & afterwork', emoji: '🥂', x: 90, y: 82 },
    ],
  },
};

export interface SituationView {
  id: string;
  stage: Stage;
  emoji: string;
  title: string;
  text: string;
}

export interface OptionView {
  id: string;
  emoji: string;
  label: string;
  /** Indication courte : coût, risque… */
  hint: string;
  /** Raison du blocage (pas assez d'argent, de réseau…) ou null si accessible */
  locked: string | null;
}

/** Activité proposée dans un lieu */
export interface ActionView {
  id: string;
  placeId: string;
  emoji: string;
  label: string;
  /** Durée en secondes */
  seconds: number;
  hint: string;
  locked: string | null;
}

export interface ResultView {
  id: string;
  text: string;
  delta: Capitals;
  tone: Tone;
}

/** Ce que voit un joueur pendant la partie */
export interface PlayerGameView {
  stage: Stage;
  stageIndex: number;
  step: GameStep;
  /** Fin de l'étape en cours (heure serveur), null en pause */
  stepEndsAt: number | null;
  paused: boolean;
  me: {
    origin: SocialClass;
    cls: SocialClass;
    /** Position sociale 0-100 */
    score: number;
    capitals: Capitals;
    /** Diplômes et emploi obtenus, dans l'ordre */
    titles: string[];
    /** Lieu où se trouve le joueur */
    place: string;
  };
  /** Texte d'introduction d'étape ou de bilan (personnalisé) */
  story: { title: string; text: string } | null;
  /** Activités de chaque lieu de la scène */
  actions: ActionView[];
  /** Activité en cours */
  activity: { actionId: string; placeId: string; emoji: string; label: string; startedAt: number; endsAt: number } | null;
  /** Événement de vie à traiter (prioritaire) */
  event: { id: string; situation: SituationView; options: OptionView[]; endsAt: number | null; mandatory: boolean } | null;
  /** Derniers résultats (le plus récent en premier) */
  results: ResultView[];
  final: { rank: number; total: number; text: string } | null;
  /** Notification ponctuelle (argent donné par la régie, événement) */
  flash: { text: string } | null;
}

/** Joueur tel qu'affiché sur l'écran projeté */
export interface BoardPlayer {
  id: string;
  displayName: string;
  avatar: string;
  color: string;
  connected: boolean;
  origin: SocialClass;
  cls: SocialClass;
  score: number;
  capitals: Capitals;
  /** Dernier titre obtenu (bac, diplôme, emploi) */
  title: string | null;
  place: string;
  activity: { emoji: string; label: string; endsAt: number } | null;
  /** Un événement attend sa réponse */
  busy: boolean;
  /** Dernier gain, affiché au-dessus de l'avatar */
  pop: { id: string; text: string; tone: Tone } | null;
  /** Évolution récente */
  trend: 'up' | 'down' | null;
}

export interface FeedItem {
  id: string;
  at: number;
  text: string;
  tone: Tone | 'admin';
}

export interface FinalView {
  /** Joueurs de chaque classe finale, du meilleur au moins bon score */
  pyramid: Record<SocialClass, string[]>;
  /** matrix[origine][finale] = nombre de joueurs */
  matrix: Record<SocialClass, Record<SocialClass, number>>;
  podium: string[];
  climbed: number;
  fell: number;
  stayed: number;
  /** Phrases de conclusion (lecture de la matrice) */
  takeaways: string[];
}

export interface BoardView {
  stage: Stage;
  stageIndex: number;
  step: GameStep;
  stepEndsAt: number | null;
  paused: boolean;
  story: { title: string; text: string } | null;
  players: BoardPlayer[];
  feed: FeedItem[];
  final: FinalView | null;
}

/** Écran projeté (onglet « Écran » de l'admin) */
export interface ScreenView {
  roomId: string;
  code: string;
  name: string;
  phase: Phase;
  now: number;
  maxPlayers: number;
  lobby: { id: string; displayName: string; avatar: string; color: string; connected: boolean }[];
  board: BoardView | null;
}

export interface GameEventInfo {
  id: string;
  emoji: string;
  label: string;
  description: string;
}

/** Régie : ce que les joueurs ne voient pas */
export interface ControlView {
  config: GameConfig;
  /** Classe imposée avant le tirage au sort (null = aléatoire) */
  roles: Record<string, SocialClass | null>;
  /** Événement de vie en attente de chaque joueur (titre) */
  pending: Record<string, string | null>;
  events: GameEventInfo[];
}

export type GameControl = 'pause' | 'resume' | 'nextStage';

// ---------------------------------------------------------------- Salle

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

// ---- Namespace joueurs "/" ----

export interface ClientToServerEvents {
  /** Rejoint une partie grâce à son code (les parties sont créées par un admin) */
  'room:join': (input: { code: string }, cb: AckFn) => void;
  'room:leave': (cb: AckFn) => void;
  'chat:send': (input: { text: string }, cb: AckFn) => void;
  /** Lance une activité (le joueur se rend dans le lieu correspondant) */
  'game:act': (input: { actionId: string }, cb: AckFn) => void;
  /** Interrompt l'activité en cours */
  'game:cancel': (cb: AckFn) => void;
  /** Répond à l'événement de vie en cours */
  'game:answer': (input: { optionId: string }, cb: AckFn) => void;
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
}

export interface AdminClientToServerEvents {
  'admin:rooms': (cb: AckFn<AdminRoom[]>) => void;
  'admin:createRoom': (input: { name: string; maxPlayers: number }, cb: AckFn<{ id: string; code: string }>) => void;
  'admin:startRoom': (input: { roomId: string }, cb: AckFn) => void;
  'admin:endRoom': (input: { roomId: string }, cb: AckFn) => void;
  'admin:closeRoom': (input: { roomId: string }, cb: AckFn) => void;
  'admin:kick': (input: { roomId: string; playerId: string }, cb: AckFn) => void;
  /** Suivre une partie en direct (écran + régie) : réponse immédiate puis événements admin:live */
  'admin:watch': (input: { roomId: string }, cb: AckFn<LiveRoom>) => void;
  'admin:unwatch': (input: { roomId: string }, cb: AckFn) => void;
  /** Avant le lancement : impose une classe à un joueur (null = tirage au sort) */
  'admin:setRole': (input: { roomId: string; playerId: string; role: SocialClass | null }, cb: AckFn) => void;
  /** Avant le lancement : durée des étapes, répartition des classes */
  'admin:configure': (input: { roomId: string; config: Partial<GameConfig> }, cb: AckFn) => void;
  'admin:gameControl': (input: { roomId: string; action: GameControl }, cb: AckFn) => void;
  /** Donne (ou retire) de l'argent : target = 'all', 'class:<classe>' ou l'id d'un joueur */
  'admin:give': (input: { roomId: string; target: string; amount: number }, cb: AckFn) => void;
  /** Déclenche un événement (crise, héritage…) */
  'admin:event': (input: { roomId: string; eventId: string }, cb: AckFn) => void;
  /** Envoie tout de suite un événement de vie à un joueur */
  'admin:nudge': (input: { roomId: string; playerId: string }, cb: AckFn) => void;
}

export interface AdminServerToClientEvents {
  'admin:stats': (stats: AdminStats) => void;
  /** Une partie a changé (création, joueur, phase…) : la liste doit être rafraîchie */
  'admin:roomsChanged': () => void;
  'admin:live': (live: LiveRoom) => void;
}
