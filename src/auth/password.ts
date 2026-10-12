import { hash, verify } from '@node-rs/argon2';

// Argon2id, paramètres recommandés OWASP (19 MiB, 2 itérations)
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

// Hash factice : on vérifie quand même un mot de passe quand l'utilisateur n'existe pas,
// pour que le temps de réponse ne révèle pas quels pseudos existent.
const DUMMY_HASH = hash('dummy-password-for-timing', OPTIONS);

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string | null, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash ?? (await DUMMY_HASH), password);
  } catch {
    return false;
  }
}
