import { randomInt, randomUUID } from 'node:crypto';
import { CODE_ALPHABET, LIMITS, normalizeCode, type AdminRoom } from './protocol.js';
import { Room, type RoomOutput, type RoomTimings } from './room.js';

export interface ManagerLimits {
  maxRooms: () => number;
  /** Une partie sans aucune activité pendant ce délai est fermée automatiquement */
  idleTimeoutMs: () => number;
}

function generateCode(): string {
  let code = '';
  for (let i = 0; i < LIMITS.codeLength; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

export interface PlayerIdentity {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
  color: string;
}

/**
 * Registre en mémoire des parties (état de jeu = RAM, latence minimale).
 * Les parties sont créées par les admins ; les joueurs les rejoignent avec leur code.
 * Un joueur ne peut être que dans une partie à la fois.
 */
export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly roomByCode = new Map<string, Room>();
  private readonly roomOfPlayer = new Map<string, string>();
  private readonly sweeper: NodeJS.Timeout;

  constructor(
    private readonly output: Omit<RoomOutput, 'leave' | 'live'> & { live(roomId: string): void },
    private readonly limits: ManagerLimits,
    private readonly timings?: RoomTimings,
  ) {
    this.sweeper = setInterval(() => this.closeIdle(), 60_000);
    this.sweeper.unref();
  }

  get size(): number {
    return this.rooms.size;
  }

  get gamesInProgress(): number {
    let n = 0;
    for (const r of this.rooms.values()) if (r.phase === 'playing') n++;
    return n;
  }

  get(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  adminList(): AdminRoom[] {
    return [...this.rooms.values()].sort((a, b) => b.createdAt - a.createdAt).map((r) => r.adminView());
  }

  /** Partie actuelle du joueur (null si aucune). */
  roomOf(playerId: string): Room | null {
    const id = this.roomOfPlayer.get(playerId);
    const room = id ? this.rooms.get(id) : undefined;
    if (room?.hasMember(playerId)) return room;
    if (id) this.roomOfPlayer.delete(playerId);
    return null;
  }

  create(input: { name: string; maxPlayers: number; createdBy: string; createdByName: string }): Room | string {
    if (this.rooms.size >= this.limits.maxRooms()) return 'Trop de parties ouvertes, fermes-en quelques-unes';
    let code = generateCode();
    while (this.roomByCode.has(code)) code = generateCode();

    const id = randomUUID();
    const room = new Room(
      { id, code, ...input },
      {
        ...this.output,
        leave: (playerId) => this.leave(playerId, 'Tu as été retiré de la partie'),
        live: () => this.output.live(id),
      },
      this.timings,
    );
    this.rooms.set(room.id, room);
    this.roomByCode.set(code, room);
    this.output.changed();
    return room;
  }

  joinByCode(player: PlayerIdentity, rawCode: string): string | null {
    const room = this.roomByCode.get(normalizeCode(rawCode));
    if (!room) return 'Aucune partie avec ce code';
    const current = this.roomOf(player.id);
    if (current && current !== room) this.leave(player.id);
    const err = room.join(player);
    if (err) return err;
    this.roomOfPlayer.set(player.id, room.id);
    return null;
  }

  /** Reprise après reconnexion */
  rejoin(player: PlayerIdentity): void {
    this.roomOf(player.id)?.join(player);
  }

  leave(playerId: string, notice?: string): void {
    this.roomOf(playerId)?.leave(playerId, notice);
    this.roomOfPlayer.delete(playerId);
  }

  disconnect(playerId: string): void {
    this.roomOf(playerId)?.disconnect(playerId);
  }

  close(roomId: string, reason: string): Room | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    this.rooms.delete(roomId);
    this.roomByCode.delete(room.code);
    for (const pid of room.memberIds()) this.roomOfPlayer.delete(pid);
    room.close(reason);
    this.output.changed();
    return room;
  }

  closeAll(reason: string): void {
    clearInterval(this.sweeper);
    for (const id of [...this.rooms.keys()]) this.close(id, reason);
  }

  private closeIdle(): void {
    const limit = Date.now() - this.limits.idleTimeoutMs();
    for (const room of [...this.rooms.values()]) {
      if (room.lastActivity < limit) this.close(room.id, 'Partie fermée pour inactivité');
    }
  }
}
