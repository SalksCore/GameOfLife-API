import { randomInt } from 'node:crypto';
import { and, asc, count, eq, gt, isNull, ne } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { hashPassword } from '../../../auth/password.js';
import { revokeAllSessions } from '../../../auth/tokens.js';
import { logAdminAction } from '../../../db/audit.js';
import { db } from '../../../db/client.js';
import { adminSessions, admins, type Admin } from '../../../db/schema.js';

export type AdminRole = 'owner' | 'admin';

const usernameField = z
  .string()
  .trim()
  .regex(/^[a-zA-Z0-9_-]{3,32}$/, '3 à 32 caractères : lettres, chiffres, - et _');
const createBody = z.object({ username: usernameField, role: z.enum(['owner', 'admin']).default('admin') });
const patchBody = z.object({ role: z.enum(['owner', 'admin']).optional(), disabled: z.boolean().optional() });
const idParams = z.object({ id: z.uuid() });

// Sans caractères ambigus ; 16 caractères tirés parmi 54 (~92 bits), groupés par 4 pour la recopie
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
export function generateAdminPassword(): string {
  const groups = Array.from({ length: 4 }, () =>
    Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join(''),
  );
  return groups.join('-');
}

function view(a: Admin, sessions: number) {
  return {
    id: a.id,
    username: a.username,
    role: a.role,
    disabledAt: a.disabledAt,
    lastLoginAt: a.lastLoginAt,
    createdAt: a.createdAt,
    activeSessions: sessions,
  };
}

async function roleOf(id: string): Promise<AdminRole | null> {
  const [a] = await db.select({ role: admins.role, disabledAt: admins.disabledAt }).from(admins).where(eq(admins.id, id)).limit(1);
  return a && !a.disabledAt ? a.role : null;
}

/** Les comptes admin ne se gèrent que par un propriétaire. */
async function requireOwner(req: FastifyRequest, reply: FastifyReply) {
  if ((await roleOf(req.account!.id)) !== 'owner') {
    return reply.status(403).send({ error: 'Réservé aux propriétaires du panneau' });
  }
}

/** Nombre de propriétaires actifs, hors un compte donné */
async function otherActiveOwners(exceptId: string) {
  const [r] = await db
    .select({ n: count() })
    .from(admins)
    .where(and(eq(admins.role, 'owner'), isNull(admins.disabledAt), ne(admins.id, exceptId)));
  return r?.n ?? 0;
}

/** /api/admin/admins : l'équipe qui a accès au panneau */
export async function adminAccountRoutes(app: FastifyInstance) {
  app.get('/', async () => {
    const rows = await db.select().from(admins).orderBy(asc(admins.createdAt));
    const sessions = await db
      .select({ id: adminSessions.accountId, n: count() })
      .from(adminSessions)
      .where(and(isNull(adminSessions.revokedAt), gt(adminSessions.expiresAt, new Date())))
      .groupBy(adminSessions.accountId);
    const byId = new Map(sessions.map((s) => [s.id, s.n]));
    return { admins: rows.map((a) => view(a, byId.get(a.id) ?? 0)) };
  });

  app.post('/', { preHandler: requireOwner }, async (req, reply) => {
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? 'Requête invalide' });
    const { username, role } = parsed.data;
    const usernameKey = username.toLowerCase();
    const [exists] = await db.select({ id: admins.id }).from(admins).where(eq(admins.usernameKey, usernameKey)).limit(1);
    if (exists) return reply.status(409).send({ error: 'Cet identifiant est déjà pris' });
    const password = generateAdminPassword();
    const [created] = await db
      .insert(admins)
      .values({ username, usernameKey, role, passwordHash: await hashPassword(password) })
      .returning();
    await logAdminAction(req.account!.id, 'admin.create', created!.username, { details: role === 'owner' ? 'Propriétaire' : 'Admin' });
    return { admin: view(created!, 0), credentials: { username: created!.username, password } };
  });

  app.patch('/:id', { preHandler: requireOwner }, async (req, reply) => {
    const params = idParams.safeParse(req.params);
    const parsed = patchBody.safeParse(req.body);
    if (!params.success || !parsed.success) return reply.status(400).send({ error: 'Requête invalide' });
    const { id } = params.data;
    const { role, disabled } = parsed.data;
    if (id === req.account!.id) return reply.status(400).send({ error: 'Vous ne pouvez pas modifier votre propre accès' });
    const [target] = await db.select().from(admins).where(eq(admins.id, id)).limit(1);
    if (!target) return reply.status(404).send({ error: 'Compte introuvable' });
    const losesOwner = target.role === 'owner' && !target.disabledAt && (role === 'admin' || disabled === true);
    if (losesOwner && (await otherActiveOwners(id)) === 0) {
      return reply.status(400).send({ error: 'Il faut garder au moins un propriétaire actif' });
    }
    const [updated] = await db
      .update(admins)
      .set({
        ...(role ? { role } : {}),
        ...(disabled === undefined ? {} : { disabledAt: disabled ? new Date() : null }),
      })
      .where(eq(admins.id, id))
      .returning();
    if (disabled) {
      await revokeAllSessions('admin', id);
      app.realtime.kickAdmin(id);
    }
    if (role && role !== target.role) {
      await logAdminAction(req.account!.id, 'admin.role', target.username, { details: role === 'owner' ? 'Propriétaire' : 'Admin' });
    }
    if (disabled !== undefined && disabled !== !!target.disabledAt) {
      await logAdminAction(req.account!.id, disabled ? 'admin.disable' : 'admin.enable', target.username);
    }
    return { admin: view(updated!, 0) };
  });

  app.post('/:id/reset-password', { preHandler: requireOwner }, async (req, reply) => {
    const params = idParams.safeParse(req.params);
    if (!params.success) return reply.status(400).send({ error: 'Requête invalide' });
    if (params.data.id === req.account!.id) {
      return reply.status(400).send({ error: 'Changez votre propre mot de passe depuis « Mon compte »' });
    }
    const password = generateAdminPassword();
    const [updated] = await db
      .update(admins)
      .set({ passwordHash: await hashPassword(password) })
      .where(eq(admins.id, params.data.id))
      .returning();
    if (!updated) return reply.status(404).send({ error: 'Compte introuvable' });
    await revokeAllSessions('admin', updated.id);
    app.realtime.kickAdmin(updated.id);
    await logAdminAction(req.account!.id, 'admin.reset-password', updated.username);
    return { credentials: { username: updated.username, password } };
  });

  app.delete('/:id', { preHandler: requireOwner }, async (req, reply) => {
    const params = idParams.safeParse(req.params);
    if (!params.success) return reply.status(400).send({ error: 'Requête invalide' });
    const { id } = params.data;
    if (id === req.account!.id) return reply.status(400).send({ error: 'Vous ne pouvez pas supprimer votre propre compte' });
    const [target] = await db.select().from(admins).where(eq(admins.id, id)).limit(1);
    if (!target) return reply.status(404).send({ error: 'Compte introuvable' });
    if (target.role === 'owner' && !target.disabledAt && (await otherActiveOwners(id)) === 0) {
      return reply.status(400).send({ error: 'Il faut garder au moins un propriétaire actif' });
    }
    app.realtime.kickAdmin(id);
    // Les sessions partent en cascade ; le journal garde l'action (auteur mis à vide)
    await db.delete(admins).where(eq(admins.id, id));
    await logAdminAction(req.account!.id, 'admin.delete', target.username);
    return { ok: true };
  });
}
