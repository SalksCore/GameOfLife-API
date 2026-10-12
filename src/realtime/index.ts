import type { IncomingMessage } from 'node:http';
import { inArray, sql } from 'drizzle-orm';
import { Server, type Namespace, type Socket } from 'socket.io';
import { z } from 'zod';
import { findAccount } from '../auth/accounts.js';
import { verifyAccessToken, type AccountKind } from '../auth/tokens.js';
import { env } from '../config/env.js';
import { logAdminAction } from '../db/audit.js';
import { db } from '../db/client.js';
import { gamePlayers, games, players, statsSnapshots } from '../db/schema.js';
import {
  CODE_ALPHABET,
  LIMITS,
  normalizeCode,
  type Ack,
  type AdminClientToServerEvents,
  type AdminServerToClientEvents,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '../game/protocol.js';
import type { GameResult, Room } from '../game/room.js';
import { RoomManager, type PlayerIdentity } from '../game/room-manager.js';
import type { Logger } from '../utils/logger.js';
import { getGeneral, getMaintenance, settingsEvents, type MaintenanceSettings } from '../settings.js';
import { TokenBucket } from '../utils/token-bucket.js';

interface SocketData {
  identity: PlayerIdentity;
  bucket: TokenBucket;
  chatBucket: TokenBucket;
  /** Limite les essais de code (anti-bruteforce) */
  joinBucket: TokenBucket;
  strikes: number;
}

type PlayerServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type PlayerSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type AdminNamespace = Namespace<AdminClientToServerEvents, AdminServerToClientEvents, Record<string, never>, SocketData>;

const playerRoom = (id: string) => `player:${id}`;

// ---- Validation des messages entrants ----
const uuid = z.uuid();
const codeRe = new RegExp(`^[${CODE_ALPHABET}]{${LIMITS.codeLength}}$`);
const schemas = {
  roomJoin: z.object({ code: z.string().max(20).transform(normalizeCode).pipe(z.string().regex(codeRe)) }),
  chat: z.object({ text: z.string().min(1).max(LIMITS.chatMax) }),
  createRoom: z.object({
    name: z.string().trim().min(LIMITS.roomNameMin).max(LIMITS.roomNameMax),
    maxPlayers: z.number().int().min(LIMITS.maxPlayersMin).max(LIMITS.maxPlayersMax),
  }),
  roomId: z.object({ roomId: uuid }),
  kick: z.object({ roomId: uuid, playerId: uuid }),
};

function isAllowedOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  // Pas d'Origin = client non-navigateur (tests, outils) : l'auth par token reste obligatoire
  return !origin || env.CORS_ORIGINS.includes(origin);
}

export type Realtime = ReturnType<typeof createRealtime>;

export function createRealtime(log: Logger) {
  const io: PlayerServer = new Server({
    path: '/socket.io',
    // WebSocket uniquement : pas de long-polling -> latence minimale, pas besoin de sticky sessions HTTP
    transports: ['websocket'],
    allowUpgrades: false,
    perMessageDeflate: false,
    maxHttpBufferSize: 16 * 1024,
    pingInterval: 20_000,
    pingTimeout: 15_000,
    serveClient: false,
    cors: { origin: env.CORS_ORIGINS, credentials: false },
    // Protection contre le Cross-Site WebSocket Hijacking
    allowRequest: (req, cb) => cb(null, isAllowedOrigin(req)),
  });
  const admin: AdminNamespace = io.of('/admin');

  // Les admins sont prévenus des changements, regroupés pour limiter le trafic
  let changeTimer: NodeJS.Timeout | null = null;
  const notifyAdmins = () => {
    changeTimer ??= setTimeout(() => {
      changeTimer = null;
      admin.emit('admin:roomsChanged');
    }, 200);
  };

  const manager = new RoomManager({
    state: (playerId, view) => io.to(playerRoom(playerId)).emit('room:state', view),
    chat: (playerIds, msg) => {
      if (playerIds.length) io.to(playerIds.map(playerRoom)).emit('chat:message', msg);
    },
    notice: (playerId, message) => io.to(playerRoom(playerId)).emit('room:notice', message),
    changed: notifyAdmins,
    gameEnded: (result) => {
      saveGame(result).catch((err) => log.error({ err }, 'Sauvegarde de la partie impossible'));
    },
  }, {
    maxRooms: () => getGeneral().maxOpenRooms,
    idleTimeoutMs: () => getGeneral().idleTimeoutHours * 3_600_000,
  });

  // ---- Authentification du handshake ----
  // Namespace "/" : token JOUEUR uniquement. Namespace "/admin" : token ADMIN uniquement.
  const authenticate = (kind: AccountKind) => (socket: Socket, next: (err?: Error) => void) => {
    (async () => {
      const token: unknown = socket.handshake.auth?.token;
      const claims = typeof token === 'string' ? await verifyAccessToken(token, kind) : null;
      if (!claims) throw new Error('unauthorized');
      if (kind === 'player' && getMaintenance().enabled) throw new Error('maintenance');
      // État réel en base (suspension / désactivation depuis l'émission du token)
      const record = await findAccount(kind, { id: claims.id });
      if (!record || record.blocked) throw new Error('unauthorized');
      const data = socket.data as SocketData;
      data.identity = {
        id: record.id,
        username: record.username,
        displayName: record.displayName,
        avatar: record.avatar,
        color: record.color,
      };
      data.bucket = new TokenBucket(20, 8);
      data.chatBucket = new TokenBucket(5, 1);
      data.joinBucket = new TokenBucket(5, 0.2); // 5 essais, puis 1 toutes les 5 s
      data.strikes = 0;
    })().then(
      () => next(),
      (err: Error) => next(new Error(err.message === 'maintenance' ? 'maintenance' : 'unauthorized')),
    );
  };

  /** Enveloppe chaque handler : débit, validation, ack sûr, erreurs capturées. */
  function handle<T, R = undefined>(
    socket: Socket,
    schema: z.ZodType<T> | null,
    fn: (input: T) => Promise<Ack<R>> | Ack<R>,
    extraBucket?: 'chatBucket' | 'joinBucket',
  ) {
    return async (...args: unknown[]) => {
      const cb = args.at(-1);
      const reply = typeof cb === 'function' ? (cb as (r: Ack<R>) => void) : () => {};
      const data = socket.data as SocketData;
      if (!data.bucket.take() || (extraBucket && !data[extraBucket].take())) {
        if (++data.strikes > 50) socket.disconnect(true);
        return reply({ ok: false, error: 'Trop de tentatives, patiente un peu' });
      }
      let input = undefined as T;
      if (schema) {
        const parsed = schema.safeParse(args[0]);
        if (!parsed.success) return reply({ ok: false, error: 'Requête invalide' });
        input = parsed.data;
      }
      try {
        reply(await fn(input));
      } catch (err) {
        log.error({ err }, 'Erreur handler socket');
        reply({ ok: false, error: 'Erreur serveur' });
      }
    };
  }

  const result = (err: string | null): Ack => (err ? { ok: false, error: err } : { ok: true, data: undefined });

  // ================= Namespace joueurs =================
  io.use(authenticate('player'));

  io.on('connection', (socket: PlayerSocket) => {
    const me = socket.data.identity;

    // Une seule session de jeu active par compte : l'ancienne est déconnectée
    io.to(playerRoom(me.id)).emit('session:kicked', 'Tu t’es connecté sur un autre appareil');
    io.in(playerRoom(me.id)).disconnectSockets(true);
    void socket.join(playerRoom(me.id));

    // Reprise automatique de la partie après une coupure réseau
    manager.rejoin(me);

    socket.on(
      'room:join',
      handle(socket, schemas.roomJoin, ({ code }) => result(manager.joinByCode(me, code)), 'joinBucket'),
    );

    socket.on(
      'room:leave',
      handle(socket, null, () => {
        manager.leave(me.id);
        return result(null);
      }),
    );

    socket.on(
      'chat:send',
      handle(
        socket,
        schemas.chat,
        ({ text }) => {
          if (!getGeneral().chatEnabled) return result('Le chat est désactivé');
          const room = manager.roomOf(me.id);
          return result(room ? room.chat(me.id, text) : 'Tu n’es dans aucune partie');
        },
        'chatBucket',
      ),
    );

    socket.on('disconnect', () => {
      // Si une nouvelle session a déjà pris le relais, ne rien faire
      const stillOnline = (io.sockets.adapter.rooms.get(playerRoom(me.id))?.size ?? 0) > 0;
      if (!stillOnline) manager.disconnect(me.id);
    });
  });

  // ================= Namespace admin =================
  admin.use(authenticate('admin'));

  admin.on('connection', (socket) => {
    const me = socket.data.identity;
    log.info({ admin: me.username }, 'Connexion admin');
    socket.emit('admin:stats', stats());

    /** Action sur une partie existante, journalisée */
    const onRoom = async (
      roomId: string,
      action: string,
      fn: (room: Room) => string | null,
      target?: { label: string; playerId: string },
    ) => {
      const room = manager.get(roomId);
      if (!room) return result('Partie introuvable');
      const label = `${room.code} · ${room.info.name}`;
      const err = fn(room);
      if (err) return result(err);
      await logAdminAction(me.id, action, target ? `${target.label} (${label})` : label, {
        playerId: target?.playerId,
      });
      return result(null);
    };

    socket.on(
      'admin:rooms',
      handle(socket, null, () => ({ ok: true, data: manager.adminList() })),
    );

    socket.on(
      'admin:createRoom',
      handle(socket, schemas.createRoom, async ({ name, maxPlayers }) => {
        const room = manager.create({ name, maxPlayers, createdBy: me.id, createdByName: me.username });
        if (typeof room === 'string') return { ok: false, error: room };
        await logAdminAction(me.id, 'room.create', `${room.code} · ${name}`);
        return { ok: true, data: { id: room.id, code: room.code } };
      }),
    );

    socket.on(
      'admin:startRoom',
      handle(socket, schemas.roomId, ({ roomId }) => onRoom(roomId, 'room.start', (r) => r.start())),
    );
    socket.on(
      'admin:endRoom',
      handle(socket, schemas.roomId, ({ roomId }) => onRoom(roomId, 'room.end', (r) => r.end())),
    );
    socket.on(
      'admin:closeRoom',
      handle(socket, schemas.roomId, ({ roomId }) =>
        onRoom(roomId, 'room.close', (r) => {
          manager.close(r.id, 'La partie a été fermée par l’organisateur');
          return null;
        }),
      ),
    );
    socket.on(
      'admin:kick',
      handle(socket, schemas.kick, ({ roomId, playerId }) => {
        const username = manager
          .get(roomId)
          ?.adminView()
          .players.find((p) => p.id === playerId)?.username;
        return onRoom(roomId, 'player.kick', (r) => r.kick(playerId), { label: username ?? playerId, playerId });
      }),
    );
  });

  // Pic de joueurs connectés depuis le dernier relevé
  let peakSinceSnapshot = 0;
  io.on('connection', () => {
    peakSinceSnapshot = Math.max(peakSinceSnapshot, io.of('/').sockets.size);
  });

  function stats() {
    return {
      connectedPlayers: io.of('/').sockets.size,
      rooms: manager.size,
      gamesInProgress: manager.gamesInProgress,
      uptimeSec: Math.round(process.uptime()),
      memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      maintenance: getMaintenance().enabled,
    };
  }

  const statsTimer = setInterval(() => {
    if (admin.sockets.size) admin.emit('admin:stats', stats());
  }, 2_000);
  statsTimer.unref();

  // Relevé d'activité toutes les 5 minutes (graphiques de fréquentation)
  const SNAPSHOT_MS = 5 * 60_000;
  const snapshotTimer = setInterval(() => {
    const s = stats();
    const at = new Date(Math.floor(Date.now() / SNAPSHOT_MS) * SNAPSHOT_MS);
    const connectedPlayers = Math.max(s.connectedPlayers, peakSinceSnapshot);
    peakSinceSnapshot = s.connectedPlayers;
    db.insert(statsSnapshots)
      .values({ at, connectedPlayers, openRooms: s.rooms, gamesInProgress: s.gamesInProgress })
      .onConflictDoNothing()
      .catch((err) => log.error({ err }, 'Relevé d’activité impossible'));
  }, SNAPSHOT_MS);
  snapshotTimer.unref();

  // Maintenance activée : les joueurs connectés sont prévenus puis déconnectés.
  // Les parties restent ouvertes : les joueurs les retrouvent à la reprise.
  const onMaintenance = (m: MaintenanceSettings) => {
    if (!m.enabled) return;
    io.emit('server:maintenance', { message: m.message, endsAt: m.endsAt });
    // close=false : ne coupe que le namespace joueurs, jamais une connexion partagée avec /admin
    setTimeout(() => io.disconnectSockets(false), 300);
    log.warn('Mode maintenance activé');
  };
  settingsEvents.on('maintenance', onMaintenance);

  /** Présence d'un joueur (profil admin) */
  function playerStatus(playerId: string) {
    const online = (io.sockets.adapter.rooms.get(playerRoom(playerId))?.size ?? 0) > 0;
    const room = manager.roomOf(playerId);
    return {
      online,
      room: room ? { id: room.id, code: room.code, name: room.info.name, phase: room.phase } : null,
    };
  }

  /** Le joueur a changé d'avatar : la partie en cours est mise à jour pour tout le monde. */
  function refreshPlayer(playerId: string) {
    if (!manager.roomOf(playerId)) return;
    findAccount('player', { id: playerId })
      .then((record) => {
        if (!record) return;
        manager.rejoin({
          id: record.id,
          username: record.username,
          displayName: record.displayName,
          avatar: record.avatar,
          color: record.color,
        });
      })
      .catch((err) => log.error({ err }, 'Rafraîchissement du joueur impossible'));
  }

  /** Retire un joueur de sa partie et coupe ses connexions (suspension, nouveau mot de passe). */
  function kickPlayer(playerId: string, reason: string) {
    manager.leave(playerId);
    io.to(playerRoom(playerId)).emit('session:kicked', reason);
    io.in(playerRoom(playerId)).disconnectSockets(true);
  }

  /** Sauvegarde de fin de partie : partie + participants + stats, en une transaction. */
  async function saveGame(r: GameResult) {
    await db.transaction(async (tx) => {
      const [game] = await tx
        .insert(games)
        .values({
          code: r.code,
          name: r.name,
          createdBy: r.createdBy,
          playerCount: r.playerIds.length,
          startedAt: r.startedAt,
        })
        .returning({ id: games.id });
      if (!r.playerIds.length) return;
      await tx.insert(gamePlayers).values(r.playerIds.map((playerId) => ({ gameId: game!.id, playerId })));
      await tx
        .update(players)
        .set({ gamesPlayed: sql`${players.gamesPlayed} + 1` })
        .where(inArray(players.id, r.playerIds));
    });
  }

  function close() {
    clearInterval(statsTimer);
    clearInterval(snapshotTimer);
    settingsEvents.off('maintenance', onMaintenance);
    manager.closeAll('Le serveur redémarre, reconnecte-toi dans un instant');
    io.disconnectSockets(true);
    admin.disconnectSockets(true);
    // Ferme le moteur sans fermer le serveur HTTP (géré par Fastify)
    io.engine.close();
  }

  return { io, manager, kickPlayer, refreshPlayer, playerStatus, stats, close };
}
