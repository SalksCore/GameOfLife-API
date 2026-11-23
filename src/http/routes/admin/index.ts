import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { hashPassword, verifyPassword } from '../../../auth/password.js';
import { revokeAllSessions } from '../../../auth/tokens.js';
import { logAdminAction } from '../../../db/audit.js';
import { db } from '../../../db/client.js';
import { admins } from '../../../db/schema.js';
import { sessionRoutes } from '../session-routes.js';
import { adminAccountRoutes } from './admins.js';
import { historyRoutes } from './history.js';
import { playerRoutes } from './players.js';
import { settingsRoutes } from './settings.js';
import { statsRoutes } from './stats.js';

async function adminProfile(id: string) {
  const [a] = await db
    .select({ id: admins.id, username: admins.username, role: admins.role, lastLoginAt: admins.lastLoginAt, createdAt: admins.createdAt })
    .from(admins)
    .where(eq(admins.id, id))
    .limit(1);
  return a ?? null;
}

const passwordBody = z.object({
  current: z.string().min(1).max(128),
  next: z.string().min(12, 'Au moins 12 caractères').max(128),
});

/** Comptes ADMINS : /api/admin/auth (le premier par script, les suivants depuis la page Équipe) */
export async function adminAuthRoutes(app: FastifyInstance) {
  sessionRoutes(app, {
    kind: 'admin',
    cookieName: 'gol_admin_rt',
    cookiePath: '/api/admin/auth',
    profile: adminProfile,
  });

  app.get('/me', { preHandler: app.requireAdmin }, async (req) => adminProfile(req.account!.id));

  /** Changer son propre mot de passe : toutes les sessions sont coupées, on se reconnecte. */
  app.post(
    '/password',
    { preHandler: [app.requireTrustedOrigin, app.requireAdmin], config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const parsed = passwordBody.safeParse(req.body);
      if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? 'Requête invalide' });
      const [me] = await db.select().from(admins).where(eq(admins.id, req.account!.id)).limit(1);
      if (!me || !(await verifyPassword(me.passwordHash, parsed.data.current))) {
        return reply.status(400).send({ error: 'Mot de passe actuel incorrect' });
      }
      if (parsed.data.next === parsed.data.current) return reply.status(400).send({ error: 'Choisissez un mot de passe différent' });
      await db.update(admins).set({ passwordHash: await hashPassword(parsed.data.next) }).where(eq(admins.id, me.id));
      await revokeAllSessions('admin', me.id);
      await logAdminAction(me.id, 'admin.password', me.username);
      return { ok: true };
    },
  );
}

/** Routes protégées : /api/admin/* (token admin obligatoire sur toutes) */
export async function adminRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.requireAdmin);
  await app.register(playerRoutes, { prefix: '/players' });
  await app.register(adminAccountRoutes, { prefix: '/admins' });
  await app.register(statsRoutes, { prefix: '/stats' });
  await app.register(settingsRoutes, { prefix: '/settings' });
  await app.register(historyRoutes);
}
