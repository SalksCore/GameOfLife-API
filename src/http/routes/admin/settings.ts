import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { logAdminAction } from '../../../db/audit.js';
import { db } from '../../../db/client.js';
import { admins } from '../../../db/schema.js';
import {
  generalSchema,
  getGeneral,
  getMaintenance,
  getSettingsMeta,
  maintenanceSchema,
  updateGeneral,
  updateMaintenance,
} from '../../../settings.js';

async function adminName(id: string | null) {
  if (!id) return null;
  const [a] = await db.select({ username: admins.username }).from(admins).where(eq(admins.id, id)).limit(1);
  return a?.username ?? null;
}

async function describeMeta() {
  const meta = getSettingsMeta();
  return {
    general: { updatedAt: meta.general.updatedAt, updatedBy: await adminName(meta.general.updatedBy) },
    maintenance: { updatedAt: meta.maintenance.updatedAt, updatedBy: await adminName(meta.maintenance.updatedBy) },
  };
}

/** /api/admin/settings */
export async function settingsRoutes(app: FastifyInstance) {
  app.get('/', async () => ({
    general: getGeneral(),
    maintenance: getMaintenance(),
    meta: await describeMeta(),
  }));

  app.put('/general', async (req, reply) => {
    const parsed = generalSchema.safeParse(req.body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return reply.status(400).send({ error: `Paramètre « ${String(issue?.path[0])} » invalide : ${issue?.message}` });
    }
    const before = getGeneral();
    const general = await updateGeneral(parsed.data, req.account!.id);
    const changed = (Object.keys(general) as (keyof typeof general)[]).filter((k) => general[k] !== before[k]);
    if (changed.length) await logAdminAction(req.account!.id, 'settings.update', changed.join(', '));
    return { general, meta: await describeMeta() };
  });

  app.put('/maintenance', async (req, reply) => {
    const parsed = maintenanceSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Paramètres de maintenance invalides' });
    const wasEnabled = getMaintenance().enabled;
    const maintenance = await updateMaintenance(parsed.data, req.account!.id);
    const action = maintenance.enabled
      ? wasEnabled
        ? 'maintenance.update'
        : 'maintenance.on'
      : wasEnabled
        ? 'maintenance.off'
        : 'maintenance.update';
    await logAdminAction(req.account!.id, action, maintenance.enabled ? maintenance.message : null);
    return { maintenance, meta: await describeMeta() };
  });
}
