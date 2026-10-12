import { and, count, countDistinct, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { displayNameOf } from '../../../auth/accounts.js';
import { db } from '../../../db/client.js';
import { gamePlayers, games, playerLogins, players, statsSnapshots } from '../../../db/schema.js';

const query = z.object({ days: z.coerce.number().int().refine((d) => [7, 30, 90].includes(d)).default(30) });

const DAY_MS = 86_400_000;

/** Jours calendaires (UTC) de la période, pour afficher les jours sans activité */
function dayKeys(from: Date, days: number): string[] {
  return Array.from({ length: days }, (_, i) => new Date(from.getTime() + i * DAY_MS).toISOString().slice(0, 10));
}

const dayOf = (column: unknown) => sql<string>`to_char(date_trunc('day', ${column} at time zone 'UTC'), 'YYYY-MM-DD')`;

/** /api/admin/stats */
export async function statsRoutes(app: FastifyInstance) {
  app.get('/', async (req, reply) => {
    const parsed = query.safeParse(req.query);
    if (!parsed.success) return reply.status(400).send({ error: 'Période invalide (7, 30 ou 90 jours)' });
    const { days } = parsed.data;

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const from = new Date(today.getTime() - (days - 1) * DAY_MS);
    const weekAgo = new Date(Date.now() - 7 * DAY_MS);

    const [
      [playerTotals],
      [gameTotals],
      gamesByDay,
      newPlayersByDay,
      activeByDay,
      concurrency,
      topPlayers,
    ] = await Promise.all([
      db
        .select({
          total: count(),
          active7d: sql<number>`count(*) filter (where ${players.lastLoginAt} >= ${weekAgo})`.mapWith(Number),
          suspended: sql<number>`count(*) filter (where ${players.bannedAt} is not null)`.mapWith(Number),
          neverLoggedIn: sql<number>`count(*) filter (where ${players.lastLoginAt} is null and ${players.bannedAt} is null)`.mapWith(Number),
        })
        .from(players),
      db
        .select({
          games: count(),
          avgPlayers: sql<number>`coalesce(avg(${games.playerCount}), 0)`.mapWith(Number),
          avgMinutes: sql<number>`coalesce(avg(extract(epoch from ${games.endedAt} - ${games.startedAt}) / 60), 0)`.mapWith(Number),
          participations: sql<number>`coalesce(sum(${games.playerCount}), 0)`.mapWith(Number),
        })
        .from(games)
        .where(gte(games.endedAt, from)),
      db
        .select({ day: dayOf(games.endedAt), games: count(), players: sql<number>`sum(${games.playerCount})`.mapWith(Number) })
        .from(games)
        .where(gte(games.endedAt, from))
        .groupBy(sql`1`),
      db
        .select({ day: dayOf(players.createdAt), count: count() })
        .from(players)
        .where(gte(players.createdAt, from))
        .groupBy(sql`1`),
      db
        .select({ day: dayOf(playerLogins.at), count: countDistinct(playerLogins.playerId) })
        .from(playerLogins)
        .where(gte(playerLogins.at, from))
        .groupBy(sql`1`),
      // Pic de joueurs connectés par heure (7 jours) ou par jour (au-delà)
      db
        .select({
          bucket: sql<string>`to_char(date_trunc(${days <= 7 ? 'hour' : 'day'}, ${statsSnapshots.at} at time zone 'UTC'), 'YYYY-MM-DD"T"HH24:00')`,
          peak: sql<number>`max(${statsSnapshots.connectedPlayers})`.mapWith(Number),
          games: sql<number>`max(${statsSnapshots.gamesInProgress})`.mapWith(Number),
        })
        .from(statsSnapshots)
        .where(gte(statsSnapshots.at, from))
        .groupBy(sql`1`)
        .orderBy(sql`1`),
      db
        .select({
          id: players.id,
          username: players.username,
          firstName: players.firstName,
          lastName: players.lastName,
          games: count(),
        })
        .from(gamePlayers)
        .innerJoin(games, eq(games.id, gamePlayers.gameId))
        .innerJoin(players, and(eq(players.id, gamePlayers.playerId), isNull(players.bannedAt)))
        .where(gte(games.endedAt, from))
        .groupBy(players.id)
        .orderBy(desc(count()), players.lastName)
        .limit(10),
    ]);

    const byDay = <T extends { day: string }>(rows: T[]) => new Map(rows.map((r) => [r.day, r]));
    const g = byDay(gamesByDay);
    const n = byDay(newPlayersByDay);
    const a = byDay(activeByDay);

    const peakConcurrent = concurrency.reduce((max, c) => Math.max(max, c.peak), 0);

    return {
      days,
      from,
      totals: {
        players: playerTotals?.total ?? 0,
        activePlayers7d: playerTotals?.active7d ?? 0,
        suspended: playerTotals?.suspended ?? 0,
        neverLoggedIn: playerTotals?.neverLoggedIn ?? 0,
        games: gameTotals?.games ?? 0,
        participations: gameTotals?.participations ?? 0,
        avgPlayersPerGame: Math.round((gameTotals?.avgPlayers ?? 0) * 10) / 10,
        avgGameMinutes: Math.round(gameTotals?.avgMinutes ?? 0),
        peakConcurrent,
      },
      daily: dayKeys(from, days).map((day) => ({
        day,
        games: g.get(day)?.games ?? 0,
        participations: g.get(day)?.players ?? 0,
        newPlayers: n.get(day)?.count ?? 0,
        activePlayers: a.get(day)?.count ?? 0,
      })),
      concurrency,
      topPlayers: topPlayers.map((p) => ({ ...p, displayName: displayNameOf(p) })),
      live: app.realtime.stats(),
    };
  });
}
