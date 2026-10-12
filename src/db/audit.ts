import { db } from './client.js';
import { adminActions } from './schema.js';

/** Journal des actions de modération */
export async function logAdminAction(
  adminId: string,
  action: string,
  target: string | null,
  extra: { playerId?: string; details?: string | null } = {},
): Promise<void> {
  await db.insert(adminActions).values({ adminId, action, target, playerId: extra.playerId, details: extra.details });
}
