import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { findAccount, touchLogin } from '../../auth/accounts.js';
import { lockRemaining, recordFailure, recordSuccess } from '../../auth/login-throttle.js';
import { verifyPassword } from '../../auth/password.js';
import {
  issueRefreshToken,
  REFRESH_TTL_SEC,
  revokeRefreshToken,
  rotateRefreshToken,
  signAccessToken,
  type AccountKind,
} from '../../auth/tokens.js';
import { isProd } from '../../config/env.js';

// Par IP. En dev, tout le monde est sur 127.0.0.1 : limite plus large (le verrouillage par identifiant reste actif)
const LOGIN_PER_MINUTE = isProd ? 10 : 100;

const loginBody = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(128),
});

interface Options {
  kind: AccountKind;
  /** Chemin du cookie : limite son envoi aux seules routes de session de ce type de compte */
  cookiePath: string;
  cookieName: string;
  /** Construit la réponse publique du compte */
  profile: (id: string) => Promise<unknown>;
  /** Refuse la connexion si le jeu est en maintenance (message renvoyé), sinon null */
  maintenance?: () => string | null;
  /** Appelé après une connexion réussie (historique des connexions) */
  onLogin?: (req: FastifyRequest, accountId: string) => Promise<void>;
}

/**
 * Routes login / refresh / logout communes aux deux types de comptes.
 * Joueurs : /api/auth   ·   Admins : /api/admin/auth
 * Aucune inscription : les comptes joueurs sont créés par un admin, les admins par script.
 */
export function sessionRoutes(app: FastifyInstance, opts: Options) {
  const { kind, cookieName, cookiePath } = opts;

  async function startSession(reply: FastifyReply, account: { id: string; username: string }, refreshToken?: string) {
    const token = refreshToken ?? (await issueRefreshToken(kind, account.id));
    reply.setCookie(cookieName, token, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'strict',
      path: cookiePath,
      maxAge: REFRESH_TTL_SEC[kind],
    });
    const accessToken = await signAccessToken({ kind, id: account.id, username: account.username });
    return { accessToken, account: await opts.profile(account.id) };
  }

  const clearCookie = (reply: FastifyReply) => reply.clearCookie(cookieName, { path: cookiePath });

  app.post(
    '/login',
    { config: { rateLimit: { max: LOGIN_PER_MINUTE, timeWindow: '1 minute' } }, preHandler: app.requireTrustedOrigin },
    async (req, reply) => {
      const parsed = loginBody.safeParse(req.body);
      if (!parsed.success) return reply.status(401).send({ error: 'Identifiant ou mot de passe incorrect' });
      const { username, password } = parsed.data;

      const maintenance = opts.maintenance?.();
      if (maintenance) return reply.status(503).send({ error: maintenance, maintenance: true });

      const lockKey = `${kind}:${username.toLowerCase()}`;
      const locked = lockRemaining(lockKey);
      if (locked) {
        return reply
          .status(429)
          .send({ error: `Trop d'essais. Réessaie dans ${Math.ceil(locked / 60)} min.` });
      }

      const account = await findAccount(kind, { username });
      const valid = await verifyPassword(account?.passwordHash ?? null, password);
      if (!account || !valid) {
        recordFailure(lockKey);
        req.log.info({ kind, username }, 'Échec de connexion');
        return reply.status(401).send({ error: 'Identifiant ou mot de passe incorrect' });
      }
      recordSuccess(lockKey);
      if (account.blocked) return reply.status(403).send({ error: account.blocked });
      await touchLogin(kind, account.id);
      await opts.onLogin?.(req, account.id);
      return startSession(reply, account);
    },
  );

  app.post(
    '/refresh',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } }, preHandler: app.requireTrustedOrigin },
    async (req, reply) => {
      const token = req.cookies[cookieName];
      const rotated = token ? await rotateRefreshToken(kind, token) : null;
      const account = rotated ? await findAccount(kind, { id: rotated.accountId }) : null;
      if (!rotated || !account || account.blocked) {
        clearCookie(reply);
        return reply.status(401).send({ error: 'Session expirée' });
      }
      return startSession(reply, account, rotated.token);
    },
  );

  app.post('/logout', { preHandler: app.requireTrustedOrigin }, async (req, reply) => {
    const token = req.cookies[cookieName];
    if (token) await revokeRefreshToken(kind, token);
    clearCookie(reply);
    return { ok: true };
  });
}
