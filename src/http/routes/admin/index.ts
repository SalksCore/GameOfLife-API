import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { db } from '../../../db/client.js';
import { admins } from '../../../db/schema.js';
import { sessionRoutes } from '../session-routes.js';
import { historyRoutes } from './history.js';
import { playerRoutes } from './players.js';
import { settingsRoutes } from './settings.js';
import { statsRoutes } from './stats.js';

async function adminProfile(id: string) {
  const [a] = await db
    .select({ id: admins.id, username: admins.username, lastLoginAt: admins.lastLoginAt })
    .from(admins)
    .where(eq(admins.id, id))
    .limit(1);
  return a ?? null;
}

/** Comptes ADMINS : /api/admin/auth (création par script uniquement) */
export async function adminAuthRoutes(app: FastifyInstance) {
  sessionRoutes(app, {
    kind: 'admin',
    cookieName: 'gol_admin_rt',
    cookiePath: '/api/admin/auth',
    profile: adminProfile,
  });

  app.get('/me', { preHandler: app.requireAdmin }, async (req) => adminProfile(req.account!.id));
}

/** Routes protégées : /api/admin/* (token admin obligatoire sur toutes) */
export async function adminRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.requireAdmin);
  await app.register(playerRoutes, { prefix: '/players' });
  await app.register(statsRoutes, { prefix: '/stats' });
  await app.register(settingsRoutes, { prefix: '/settings' });
  await app.register(historyRoutes);
}
