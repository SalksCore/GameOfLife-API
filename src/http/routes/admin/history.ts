import { and, count, desc, eq, like, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../../db/client.js';
import { adminActions, admins, gamePlayers, games, players } from '../../../db/schema.js';

const idParams = z.object({ id: z.uuid() });
const actionsQuery = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  /** Famille d'actions : player, room, settings, maintenance */
  type: z.enum(['player', 'room', 'settings', 'maintenance']).optional(),
});
const PAGE_SIZE = 50;

/** Historique des parties et journal d'administration */
export async function historyRoutes(app: FastifyInstance) {
  app.get('/games', async () => {
    return db
      .select({
        id: games.id,
        code: games.code,
        name: games.name,
        playerCount: games.playerCount,
        startedAt: games.startedAt,
        endedAt: games.endedAt,
        createdBy: admins.username,
      })
      .from(games)
      .leftJoin(admins, eq(admins.id, games.createdBy))
      .orderBy(desc(games.endedAt))
      .limit(100);
  });

  app.get('/games/:id/players', async (req, reply) => {
    const params = idParams.safeParse(req.params);
    if (!params.success) return reply.status(400).send({ error: 'Requête invalide' });
    return db
      .select({
        id: players.id,
        username: players.username,
        firstName: players.firstName,
        lastName: players.lastName,
      })
      .from(gamePlayers)
      .innerJoin(players, eq(players.id, gamePlayers.playerId))
      .where(eq(gamePlayers.gameId, params.data.id));
  });

  app.get('/actions', async (req, reply) => {
    const parsed = actionsQuery.safeParse(req.query);
    if (!parsed.success) return reply.status(400).send({ error: 'Paramètres invalides' });
    const { page, type } = parsed.data;
    const filters: SQL[] = [];
    if (type) filters.push(like(adminActions.action, `${type}.%`));
    const where = filters.length ? and(...filters) : undefined;

    const [items, [total]] = await Promise.all([
      db
        .select({
          id: adminActions.id,
          admin: admins.username,
          action: adminActions.action,
          target: adminActions.target,
          details: adminActions.details,
          playerId: adminActions.playerId,
          createdAt: adminActions.createdAt,
        })
        .from(adminActions)
        .leftJoin(admins, eq(admins.id, adminActions.adminId))
        .where(where)
        .orderBy(desc(adminActions.createdAt))
        .limit(PAGE_SIZE)
        .offset((page - 1) * PAGE_SIZE),
      db.select({ n: count() }).from(adminActions).where(where),
    ]);
    return { items, page, pageSize: PAGE_SIZE, total: total?.n ?? 0 };
  });
}
