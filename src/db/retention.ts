import { eq, inArray, lt, max } from 'drizzle-orm';
import type { Logger } from '../utils/logger.js';
import { db } from './client.js';
import { adminActions, gamePlayers, games, playerLogins, players } from './schema.js';

/** Durée de conservation des données des joueurs après leur dernière partie (politique de confidentialité, art. 6) */
export const RETENTION_DAYS = 90;
const DAY = 86_400_000;

/**
 * Suppression automatique 3 mois après la partie :
 * - comptes joueurs dont la dernière partie date de plus de 3 mois (sessions, connexions et participations suivent) ;
 * - parties, connexions et journal d'admin de plus de 3 mois.
 * Les relevés de fréquentation (sans nom) sont conservés.
 */
export async function purgeExpiredData(log: Logger, now = Date.now()): Promise<{ players: number; games: number }> {
  const limit = new Date(now - RETENTION_DAYS * DAY);
  const expired = await db
    .select({ id: players.id })
    .from(players)
    .innerJoin(gamePlayers, eq(gamePlayers.playerId, players.id))
    .innerJoin(games, eq(games.id, gamePlayers.gameId))
    .groupBy(players.id)
    .having(lt(max(games.endedAt), limit));
  const ids = expired.map((r) => r.id);
  if (ids.length) await db.delete(players).where(inArray(players.id, ids));
  const oldGames = await db.delete(games).where(lt(games.endedAt, limit)).returning({ id: games.id });
  await db.delete(playerLogins).where(lt(playerLogins.at, limit));
  await db.delete(adminActions).where(lt(adminActions.createdAt, limit));
  if (ids.length || oldGames.length) {
    await db.insert(adminActions).values({
      adminId: null,
      action: 'retention.purge',
      target: `${ids.length} compte${ids.length > 1 ? 's' : ''}, ${oldGames.length} partie${oldGames.length > 1 ? 's' : ''}`,
      details: `Suppression automatique ${RETENTION_DAYS} jours après la partie`,
    });
    log.info({ players: ids.length, games: oldGames.length }, 'Données expirées supprimées');
  }
  return { players: ids.length, games: oldGames.length };
}

/** Lance la purge au démarrage puis toutes les 6 heures */
export function scheduleRetention(log: Logger): () => void {
  const run = () => purgeExpiredData(log).catch((err) => log.error({ err }, 'Purge des données expirées impossible'));
  void run();
  const timer = setInterval(run, 6 * 3_600_000);
  timer.unref();
  return () => clearInterval(timer);
}
