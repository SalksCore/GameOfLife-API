import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { findAccount } from '../auth/accounts.js';
import { verifyAccessToken, type AccountKind, type AuthAccount } from '../auth/tokens.js';
import { env } from '../config/env.js';

declare module 'fastify' {
  interface FastifyRequest {
    account: AuthAccount | null;
  }
  interface FastifyInstance {
    requirePlayer: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireAdmin: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireTrustedOrigin: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

function bearer(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  return header?.startsWith('Bearer ') ? header.slice(7) : null;
}

export const authPlugin = fp(async (app: FastifyInstance) => {
  app.decorateRequest('account', null);

  const guard = (kind: AccountKind, checkDb: boolean) => async (req: FastifyRequest, reply: FastifyReply) => {
    const token = bearer(req);
    // Le token doit avoir été émis pour CE type de compte (audience JWT)
    const account = token ? await verifyAccessToken(token, kind) : null;
    if (!account) return reply.status(401).send({ error: 'Non authentifié' });
    if (checkDb) {
      const record = await findAccount(kind, { id: account.id });
      if (!record || record.blocked) return reply.status(401).send({ error: 'Non authentifié' });
    }
    req.account = account;
  };

  app.decorate('requirePlayer', guard('player', false));
  // Côté admin, l'état du compte est relu à chaque requête (trafic faible, sécurité maximale)
  app.decorate('requireAdmin', guard('admin', true));

  // Anti-CSRF pour les routes qui lisent un cookie de session (en plus de SameSite=Strict)
  app.decorate('requireTrustedOrigin', async (req: FastifyRequest, reply: FastifyReply) => {
    const origin = req.headers.origin;
    if (origin && !env.CORS_ORIGINS.includes(origin)) {
      return reply.status(403).send({ error: 'Origine refusée' });
    }
    if (req.headers['x-requested-with'] !== 'GameOfLife') {
      return reply.status(403).send({ error: 'Requête refusée' });
    }
  });
});
