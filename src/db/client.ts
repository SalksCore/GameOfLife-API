import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { env } from '../config/env.js';
import * as schema from './schema.js';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

// Chemins relatifs à la racine du projet (identiques en dev via tsx et en prod via dist/)
const migrationsFolder = resolve(process.cwd(), 'drizzle');

export let db: Db;
let closeFn: () => Promise<void> = async () => {};

/**
 * Connexion + migrations. Avec DATABASE_URL -> PostgreSQL (pool postgres.js).
 * Sans DATABASE_URL (dev) -> PGlite, un Postgres embarqué, aucune installation requise.
 */
export async function connectDb(): Promise<void> {
  if (env.DATABASE_URL) {
    const { default: postgres } = await import('postgres');
    const { drizzle } = await import('drizzle-orm/postgres-js');
    const { migrate } = await import('drizzle-orm/postgres-js/migrator');
    const sql = postgres(env.DATABASE_URL, { max: 10, idle_timeout: 30, onnotice: () => {} });
    const instance = drizzle(sql, { schema });
    await migrate(instance, { migrationsFolder });
    db = instance as unknown as Db;
    closeFn = () => sql.end({ timeout: 5 });
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    const { drizzle } = await import('drizzle-orm/pglite');
    const { migrate } = await import('drizzle-orm/pglite/migrator');
    const dataDir = resolve(process.cwd(), '.data/pglite');
    mkdirSync(dataDir, { recursive: true });
    const client = new PGlite(dataDir);
    const instance = drizzle(client, { schema });
    await migrate(instance, { migrationsFolder });
    db = instance as unknown as Db;
    closeFn = () => client.close();
  }
}

export function closeDb(): Promise<void> {
  return closeFn();
}
