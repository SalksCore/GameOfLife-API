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

export const displayNameOf = (p: Pick<Player, 'firstName' | 'lastName'>) =>
  `${p.firstName} ${p.lastName.charAt(0).toUpperCase()}.`;

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

// Mots simples, sans accents, faciles à dicter
const WORDS = [
  'Abeille', 'Acier', 'Aigle', 'Ancre', 'Arbre', 'Argent', 'Astre', 'Aurore', 'Avion', 'Balcon', 'Baleine', 'Bambou',
  'Banane', 'Bateau', 'Bison', 'Bleuet', 'Bouton', 'Brume', 'Cactus', 'Cadre', 'Canard', 'Canyon', 'Carpe', 'Castor',
  'Cerise', 'Chalet', 'Chamois', 'Citron', 'Cobra', 'Comete', 'Corail', 'Coyote', 'Crabe', 'Cristal', 'Cygne', 'Dauphin',
  'Delta', 'Desert', 'Diamant', 'Dragon', 'Dune', 'Eclair', 'Ecureuil', 'Etoile', 'Falaise', 'Faucon', 'Figue', 'Flamme',
  'Foret', 'Fougere', 'Fusee', 'Galaxie', 'Gazelle', 'Geyser', 'Girafe', 'Glacier', 'Granit', 'Griffon', 'Hibou', 'Horizon',
  'Iceberg', 'Igloo', 'Jaguar', 'Jardin', 'Jungle', 'Kiwi', 'Koala', 'Lagon', 'Lama', 'Lavande', 'Lezard', 'Lichen',
  'Lotus', 'Loutre', 'Lune', 'Lynx', 'Magma', 'Mangue', 'Marmotte', 'Meteore', 'Mimosa', 'Montagne', 'Mouette', 'Nuage',
  'Oasis', 'Ocean', 'Olive', 'Orage', 'Orchidee', 'Ours', 'Panda', 'Papaye', 'Pelican', 'Phare', 'Pingouin', 'Pirate',
  'Planete', 'Plume', 'Pollen', 'Prairie', 'Puma', 'Quartz', 'Radar', 'Rafale', 'Renard', 'Requin', 'Riviere', 'Robot',
  'Rocher', 'Safari', 'Saphir', 'Saturne', 'Savane', 'Sequoia', 'Silex', 'Soleil', 'Sommet', 'Sorbet', 'Tempete', 'Tigre',
  'Tonnerre', 'Toucan', 'Tulipe', 'Vallee', 'Vanille', 'Volcan', 'Zebre', 'Zephyr',
];

/** Mot de passe lisible et dictable : Tigre-Lune-Cactus-4821 (~34 bits d'entropie) */
export function generatePassword(): string {
  const pick = () => WORDS[randomInt(WORDS.length)]!;
  return `${pick()}-${pick()}-${pick()}-${String(randomInt(10_000)).padStart(4, '0')}`;
}
