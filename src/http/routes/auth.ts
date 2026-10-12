import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { displayNameOf } from '../../auth/accounts.js';
import { db } from '../../db/client.js';
import { playerLogins, players, type Player } from '../../db/schema.js';
import { AVATARS, COLORS } from '../../game/avatars.js';
import { getMaintenance } from '../../settings.js';
import { sessionRoutes } from './session-routes.js';

const appearanceBody = z
  .object({ avatar: z.enum(AVATARS), color: z.enum(COLORS) })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Rien à modifier');

export const publicPlayer = (p: Player) => ({
  id: p.id,
  username: p.username,
  firstName: p.firstName,
  lastName: p.lastName,
  displayName: displayNameOf(p),
  avatar: p.avatar,
  color: p.color,
  gamesPlayed: p.gamesPlayed,
  createdAt: p.createdAt,
});

async function playerProfile(id: string) {
  const [p] = await db.select().from(players).where(eq(players.id, id)).limit(1);
  return p ? publicPlayer(p) : null;
}

/** Comptes JOUEURS : /api/auth (connexion uniquement, pas d'inscription) */
export async function playerAuthRoutes(app: FastifyInstance) {
  sessionRoutes(app, {
    kind: 'player',
    cookieName: 'gol_player_rt',
    cookiePath: '/api/auth',
    profile: playerProfile,
    maintenance: () => (getMaintenance().enabled ? getMaintenance().message : null),
    onLogin: async (req, playerId) => {
      await db.insert(playerLogins).values({
        playerId,
        ip: req.ip,
        userAgent: req.headers['user-agent']?.slice(0, 300) ?? null,
      });
    },
  });

  app.get('/me', { preHandler: app.requirePlayer }, async (req, reply) => {
    const profile = await playerProfile(req.account!.id);
    if (!profile) return reply.status(401).send({ error: 'Non authentifié' });
    return profile;
  });

  /** Le joueur choisit son avatar et sa couleur (valeurs limitées à la liste du serveur). */
  app.patch('/me', { preHandler: app.requirePlayer }, async (req, reply) => {
    const parsed = appearanceBody.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Avatar ou couleur invalide' });
    const [updated] = await db
      .update(players)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(players.id, req.account!.id))
      .returning();
    if (!updated) return reply.status(401).send({ error: 'Non authentifié' });
    // La partie en cours affiche immédiatement le nouvel avatar
    app.realtime.refreshPlayer(updated.id);
    return publicPlayer(updated);
  });
}
