/**
 * Crée un compte ADMIN (table `admins`, distincte des joueurs) ou réinitialise son mot de passe.
 * Usage : npm run admin:create -- <pseudo> <motdepasse>
 */
import { eq } from 'drizzle-orm';
import { hashPassword } from '../src/auth/password.js';
import { revokeAllSessions } from '../src/auth/tokens.js';
import { closeDb, connectDb, db } from '../src/db/client.js';
import { admins } from '../src/db/schema.js';

const [username, password] = process.argv.slice(2);
if (!username || !/^[a-zA-Z0-9_-]{3,32}$/.test(username) || !password || password.length < 12) {
  console.error('Usage : npm run admin:create -- <pseudo> <motdepasse (12 caractères min)>');
  process.exit(1);
}

await connectDb();
const usernameKey = username.toLowerCase();
const passwordHash = await hashPassword(password);
const [existing] = await db.select().from(admins).where(eq(admins.usernameKey, usernameKey)).limit(1);

if (existing) {
  await db.update(admins).set({ passwordHash, disabledAt: null }).where(eq(admins.id, existing.id));
  await revokeAllSessions('admin', existing.id);
  console.log(`Admin "${existing.username}" : mot de passe réinitialisé, sessions révoquées.`);
} else {
  await db.insert(admins).values({ username, usernameKey, passwordHash });
  console.log(`Admin "${username}" créé.`);
}
await closeDb();
