import { eq, gt, lt } from 'drizzle-orm';
import { db } from '../db/client.js';
import { roomSnapshots } from '../db/schema.js';
import type { Logger } from '../utils/logger.js';
import type { Room } from './room.js';
import type { RoomManager } from './room-manager.js';

/**
 * Sauvegarde continue des parties en cours (Postgres) : en cas de crash ou de redémarrage,
 * les parties sont rechargées au démarrage et reprennent en pause, à la même étape.
 */
export function createPersistence(log: Logger) {
  const timers = new Map<string, NodeJS.Timeout>();
  const dirty = new Set<string>();
  let manager: RoomManager | null = null;

  async function write(room: Room) {
    const data = room.snapshot();
    await db
      .insert(roomSnapshots)
      .values({ roomId: room.id, code: room.code, data, updatedAt: new Date() })
      .onConflictDoUpdate({ target: roomSnapshots.roomId, set: { data, code: room.code, updatedAt: new Date() } });
  }

  return {
    attach(m: RoomManager) {
      manager = m;
    },
    /** Une partie a changé : sauvegarde regroupée (au plus une écriture toutes les 2 s par partie) */
    schedule(roomId: string) {
      dirty.add(roomId);
      if (timers.has(roomId)) return;
      timers.set(
        roomId,
        setTimeout(() => {
          timers.delete(roomId);
          dirty.delete(roomId);
          const room = manager?.get(roomId);
          if (room) write(room).catch((err) => log.error({ err, roomId }, 'Sauvegarde de la partie impossible'));
        }, 2_000),
      );
    },
    /** Partie fermée volontairement (admin, inactivité) : sa sauvegarde est supprimée */
    discard(roomId: string) {
      const t = timers.get(roomId);
      if (t) clearTimeout(t);
      timers.delete(roomId);
      dirty.delete(roomId);
      db.delete(roomSnapshots)
        .where(eq(roomSnapshots.roomId, roomId))
        .catch((err) => log.error({ err, roomId }, 'Suppression de la sauvegarde impossible'));
    },
    /** Arrêt du serveur : on écrit tout de suite ce qui n'est pas encore sauvegardé */
    async flush() {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      const rooms = manager?.all() ?? [];
      await Promise.all(rooms.map((r) => write(r).catch((err) => log.error({ err, roomId: r.id }, 'Sauvegarde finale impossible'))));
      dirty.clear();
    },
    /** Démarrage : recharge les parties sauvegardées récemment (les plus anciennes sont effacées) */
    async restore(maxAgeMs: number): Promise<number> {
      if (!manager) return 0;
      const since = new Date(Date.now() - maxAgeMs);
      await db.delete(roomSnapshots).where(lt(roomSnapshots.updatedAt, since));
      const rows = await db.select().from(roomSnapshots).where(gt(roomSnapshots.updatedAt, since));
      let n = 0;
      for (const row of rows) {
        try {
          if (manager.adopt(row.data as Record<string, unknown>)) n++;
        } catch (err) {
          log.error({ err, roomId: row.roomId }, 'Reprise de la partie impossible');
        }
      }
      if (n) log.info({ rooms: n }, 'Parties en cours reprises après redémarrage');
      return n;
    },
  };
}
