import type { FastifyInstance } from 'fastify';
import { publicStatus } from '../../settings.js';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', { config: { rateLimit: false } }, async () => ({ status: 'ok' }));

  /** État public du jeu : nom, message d'accueil, maintenance (lu par PHONE avant connexion) */
  app.get('/status', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    return publicStatus();
  });
}
