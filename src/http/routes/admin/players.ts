import { and, asc, count, desc, eq, gt, ilike, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { cleanName, displayNameOf, generatePassword, generateUsername, slug } from '../../../auth/accounts.js';
import { hashPassword } from '../../../auth/password.js';
import { revokeAllSessions } from '../../../auth/tokens.js';
import { logAdminAction } from '../../../db/audit.js';
import { db } from '../../../db/client.js';
import {
  adminActions,
  admins,
  gamePlayers,
  games,
  playerLogins,
  players,
  playerSessions,
  type Player,
} from '../../../db/schema.js';

const PAGE_SIZE = 25;
const BULK_MAX = 200;

const listQuery = z.object({
  q: z.string().trim().max(40).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  status: z.enum(['all', 'active', 'banned', 'never']).default('all'),
  sort: z.enum(['recent', 'name', 'games', 'lastLogin']).default('recent'),
});
const idParams = z.object({ id: z.uuid() });
const nameField = z
  .string()
  .trim()
  .min(1, 'champ obligatoire')
  .max(40, '40 caractères maximum')
  .regex(/^[\p{L}][\p{L}\s'-]*$/u, 'lettres, espaces, apostrophes et tirets uniquement')
  .refine((v) => slug(v).length > 0, 'doit contenir au moins une lettre latine');
const nameBody = z.object({ firstName: nameField, lastName: nameField });
const bulkBody = z.object({ players: z.array(z.object({ firstName: z.string(), lastName: z.string() })).min(1).max(BULK_MAX) });
const updateBody = z
  .object({ firstName: nameField, lastName: nameField, notes: z.string().max(2_000) })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Rien à modifier');
const banBody = z.object({ banned: z.boolean(), reason: z.string().trim().max(300).optional() });

// Échappe % et _ pour que la recherche soit littérale
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export const adminPlayer = (p: Player) => ({
  id: p.id,
  username: p.username,
  firstName: p.firstName,
  lastName: p.lastName,
  displayName: displayNameOf(p),
  gamesPlayed: p.gamesPlayed,
  createdAt: p.createdAt,
  updatedAt: p.updatedAt,
  lastLoginAt: p.lastLoginAt,
  bannedAt: p.bannedAt,
  bannedReason: p.bannedReason,
});

const fullName = (p: Pick<Player, 'firstName' | 'lastName'>) => `${p.firstName} ${p.lastName}`;

function nameError(reply: FastifyReply, error: z.ZodError) {
  const issue = error.issues[0];
  const field = issue?.path[0] === 'firstName' ? 'Prénom' : issue?.path[0] === 'lastName' ? 'Nom' : 'Champ';
  return reply.status(400).send({ error: `${field} : ${issue?.message ?? 'invalide'}` });
}

/** Crée un joueur avec identifiant et mot de passe générés (réessaie si deux créations se croisent). */
async function createPlayer(firstName: string, lastName: string, adminId: string) {
  const password = generatePassword();
  const passwordHash = await hashPassword(password);
  for (let attempt = 0; attempt < 5; attempt++) {
    const username = await generateUsername(firstName, lastName);
    const [created] = await db
      .insert(players)
      .values({ firstName, lastName, username, passwordHash, createdBy: adminId })
      .onConflictDoNothing({ target: players.username })
      .returning();
    if (created) {
      await logAdminAction(adminId, 'player.create', `${username} (${firstName} ${lastName})`, { playerId: created.id });
      return { player: created, password };
    }
  }
  return null;
}

async function findPlayer(id: string) {
  const [p] = await db.select().from(players).where(eq(players.id, id)).limit(1);
  return p ?? null;
}

/** /api/admin/players */
export async function playerRoutes(app: FastifyInstance) {
  // ---------- Liste ----------
  app.get('/', async (req, reply) => {
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) return reply.status(400).send({ error: 'Paramètres invalides' });
    const { q, page, status, sort } = parsed.data;

    const filters: SQL[] = [];
    if (q) {
      const pattern = `%${likeEscape(q)}%`;
      filters.push(
        or(
          ilike(players.username, pattern),
          ilike(players.firstName, pattern),
          ilike(players.lastName, pattern),
          ilike(sql`${players.firstName} || ' ' || ${players.lastName}`, pattern),
          ilike(sql`${players.lastName} || ' ' || ${players.firstName}`, pattern),
        )!,
      );
    }
    if (status === 'active') filters.push(isNull(players.bannedAt));
    if (status === 'banned') filters.push(isNotNull(players.bannedAt));
    if (status === 'never') filters.push(isNull(players.lastLoginAt));
    const where = filters.length ? and(...filters) : undefined;

    const order = {
      recent: [desc(players.createdAt)],
      name: [asc(players.lastName), asc(players.firstName)],
      games: [desc(players.gamesPlayed), asc(players.lastName)],
      lastLogin: [sql`${players.lastLoginAt} desc nulls last`],
    }[sort];

    const [rows, [total], [counts]] = await Promise.all([
      db
        .select()
        .from(players)
        .where(where)
        .orderBy(...order)
        .limit(PAGE_SIZE)
        .offset((page - 1) * PAGE_SIZE),
      db.select({ n: count() }).from(players).where(where),
      db
        .select({
          all: count(),
          banned: sql<number>`count(*) filter (where ${players.bannedAt} is not null)`.mapWith(Number),
          never: sql<number>`count(*) filter (where ${players.lastLoginAt} is null)`.mapWith(Number),
        })
        .from(players),
    ]);

    return {
      items: rows.map((p) => ({ ...adminPlayer(p), online: app.realtime.playerStatus(p.id).online })),
      page,
      pageSize: PAGE_SIZE,
      total: total?.n ?? 0,
      counts: {
        all: counts?.all ?? 0,
        active: (counts?.all ?? 0) - (counts?.banned ?? 0),
        banned: counts?.banned ?? 0,
        never: counts?.never ?? 0,
      },
    };
  });

  // ---------- Création ----------
  /** Le mot de passe n'est renvoyé qu'ICI, une seule fois (seul son hash est stocké). */
  app.post('/', async (req, reply) => {
    const parsed = nameBody.safeParse(req.body);
    if (!parsed.success) return nameError(reply, parsed.error);
    const created = await createPlayer(
      cleanName(parsed.data.firstName),
      cleanName(parsed.data.lastName),
      req.account!.id,
    );
    if (!created) return reply.status(409).send({ error: 'Impossible de générer un identifiant, réessaie' });
    return reply.status(201).send({
      player: adminPlayer(created.player),
      credentials: { username: created.player.username, password: created.password },
    });
  });

  /** Création en masse : une ligne par joueur. Chaque ligne est traitée indépendamment. */
  app.post('/bulk', async (req, reply) => {
    const parsed = bulkBody.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: `Entre 1 et ${BULK_MAX} joueurs à la fois` });
    const results = [];
    for (const [index, input] of parsed.data.players.entries()) {
      const check = nameBody.safeParse(input);
      if (!check.success) {
        const issue = check.error.issues[0];
        results.push({ index, ok: false as const, error: `${issue?.path[0] === 'firstName' ? 'Prénom' : 'Nom'} : ${issue?.message}` });
        continue;
      }
      const created = await createPlayer(cleanName(check.data.firstName), cleanName(check.data.lastName), req.account!.id);
      results.push(
        created
          ? {
              index,
              ok: true as const,
              firstName: created.player.firstName,
              lastName: created.player.lastName,
              username: created.player.username,
              password: created.password,
            }
          : { index, ok: false as const, error: 'Identifiant impossible à générer' },
      );
    }
    return { results };
  });

  // ---------- Profil ----------
  app.get('/:id', async (req, reply) => {
    const params = idParams.safeParse(req.params);
    if (!params.success) return reply.status(400).send({ error: 'Requête invalide' });
    const p = await findPlayer(params.data.id);
    if (!p) return reply.status(404).send({ error: 'Joueur introuvable' });

    const since30 = new Date(Date.now() - 30 * 86_400_000);
    const [creator, [sessions], [recent], history, logins, moderation] = await Promise.all([
      p.createdBy
        ? db.select({ username: admins.username }).from(admins).where(eq(admins.id, p.createdBy)).limit(1)
        : Promise.resolve([]),
      db
        .select({ n: count() })
        .from(playerSessions)
        .where(
          and(
            eq(playerSessions.accountId, p.id),
            isNull(playerSessions.revokedAt),
            gt(playerSessions.expiresAt, new Date()),
          ),
        ),
      db
        .select({ n: count() })
        .from(gamePlayers)
        .innerJoin(games, eq(games.id, gamePlayers.gameId))
        .where(and(eq(gamePlayers.playerId, p.id), gt(games.endedAt, since30))),
      db
        .select({
          id: games.id,
          code: games.code,
          name: games.name,
          playerCount: games.playerCount,
          startedAt: games.startedAt,
          endedAt: games.endedAt,
        })
        .from(gamePlayers)
        .innerJoin(games, eq(games.id, gamePlayers.gameId))
        .where(eq(gamePlayers.playerId, p.id))
        .orderBy(desc(games.endedAt))
        .limit(50),
      db
        .select({ at: playerLogins.at, ip: playerLogins.ip, userAgent: playerLogins.userAgent })
        .from(playerLogins)
        .where(eq(playerLogins.playerId, p.id))
        .orderBy(desc(playerLogins.at))
        .limit(20),
      db
        .select({
          id: adminActions.id,
          action: adminActions.action,
          details: adminActions.details,
          admin: admins.username,
          createdAt: adminActions.createdAt,
        })
        .from(adminActions)
        .leftJoin(admins, eq(admins.id, adminActions.adminId))
        .where(eq(adminActions.playerId, p.id))
        .orderBy(desc(adminActions.createdAt))
        .limit(50),
    ]);

    const totalMinutes = history.reduce((sum, g) => sum + (g.endedAt.getTime() - g.startedAt.getTime()) / 60_000, 0);

    return {
      player: { ...adminPlayer(p), notes: p.notes, createdBy: creator[0]?.username ?? null },
      presence: app.realtime.playerStatus(p.id),
      activeSessions: sessions?.n ?? 0,
      stats: {
        gamesPlayed: p.gamesPlayed,
        gamesLast30Days: recent?.n ?? 0,
        firstGameAt: history.at(-1)?.startedAt ?? null,
        lastGameAt: history[0]?.endedAt ?? null,
        averageMinutes: history.length ? Math.round(totalMinutes / history.length) : 0,
      },
      games: history,
      logins,
      moderation,
    };
  });

  /** Modifie le prénom, le nom (l'identifiant reste inchangé) ou les notes internes. */
  app.patch('/:id', async (req, reply) => {
    const params = idParams.safeParse(req.params);
    const body = updateBody.safeParse(req.body);
    if (!params.success) return reply.status(400).send({ error: 'Requête invalide' });
    if (!body.success) return nameError(reply, body.error);
    const before = await findPlayer(params.data.id);
    if (!before) return reply.status(404).send({ error: 'Joueur introuvable' });

    const patch = {
      ...(body.data.firstName !== undefined && { firstName: cleanName(body.data.firstName) }),
      ...(body.data.lastName !== undefined && { lastName: cleanName(body.data.lastName) }),
      ...(body.data.notes !== undefined && { notes: body.data.notes.trim() }),
      updatedAt: new Date(),
    };
    const [updated] = await db.update(players).set(patch).where(eq(players.id, before.id)).returning();

    if (patch.firstName || patch.lastName) {
      const renamed = fullName(before) !== fullName(updated!);
      if (renamed) {
        await logAdminAction(req.account!.id, 'player.rename', updated!.username, {
          playerId: before.id,
          details: `${fullName(before)} → ${fullName(updated!)}`,
        });
      }
    }
    if (patch.notes !== undefined && patch.notes !== before.notes) {
      await logAdminAction(req.account!.id, 'player.notes', updated!.username, { playerId: before.id });
    }
    return { player: { ...adminPlayer(updated!), notes: updated!.notes } };
  });

  /** Génère un nouveau mot de passe (affiché une seule fois) et coupe les sessions du joueur. */
  app.post('/:id/reset-password', async (req, reply) => {
    const params = idParams.safeParse(req.params);
    if (!params.success) return reply.status(400).send({ error: 'Requête invalide' });
    const password = generatePassword();
    const [updated] = await db
      .update(players)
      .set({ passwordHash: await hashPassword(password), updatedAt: new Date() })
      .where(eq(players.id, params.data.id))
      .returning();
    if (!updated) return reply.status(404).send({ error: 'Joueur introuvable' });
    await revokeAllSessions('player', updated.id);
    app.realtime.kickPlayer(updated.id, 'Ton mot de passe a été changé, reconnecte-toi');
    await logAdminAction(req.account!.id, 'player.reset-password', updated.username, { playerId: updated.id });
    return { player: adminPlayer(updated), credentials: { username: updated.username, password } };
  });

  /** Déconnecte le joueur de tous ses appareils. */
  app.post('/:id/revoke-sessions', async (req, reply) => {
    const params = idParams.safeParse(req.params);
    if (!params.success) return reply.status(400).send({ error: 'Requête invalide' });
    const p = await findPlayer(params.data.id);
    if (!p) return reply.status(404).send({ error: 'Joueur introuvable' });
    await revokeAllSessions('player', p.id);
    app.realtime.kickPlayer(p.id, 'Tu as été déconnecté par un administrateur');
    await logAdminAction(req.account!.id, 'player.logout', p.username, { playerId: p.id });
    return { ok: true };
  });

  app.post('/:id/ban', async (req, reply) => {
    const params = idParams.safeParse(req.params);
    const body = banBody.safeParse(req.body);
    if (!params.success || !body.success) return reply.status(400).send({ error: 'Requête invalide' });
    const { banned, reason } = body.data;

    const [updated] = await db
      .update(players)
      .set({ bannedAt: banned ? new Date() : null, bannedReason: banned ? reason || null : null, updatedAt: new Date() })
      .where(eq(players.id, params.data.id))
      .returning();
    if (!updated) return reply.status(404).send({ error: 'Joueur introuvable' });

    if (banned) {
      await revokeAllSessions('player', updated.id);
      app.realtime.kickPlayer(updated.id, 'Ton compte a été suspendu');
    }
    await logAdminAction(req.account!.id, banned ? 'player.ban' : 'player.unban', updated.username, {
      playerId: updated.id,
      details: banned ? reason || null : null,
    });
    return { player: adminPlayer(updated) };
  });

  /** Suppression définitive (sessions, connexions et participations supprimées ; l'historique des parties garde son total). */
  app.delete('/:id', async (req, reply) => {
    const params = idParams.safeParse(req.params);
    if (!params.success) return reply.status(400).send({ error: 'Requête invalide' });
    const p = await findPlayer(params.data.id);
    if (!p) return reply.status(404).send({ error: 'Joueur introuvable' });
    app.realtime.kickPlayer(p.id, 'Ton compte a été supprimé');
    await db.delete(players).where(eq(players.id, p.id));
    await logAdminAction(req.account!.id, 'player.delete', `${p.username} (${fullName(p)})`, { playerId: p.id });
    return { ok: true };
  });
}
