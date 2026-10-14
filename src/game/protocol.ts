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
export const CLASS_THRESHOLDS = { moyenne: 38, riche: 68 } as const;

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
 * Déroulé d'une étape : intro -> (choose -> reveal) × N -> milestone.
 * final = pyramide de fin de partie.
 */
export type GameStep = 'intro' | 'choose' | 'reveal' | 'milestone' | 'final';
export type Tone = 'good' | 'bad' | 'neutral';

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

export interface RoundResult {
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
  roundIndex: number;
  roundCount: number;
  me: {
    origin: SocialClass;
    cls: SocialClass;
    /** Position sociale 0-100 */
    score: number;
    capitals: Capitals;
    /** Diplômes et emploi obtenus, dans l'ordre */
    titles: string[];
  };
  /** Texte d'introduction d'étape ou de bilan (personnalisé) */
  story: { title: string; text: string } | null;
  round: {
    situation: SituationView;
    options: OptionView[];
    choice: string | null;
    result: RoundResult | null;
  } | null;
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
  answered: boolean;
  /** Évolution au dernier tour */
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
  roundIndex: number;
  roundCount: number;
  story: { title: string; text: string } | null;
  situation: SituationView | null;
  options: { id: string; emoji: string; label: string; count: number }[];
  answered: number;
  total: number;
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

/** Régie (onglet « Régie » de l'admin) : ce que les joueurs ne voient pas */
export interface ControlView {
  config: GameConfig;
  /** Classe imposée avant le tirage au sort (null = aléatoire) */
  roles: Record<string, SocialClass | null>;
  /** Prochaine situation, connue à l'avance */
  upcoming: { situation: SituationView; options: string[]; startsAt: number | null } | null;
  /** Choix en cours de chaque joueur (libellé) */
  choices: Record<string, string | null>;
  events: GameEventInfo[];
}

export type GameControl = 'pause' | 'resume' | 'skip' | 'reroll' | 'nextStage';

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
  /** Choix du joueur pour le tour en cours */
  'game:choose': (input: { optionId: string }, cb: AckFn) => void;
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
}

export interface AdminServerToClientEvents {
  'admin:stats': (stats: AdminStats) => void;
  /** Une partie a changé (création, joueur, phase…) : la liste doit être rafraîchie */
  'admin:roomsChanged': () => void;
  'admin:live': (live: LiveRoom) => void;
}
