import { randomUUID } from 'node:crypto';
import type { AdminRoom, ChatMessage, Phase, RoomView } from './protocol.js';

export interface GameResult {
  code: string;
  name: string;
  createdBy: string;
  startedAt: Date;
  playerIds: string[];
}

/** Sorties du moteur : le moteur ne connaît pas Socket.IO, ce qui le rend testable. */
export interface RoomOutput {
  state(playerId: string, view: RoomView | null): void;
  chat(playerIds: string[], msg: ChatMessage): void;
  notice(playerId: string, message: string): void;
  changed(): void;
  gameEnded(result: GameResult): void;
  /** Demande au gestionnaire de retirer le joueur (garde la table joueur -> partie cohérente) */
  leave(playerId: string): void;
}

export interface RoomTimings {
  /** Salle d'attente : délai de reconnexion avant de retirer un joueur (réseau mobile instable) */
  lobbyGrace: number;
}

export const DEFAULT_TIMINGS: RoomTimings = { lobbyGrace: 15_000 };

interface Member {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
  color: string;
  connected: boolean;
}

export interface RoomInit {
  id: string;
  code: string;
  name: string;
  maxPlayers: number;
  /** Identifiant de l'admin créateur */
  createdBy: string;
  createdByName: string;
}

type Result = string | null; // message d'erreur ou null si OK

/**
 * Partie générique, pilotée par un admin : salle d'attente -> en cours -> terminée.
 * Les règles du jeu viendront s'ajouter ici (phase 'playing').
 */
export class Room {
  phase: Phase = 'lobby';
  lastActivity = Date.now();
  readonly createdAt = Date.now();
  private startedAt: Date | null = null;
  private readonly members = new Map<string, Member>();
  private readonly leaveTimers = new Map<string, NodeJS.Timeout>();
  private closed = false;

  constructor(
    readonly info: RoomInit,
    private readonly out: RoomOutput,
    private readonly timings: RoomTimings = DEFAULT_TIMINGS,
  ) {}

  get id() {
    return this.info.id;
  }
  get code() {
    return this.info.code;
  }
  get size() {
    return this.members.size;
  }

  hasMember(playerId: string): boolean {
    return this.members.has(playerId);
  }

  memberIds(): string[] {
    return [...this.members.keys()];
  }

  // ---------- Vues ----------

  viewFor(playerId: string): RoomView | null {
    if (!this.members.has(playerId)) return null;
    return {
      id: this.id,
      code: this.code,
      name: this.info.name,
      phase: this.phase,
      maxPlayers: this.info.maxPlayers,
      players: [...this.members.values()].map((m) => ({
        id: m.id,
        displayName: m.displayName,
        avatar: m.avatar,
        color: m.color,
        connected: m.connected,
      })),
      startedAt: this.startedAt?.getTime() ?? null,
      now: Date.now(),
    };
  }

  adminView(): AdminRoom {
    return {
      id: this.id,
      code: this.code,
      name: this.info.name,
      phase: this.phase,
      maxPlayers: this.info.maxPlayers,
      createdBy: this.info.createdByName,
      createdAt: this.createdAt,
      startedAt: this.startedAt?.getTime() ?? null,
      players: [...this.members.values()].map(({ id, username, displayName, avatar, color, connected }) => ({
        id,
        username,
        displayName,
        avatar,
        color,
        connected,
      })),
    };
  }

  // ---------- Joueurs ----------

  join(player: { id: string; username: string; displayName: string; avatar: string; color: string }): Result {
    if (this.closed) return 'Cette partie est fermée';
    const existing = this.members.get(player.id);
    if (existing) {
      // Reconnexion : l'apparence a pu changer entre-temps
      Object.assign(existing, player);
      existing.connected = true;
      this.cancelLeaveTimer(player.id);
      this.touch();
      return null;
    }
    if (this.phase === 'playing') return 'La partie a déjà commencé';
    if (this.phase === 'ended') return 'Cette partie est terminée';
    if (this.members.size >= this.info.maxPlayers) return 'La partie est complète';

    this.members.set(player.id, { ...player, connected: true });
    this.system(`${player.displayName} a rejoint la partie`);
    this.touch();
    return null;
  }

  leave(playerId: string, notice?: string): void {
    const m = this.members.get(playerId);
    if (!m) return;
    this.cancelLeaveTimer(playerId);
    this.members.delete(playerId);
    this.out.state(playerId, null);
    if (notice) this.out.notice(playerId, notice);
    this.system(`${m.displayName} a quitté la partie`);
    this.touch();
  }

  disconnect(playerId: string): void {
    const m = this.members.get(playerId);
    if (!m) return;
    m.connected = false;
    this.touch();
    // En salle d'attente, un joueur absent trop longtemps libère sa place
    if (this.phase === 'lobby') {
      this.cancelLeaveTimer(playerId);
      this.leaveTimers.set(
        playerId,
        setTimeout(() => {
          this.leaveTimers.delete(playerId);
          if (!this.members.get(playerId)?.connected) this.out.leave(playerId);
        }, this.timings.lobbyGrace),
      );
    }
  }

  chat(playerId: string, rawText: string): Result {
    const m = this.members.get(playerId);
    if (!m) return 'Tu n’es pas dans cette partie';
    const text = rawText.trim();
    if (!text) return 'Message vide';
    this.out.chat(this.memberIds(), {
      id: randomUUID(),
      channel: 'all',
      authorId: m.id,
      author: m.displayName,
      text,
      at: Date.now(),
    });
    this.lastActivity = Date.now();
    return null;
  }

  // ---------- Pilotage (admin) ----------

  start(): Result {
    if (this.phase !== 'lobby') return 'La partie n’est pas en salle d’attente';
    if (this.members.size === 0) return 'Aucun joueur dans la partie';
    this.phase = 'playing';
    this.startedAt = new Date();
    this.system('🚀 La partie commence !');
    // TODO règles du jeu : initialiser l'état de jeu ici
    this.touch();
    return null;
  }

  end(): Result {
    if (this.phase !== 'playing') return 'La partie n’est pas en cours';
    this.phase = 'ended';
    this.system('🏁 La partie est terminée. Merci d’avoir joué !');
    this.out.gameEnded({
      code: this.code,
      name: this.info.name,
      createdBy: this.info.createdBy,
      startedAt: this.startedAt!,
      playerIds: this.memberIds(),
    });
    this.touch();
    return null;
  }

  kick(playerId: string): Result {
    if (!this.members.has(playerId)) return 'Joueur absent de cette partie';
    this.out.leave(playerId);
    return null;
  }

  close(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    for (const t of this.leaveTimers.values()) clearTimeout(t);
    this.leaveTimers.clear();
    for (const id of this.memberIds()) {
      this.out.state(id, null);
      this.out.notice(id, reason);
    }
    this.members.clear();
  }

  // ---------- Utilitaires ----------

  /** Diffuse l'état à tous les joueurs et signale le changement aux admins */
  private touch(): void {
    this.lastActivity = Date.now();
    if (this.closed) return;
    for (const id of this.members.keys()) this.out.state(id, this.viewFor(id));
    this.out.changed();
  }

  private cancelLeaveTimer(playerId: string): void {
    const t = this.leaveTimers.get(playerId);
    if (t) clearTimeout(t);
    this.leaveTimers.delete(playerId);
  }

  private system(text: string): void {
    const ids = this.memberIds();
    if (!ids.length) return;
    this.out.chat(ids, {
      id: randomUUID(),
      channel: 'system',
      authorId: null,
      author: 'GameOfLife',
      text,
      at: Date.now(),
    });
  }
}
