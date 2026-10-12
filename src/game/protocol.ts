/**
 * Protocole temps réel GameOfLife.
 * Ce fichier est la RÉFÉRENCE : PHONE et ADMIN en ont une copie (src/protocol.ts).
 * Toute modification ici doit être reportée dans les deux clients.
 *
 * Socle neutre : les règles du jeu viendront se greffer sur `phase` = 'playing'.
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
} as const;

/** Alphabet des codes de partie : sans caractères ambigus (0/O, 1/I/L) */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Normalise une saisie utilisateur : majuscules, sans espaces ni tirets */
export const normalizeCode = (input: string) => input.toUpperCase().replace(/[\s-]/g, '');

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

export interface AdminClientToServerEvents {
  'admin:rooms': (cb: AckFn<AdminRoom[]>) => void;
  'admin:createRoom': (input: { name: string; maxPlayers: number }, cb: AckFn<{ id: string; code: string }>) => void;
  'admin:startRoom': (input: { roomId: string }, cb: AckFn) => void;
  'admin:endRoom': (input: { roomId: string }, cb: AckFn) => void;
  'admin:closeRoom': (input: { roomId: string }, cb: AckFn) => void;
  'admin:kick': (input: { roomId: string; playerId: string }, cb: AckFn) => void;
}

export interface AdminServerToClientEvents {
  'admin:stats': (stats: AdminStats) => void;
  /** Une partie a changé (création, joueur, phase…) : la liste doit être rafraîchie */
  'admin:roomsChanged': () => void;
}
