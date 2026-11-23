import { randomUUID } from 'node:crypto';
import { DEFAULT_CARDS, buildDeck } from './v2/content.js';
import { ExposeGame, type GameTimings } from './v2/game.js';
import {
  DEFAULT_GAME_CONFIG,
  type AdminRoom,
  type ChatMessage,
  type ControlView,
  type DeckAction,
  type DeckStep,
  type FactCard,
  type ExposeContent,
  type GameConfig,
  type GameExport,
  type GameInput,
  type Phase,
  type RoomView,
  type ScreenView,
  type SocialClass,
} from './protocol.js';

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
  /** L'écran projeté / la régie de cette partie doivent être rafraîchis */
  live(): void;
}

export interface RoomTimings {
  /** Salle d'attente : délai de reconnexion avant de retirer un joueur (réseau mobile instable) */
  lobbyGrace: number;
  /** Durées du jeu (tests) */
  game?: GameTimings;
  /** Aléa du jeu (tests) */
  rnd?: () => number;
  /** Contenus de l'exposé modifiés dans le panneau (diaporama, cartes) */
  content?: () => Readonly<ExposeContent>;
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
 * Partie pilotée par un admin : salle d'attente -> exposé en cours -> terminé.
 * Pendant l'exposé, ExposeGame enchaîne les 25 étapes.
 */
export class Room {
  phase: Phase = 'lobby';
  lastActivity = Date.now();
  createdAt = Date.now();
  private startedAt: Date | null = null;
  private readonly members = new Map<string, Member>();
  private readonly leaveTimers = new Map<string, NodeJS.Timeout>();
  private closed = false;
  /** Classes imposées par la régie avant le lancement (absent = tirage au sort) */
  private readonly roles = new Map<string, SocialClass>();
  /** Binômes : joueur -> partenaire (symétrique) */
  private readonly pairs = new Map<string, string>();
  /** Demandes de binôme : demandeur -> destinataire */
  private readonly pairRequests = new Map<string, string>();
  private config: GameConfig = { ...DEFAULT_GAME_CONFIG };
  private content(): ExposeContent {
    return (this.timings.content?.() as ExposeContent | undefined) ?? { steps: {}, cards: DEFAULT_CARDS };
  }
  game: ExposeGame | null = null;

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

  // ---------- Sauvegarde (reprise après un crash) ----------

  /** État de la salle et de la partie, pour la sauvegarde en base */
  snapshot(): Record<string, unknown> {
    return {
      v: 1,
      info: this.info,
      phase: this.phase,
      startedAt: this.startedAt?.getTime() ?? null,
      createdAt: this.createdAt,
      members: [...this.members.values()].map(({ connected: _c, ...m }) => m),
      roles: [...this.roles],
      pairs: [...this.pairs],
      config: this.config,
      deck: this.game ? this.deckSnapshot : null,
      cards: this.game ? this.cardsSnapshot : null,
      game: this.game?.snapshot() ?? null,
    };
  }

  /** Recrée une salle sauvegardée : joueurs hors ligne (ils se reconnectent seuls), partie en pause */
  static restore(data: Record<string, unknown>, out: RoomOutput, timings: RoomTimings = DEFAULT_TIMINGS): Room {
    const room = new Room(data.info as RoomInit, out, timings);
    room.phase = data.phase as Phase;
    if (typeof data.createdAt === 'number') room.createdAt = data.createdAt;
    room.startedAt = typeof data.startedAt === 'number' ? new Date(data.startedAt) : null;
    for (const m of data.members as Omit<Member, 'connected'>[]) room.members.set(m.id, { ...m, connected: false });
    for (const [k, v] of data.roles as [string, SocialClass][]) room.roles.set(k, v);
    for (const [k, v] of data.pairs as [string, string][]) room.pairs.set(k, v);
    room.config = { ...DEFAULT_GAME_CONFIG, ...(data.config as GameConfig) };
    if (data.game && data.deck) {
      room.deckSnapshot = data.deck as DeckStep[];
      room.cardsSnapshot = (data.cards as FactCard[]) ?? [];
      room.game = ExposeGame.restore(data.game as Record<string, unknown>, {
        deck: room.deckSnapshot,
        cards: room.cardsSnapshot,
        roles: room.roles,
        config: room.config,
        getMembers: () => room.members,
        hooks: room.gameHooks(),
        rnd: timings.rnd,
        timings: timings.game,
      });
    }
    return room;
  }

  private deckSnapshot: DeckStep[] = [];
  private cardsSnapshot: FactCard[] = [];

  private gameHooks() {
    return {
      players: (ids?: string[]) => {
        if (this.closed) return;
        for (const id of ids ?? this.members.keys()) {
          if (this.members.has(id)) this.out.state(id, this.viewFor(id));
        }
        this.lastActivity = Date.now();
      },
      live: () => this.out.live(),
    };
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
      pairing: {
        partnerId: this.pairs.get(playerId) ?? null,
        requestsFrom: [...this.pairRequests].filter(([, to]) => to === playerId).map(([from]) => from),
        requestedTo: this.pairRequests.get(playerId) ?? null,
        locked: this.phase !== 'lobby',
      },
      game: this.game?.playerView(playerId) ?? null,
    };
  }

  /** Écran projeté : salle d'attente puis l'étape en cours */
  screenView(): ScreenView {
    const g = this.game;
    const step = g?.step;
    return {
      roomId: this.id,
      code: this.code,
      name: this.info.name,
      phase: this.phase,
      now: Date.now(),
      maxPlayers: this.info.maxPlayers,
      lobby: [...this.members.values()].map(({ id, displayName, avatar, color, connected }) => ({
        id,
        displayName,
        avatar,
        color,
        connected,
        partner: this.pairs.has(id) ? (this.members.get(this.pairs.get(id)!)?.displayName ?? null) : null,
      })),
      deck: g && step ? { index: g.cursor, total: g.controlView().deck.length, kind: step.kind, title: step.slide.title, replay: g.replay } : null,
      timer: g?.timer() ?? { endsAt: null, paused: false, remaining: null },
      players: g?.screenPlayers() ?? [],
      show: g?.screenStep() ?? null,
      card: g?.screenCard() ?? null,
      feed: g?.screenFeed() ?? [],
    };
  }

  /** Régie : configuration, classes imposées, binômes, déroulé */
  controlView(): ControlView {
    const roles: Record<string, SocialClass | null> = {};
    for (const id of this.members.keys()) roles[id] = this.roles.get(id) ?? null;
    const base = {
      config: { ...this.config },
      roles,
      pairs: Object.fromEntries(this.pairs),
    };
    if (this.game) return { ...base, ...this.game.controlView() };
    const deck = buildDeck(this.content());
    return {
      ...base,
      deck: deck.map((s) => ({ id: s.id, kind: s.kind, title: s.slide.title, enabled: s.enabled, who: s.who, plan: s.plan, played: false })),
      cursor: -1,
      furthest: -1,
      startedAt: null,
      notes: deck[0]?.slide.notes ?? '',
      canClose: false,
      canReveal: false,
      revealLabel: 'Révéler',
      lecture: false,
      cards: this.content().cards,
      stepCards: [],
      shownCard: null,
      characters: [],
      events: [],
      reform: null,
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
    this.roles.delete(playerId);
    if (this.phase === 'lobby') this.unpair(playerId);
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

  // ---------- Binômes (salle d'attente) ----------

  pairAction(playerId: string, action: 'request' | 'accept' | 'decline' | 'leave', otherId: string | null): Result {
    if (this.phase !== 'lobby') return 'Les binômes sont fixés une fois la partie lancée';
    if (!this.members.has(playerId)) return 'Tu n’es pas dans cette partie';
    switch (action) {
      case 'request': {
        if (!otherId || otherId === playerId || !this.members.has(otherId)) return 'Joueur introuvable';
        if (this.pairs.has(playerId)) return 'Tu joues déjà en binôme';
        if (this.pairs.has(otherId)) return 'Ce joueur joue déjà en binôme';
        // Demande croisée : le binôme est formé
        if (this.pairRequests.get(otherId) === playerId) return this.makePair(playerId, otherId);
        this.pairRequests.set(playerId, otherId);
        break;
      }
      case 'accept': {
        if (!otherId || this.pairRequests.get(otherId) !== playerId) return 'Cette demande n’existe plus';
        if (this.pairs.has(otherId) || this.pairs.has(playerId)) return 'Binôme déjà formé';
        return this.makePair(playerId, otherId);
      }
      case 'decline': {
        if (otherId && this.pairRequests.get(otherId) === playerId) this.pairRequests.delete(otherId);
        else this.pairRequests.delete(playerId);
        break;
      }
      case 'leave':
        this.unpair(playerId);
        break;
    }
    this.touch();
    return null;
  }

  /** Régie : former ou défaire un binôme */
  adminPair(playerId: string, partnerId: string | null): Result {
    if (this.phase !== 'lobby') return 'Les binômes sont fixés une fois la partie lancée';
    if (!this.members.has(playerId)) return 'Joueur absent de cette partie';
    if (partnerId === null) {
      this.unpair(playerId);
      this.touch();
      return null;
    }
    if (partnerId === playerId || !this.members.has(partnerId)) return 'Partenaire introuvable';
    this.unpair(playerId);
    this.unpair(partnerId);
    return this.makePair(playerId, partnerId);
  }

  private makePair(a: string, b: string): Result {
    this.pairs.set(a, b);
    this.pairs.set(b, a);
    for (const [from, to] of [...this.pairRequests]) if ([a, b].includes(from) || [a, b].includes(to)) this.pairRequests.delete(from);
    // Un binôme a une seule famille : la classe imposée à l'un vaut pour les deux
    const role = this.roles.get(a) ?? this.roles.get(b);
    if (role) {
      this.roles.set(a, role);
      this.roles.set(b, role);
    }
    this.system(`🤝 ${this.members.get(a)?.displayName} et ${this.members.get(b)?.displayName} jouent en binôme`);
    this.touch();
    return null;
  }

  private unpair(playerId: string) {
    const p = this.pairs.get(playerId);
    if (p) this.pairs.delete(p);
    this.pairs.delete(playerId);
    for (const [from, to] of [...this.pairRequests]) if (from === playerId || to === playerId) this.pairRequests.delete(from);
  }

  // ---------- Pilotage (admin) ----------

  setRole(playerId: string, role: SocialClass | null): Result {
    if (this.game?.hasDrawn) return 'Les familles sont déjà tirées';
    if (!this.members.has(playerId)) return 'Joueur absent de cette partie';
    const ids = [playerId, ...(this.pairs.has(playerId) ? [this.pairs.get(playerId)!] : [])];
    for (const id of ids) {
      if (role) this.roles.set(id, role);
      else this.roles.delete(id);
    }
    this.out.live();
    return null;
  }

  configure(config: Partial<GameConfig>): Result {
    this.config = { ...this.config, ...config };
    this.out.live();
    return null;
  }

  start(): Result {
    if (this.phase !== 'lobby') return 'La partie n’est pas en salle d’attente';
    if (this.members.size === 0) return 'Aucun joueur dans la partie';
    this.phase = 'playing';
    this.startedAt = new Date();
    for (const t of this.leaveTimers.values()) clearTimeout(t);
    this.leaveTimers.clear();
    this.pairRequests.clear();
    const expose = this.content();
    this.deckSnapshot = buildDeck(expose);
    this.cardsSnapshot = expose.cards;
    this.game = new ExposeGame(
      this.deckSnapshot,
      this.cardsSnapshot,
      [...this.members.values()],
      this.roles,
      new Map(this.pairs),
      this.config,
      () => this.members,
      this.gameHooks(),
      this.timings.rnd,
      this.timings.game,
    );
    this.system('🚀 L’exposé commence !');
    this.game.start();
    this.touch();
    return null;
  }

  deck(action: DeckAction, index?: number): Result {
    if (!this.game) return 'L’exposé n’est pas lancé';
    return this.game.control(action, index);
  }

  input(playerId: string, input: GameInput): Result {
    if (!this.game) return 'Aucune partie en cours';
    if (!this.members.has(playerId)) return 'Tu n’es pas dans cette partie';
    return this.game.input(playerId, input);
  }

  exportData(): GameExport | string {
    if (!this.game) return 'L’exposé n’est pas lancé';
    return this.game.exportData({ name: this.info.name, code: this.code });
  }

  /** Fin de l'exposé : la partie part dans l'historique (le dernier écran reste affiché) */
  end(): Result {
    if (this.phase !== 'playing') return 'La partie n’est pas en cours';
    this.markEnded();
    return null;
  }

  private markEnded(): void {
    if (this.phase === 'ended') return;
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
  }

  kick(playerId: string): Result {
    if (!this.members.has(playerId)) return 'Joueur absent de cette partie';
    this.out.leave(playerId);
    return null;
  }

  close(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    this.game?.dispose();
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
    this.out.live();
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
