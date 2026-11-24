import { randomInt } from 'node:crypto';
import { eq, like } from 'drizzle-orm';
import { db } from '../db/client.js';
import { admins, players, type Player } from '../db/schema.js';
import { DEFAULT_AVATAR, DEFAULT_COLOR } from '../game/avatars.js';
import type { AccountKind } from './tokens.js';

export interface AccountRecord {
  id: string;
  username: string;
  /** Nom affiché en jeu */
  displayName: string;
  avatar: string;
  color: string;
  passwordHash: string;
  /** Raison du blocage si le compte ne peut pas se connecter */
  blocked: string | null;
}

export const displayNameOf = (p: Pick<Player, 'firstName' | 'lastName'> & { anonymous?: boolean }) =>
  p.anonymous ? `${p.firstName} ${p.lastName}` : `${p.firstName} ${p.lastName.charAt(0).toUpperCase()}.`;

// Pseudonymes de l'option anonyme : animaux et éléments, sans accents
const PSEUDOS = [
  'Renard', 'Hibou', 'Loutre', 'Panda', 'Koala', 'Lynx', 'Faucon', 'Dauphin', 'Castor', 'Toucan', 'Jaguar', 'Zebre',
  'Girafe', 'Pelican', 'Marmotte', 'Gazelle', 'Bison', 'Puma', 'Cobra', 'Comete', 'Orage', 'Volcan', 'Glacier', 'Cactus',
];

/** Option anonyme : pseudonyme aléatoire libre (« Renard 42 ») et son identifiant (renard42) */
export async function generatePseudonym(): Promise<{ firstName: string; lastName: string; username: string }> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const firstName = PSEUDOS[randomInt(PSEUDOS.length)]!;
    const lastName = String(randomInt(10, 100));
    const username = `${slug(firstName)}${lastName}`;
    const [taken] = await db.select({ id: players.id }).from(players).where(eq(players.username, username)).limit(1);
    if (!taken) return { firstName, lastName, username };
  }
  const firstName = PSEUDOS[randomInt(PSEUDOS.length)]!;
  const lastName = String(randomInt(100, 10_000));
  return { firstName, lastName, username: `${slug(firstName)}${lastName}` };
}

export async function findAccount(
  kind: AccountKind,
  by: { id: string } | { username: string },
): Promise<AccountRecord | null> {
  if (kind === 'player') {
    const where = 'id' in by ? eq(players.id, by.id) : eq(players.username, by.username.toLowerCase());
    const [p] = await db.select().from(players).where(where).limit(1);
    if (!p) return null;
    return {
      id: p.id,
      username: p.username,
      displayName: displayNameOf(p),
      avatar: p.avatar,
      color: p.color,
      passwordHash: p.passwordHash,
      blocked: p.bannedAt ? 'Compte suspendu, contacte un administrateur' : null,
    };
  }
  const where = 'id' in by ? eq(admins.id, by.id) : eq(admins.usernameKey, by.username.toLowerCase());
  const [a] = await db.select().from(admins).where(where).limit(1);
  if (!a) return null;
  return {
    id: a.id,
    username: a.username,
    displayName: a.username,
    avatar: DEFAULT_AVATAR,
    color: DEFAULT_COLOR,
    passwordHash: a.passwordHash,
    blocked: a.disabledAt ? 'Compte désactivé' : null,
  };
}

export async function touchLogin(kind: AccountKind, id: string): Promise<void> {
  const t = kind === 'player' ? players : admins;
  await db.update(t).set({ lastLoginAt: new Date() }).where(eq(t.id, id));
}

// ---------- Génération des identifiants joueurs ----------

/** "Jean-Éric" -> "jeaneric" : minuscules, sans accents ni caractères spéciaux */
export function slug(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

/** Nettoie un nom saisi : espaces multiples retirés, majuscule initiale sur chaque partie */
export function cleanName(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/(^|[\s'-])(\p{L})/gu, (_m, sep: string, c: string) => sep + c.toUpperCase());
}

/**
 * Identifiant = 1re lettre du NOM + PRÉNOM complet (Jean Dupont -> djean).
 * En cas de doublon, un numéro est ajouté : djean2, djean3…
 */
export async function generateUsername(firstName: string, lastName: string): Promise<string> {
  const base = `${slug(lastName).charAt(0)}${slug(firstName)}`.slice(0, 30);
  const taken = new Set(
    (await db.select({ u: players.username }).from(players).where(like(players.username, `${base}%`))).map(
      (r) => r.u,
    ),
  );
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}${n}`)) n++;
  return `${base}${n}`;
}

// Sans caractères ambigus (0/o, 1/l/i) : se recopie sans erreur depuis un papier
const PASSWORD_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export const PASSWORD_LENGTH = 8;

/**
 * Mot de passe court et aléatoire, tout en minuscules : k7mxp4rz (31^8, ~40 bits).
 * Imprimé en deux groupes de 4 sur la fiche ; la connexion ignore espaces, tirets et majuscules.
 */
export function generatePassword(): string {
  let out = '';
  for (let i = 0; i < PASSWORD_LENGTH; i++) out += PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)];
  return out;
}

// Code binôme : 6 caractères en majuscules, sans ambiguïté (affiché K7M-4PZ)
const PAIR_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Code binôme libre (vérifie qu'aucun autre joueur ne l'a). */
export async function generatePairCode(): Promise<string> {
  for (;;) {
    let code = '';
    for (let i = 0; i < 6; i++) code += PAIR_ALPHABET[randomInt(PAIR_ALPHABET.length)];
    const [taken] = await db.select({ id: players.id }).from(players).where(eq(players.pairCode, code)).limit(1);
    if (!taken) return code;
  }
}

/** « k7m-4pz » -> « K7M4PZ » */
export function normalizePairCode(input: string): string {
  return input.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

/** Ce qu'un joueur tape, ramené à la forme générée (espaces, tirets et majuscules retirés). */
export function normalizePassword(input: string): string {
  return input.replace(/[\s-]+/g, '').toLowerCase();
}
