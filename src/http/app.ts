import compress from '@fastify/compress';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyError } from 'fastify';
import { env, isProd } from '../config/env.js';
import type { Realtime } from '../realtime/index.js';
import { authPlugin } from './auth-plugin.js';
import { adminAuthRoutes, adminRoutes } from './routes/admin/index.js';
import { playerAuthRoutes } from './routes/auth.js';
import { healthRoutes } from './routes/health.js';

export async function buildApp() {
  const app = Fastify({
    trustProxy: env.TRUST_PROXY,
    bodyLimit: 32 * 1024,
    requestTimeout: 10_000,
    disableRequestLogging: isProd,
    logger: {
      level: isProd ? 'info' : 'debug',
      redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
    },
  });

  await app.register(helmet, {
    // API JSON pure : CSP la plus stricte possible
    contentSecurityPolicy: {
      useDefaults: false,
      directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    },
    frameguard: { action: 'deny' },
    crossOriginResourcePolicy: { policy: 'same-site' },
    hsts: isProd ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
  });
  await app.register(cors, {
    origin: env.CORS_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    maxAge: 600,
  });
  await app.register(compress, { threshold: 1024 });
  await app.register(cookie);
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    errorResponseBuilder: (_req, ctx) => ({
      statusCode: 429,
      error: `Trop de tentatives. Réessaie dans ${Math.max(1, Math.ceil(ctx.ttl / 1000))} s.`,
    }),
  });
  await app.register(authPlugin);

  app.setErrorHandler((err: FastifyError, req, reply) => {
    const status = err.statusCode ?? 500;
    if (status >= 500) req.log.error({ err }, 'Erreur serveur');
    // On ne renvoie jamais le détail d'une erreur 500 au client
    reply.status(status).send({ error: status >= 500 ? 'Erreur serveur' : err.message });
  });
  app.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: 'Introuvable' }));

  await app.register(healthRoutes, { prefix: '/api' });
  // Joueurs et admins : routes, cookies et tokens distincts
  await app.register(playerAuthRoutes, { prefix: '/api/auth' });
  await app.register(adminAuthRoutes, { prefix: '/api/admin/auth' });
  await app.register(adminRoutes, { prefix: '/api/admin' });

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;

declare module 'fastify' {
  interface FastifyInstance {
    realtime: Realtime;
  }
}
