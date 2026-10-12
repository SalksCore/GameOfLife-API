import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { jwtVerify, SignJWT } from 'jose';
import { env } from '../config/env.js';
import { db } from '../db/client.js';
import { adminSessions, playerSessions } from '../db/schema.js';

/**
 * Deux types de comptes totalement séparés.
 * Chaque type a sa propre audience JWT : un token joueur est refusé partout côté admin, et inversement.
 */
export type AccountKind = 'player' | 'admin';

export interface AuthAccount {
  kind: AccountKind;
  id: string;
  username: string;
}

const secret = new TextEncoder().encode(env.JWT_SECRET);
const ISSUER = 'gameoflife-api';
const AUDIENCE: Record<AccountKind, string> = { player: 'gameoflife-player', admin: 'gameoflife-admin' };
const SESSIONS = { player: playerSessions, admin: adminSessions } as const;

export const ACCESS_TTL_SEC: Record<AccountKind, number> = { player: 15 * 60, admin: 10 * 60 };
export const REFRESH_TTL_SEC: Record<AccountKind, number> = { player: 30 * 24 * 3600, admin: 12 * 3600 };
const REUSE_GRACE_MS = 10_000;

export async function signAccessToken(account: AuthAccount): Promise<string> {
  return new SignJWT({ name: account.username })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(account.id)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE[account.kind])
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TTL_SEC[account.kind]}s`)
    .sign(secret);
}

export async function verifyAccessToken(token: string, kind: AccountKind): Promise<AuthAccount | null> {
  try {
    const { payload } = await jwtVerify(token, secret, {
      issuer: ISSUER,
      audience: AUDIENCE[kind],
      algorithms: ['HS256'],
    });
    if (typeof payload.sub !== 'string' || typeof payload.name !== 'string') return null;
    return { kind, id: payload.sub, username: payload.name };
  } catch {
    return null;
  }
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** Crée un refresh token opaque (256 bits). Seul son hash est stocké en base. */
export async function issueRefreshToken(kind: AccountKind, accountId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db.insert(SESSIONS[kind]).values({
    accountId,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + REFRESH_TTL_SEC[kind] * 1000),
  });
  return token;
}

/**
 * Rotation : le token présenté est révoqué et un nouveau est émis.
 * Renvoie l'id du compte ; l'appelant vérifie ensuite que le compte est toujours actif.
 */
export async function rotateRefreshToken(
  kind: AccountKind,
  token: string,
): Promise<{ accountId: string; token: string } | null> {
  const table = SESSIONS[kind];
  const [row] = await db.select().from(table).where(eq(table.tokenHash, sha256(token))).limit(1);
  if (!row) return null;

  if (row.revokedAt) {
    // Rejeu juste après une rotation = probablement deux onglets en parallèle : on refuse sans sanction.
    // Rejeu plus tard = token volé : toutes les sessions du compte sont révoquées.
    if (Date.now() - row.revokedAt.getTime() > REUSE_GRACE_MS) await revokeAllSessions(kind, row.accountId);
    return null;
  }
  if (row.expiresAt.getTime() <= Date.now()) return null;

  // Révocation atomique : si deux requêtes arrivent en même temps, une seule gagne
  const revoked = await db
    .update(table)
    .set({ revokedAt: new Date() })
    .where(and(eq(table.id, row.id), isNull(table.revokedAt)))
    .returning({ id: table.id });
  if (!revoked.length) return null;

  return { accountId: row.accountId, token: await issueRefreshToken(kind, row.accountId) };
}

export async function revokeRefreshToken(kind: AccountKind, token: string): Promise<void> {
  const table = SESSIONS[kind];
  await db
    .update(table)
    .set({ revokedAt: new Date() })
    .where(and(eq(table.tokenHash, sha256(token)), isNull(table.revokedAt)));
}

export async function revokeAllSessions(kind: AccountKind, accountId: string): Promise<void> {
  const table = SESSIONS[kind];
  await db
    .update(table)
    .set({ revokedAt: new Date() })
    .where(and(eq(table.accountId, accountId), isNull(table.revokedAt), gt(table.expiresAt, new Date())));
}
