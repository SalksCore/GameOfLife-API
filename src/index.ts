import { env } from './config/env.js';
import { closeDb, connectDb } from './db/client.js';
import { buildApp } from './http/app.js';
import { createRealtime } from './realtime/index.js';
import { loadSettings } from './settings.js';

const app = await buildApp();

await connectDb();
await loadSettings();
app.log.info(env.DATABASE_URL ? 'PostgreSQL connecté' : 'PGlite (Postgres embarqué) utilisé — dev uniquement');

const realtime = createRealtime(app.log);
app.decorate('realtime', realtime);
realtime.io.attach(app.server);

await app.listen({ host: env.HOST, port: env.PORT });

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, 'Arrêt en cours…');
  const force = setTimeout(() => process.exit(1), 10_000);
  force.unref();
  try {
    realtime.close();
    await app.close();
    await closeDb();
    process.exit(0);
  } catch (err) {
    app.log.error({ err }, "Erreur pendant l'arrêt");
    process.exit(1);
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => app.log.error({ err }, 'Promesse rejetée non gérée'));
