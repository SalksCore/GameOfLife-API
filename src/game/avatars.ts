/**
 * Portraits des joueurs : un code compact décrit un personnage dessiné en vectoriel (aucune photo, aucun emoji).
 * Format : « p: » suivi de 8 chiffres, un par élément, dans l'ordre de PORTRAIT_PARTS.
 *
 * Ces valeurs sont visibles par les autres joueurs : l'ensemble est fermé (le serveur n'accepte que des
 * combinaisons valides), donc aucun contenu libre à afficher ni à modérer.
 * Les comptes créés avant ce système ont un emoji en base : decodePortrait() leur attribue un portrait
 * déterministe, sans migration de données.
 *
 * Ce fichier existe en trois copies identiques (api, phone, admin) : à garder synchronisées.
 */

export const PORTRAIT_PARTS = [
  'skin',
  'hair',
  'hairColor',
  'face',
  'outfit',
  'outfitColor',
  'accessory',
  'motif',
] as const;
export type PortraitPart = (typeof PORTRAIT_PARTS)[number];

/** Nombre d'options par élément */
export const PORTRAIT_SIZES: Record<PortraitPart, number> = {
  skin: 6,
  hair: 8,
  hairColor: 7,
  face: 6,
  outfit: 6,
  outfitColor: 6,
  accessory: 6,
  motif: 6,
};

export const SKIN_TONES = ['#f2d6bd', '#e5b994', '#c98f66', '#a2694a', '#7a4a33', '#4e2f23'] as const;
export const HAIR_COLORS = ['#17120f', '#4a2f1d', '#8b5a2b', '#c8a24b', '#a8442a', '#9ea3a8', '#3b4f8a'] as const;
export const OUTFIT_COLORS = ['#2e3440', '#d9d4c7', '#8a3b2e', '#2f5d50', '#3d4f7a', '#c9a24a'] as const;

export const COLORS = ['violet', 'rose', 'rouge', 'orange', 'jaune', 'vert', 'cyan', 'bleu'] as const;
export type Color = (typeof COLORS)[number];
export const DEFAULT_COLOR: Color = 'violet';

export type PortraitSpec = Record<PortraitPart, number>;

export const DEFAULT_AVATAR = 'p:00000000';

export function encodePortrait(spec: PortraitSpec): string {
  return `p:${PORTRAIT_PARTS.map((part) => spec[part]).join('')}`;
}

/** Vrai si la valeur est un code de portrait complet et valide */
export function isAvatar(value: unknown): value is string {
  if (typeof value !== 'string' || !/^p:\d{8}$/.test(value)) return false;
  return PORTRAIT_PARTS.every((part, i) => Number(value[2 + i]) < PORTRAIT_SIZES[part]);
}
export const isColor = (value: unknown): value is Color => COLORS.includes(value as Color);

/** Hachage simple et stable (FNV-1a) pour attribuer un portrait aux anciennes valeurs */
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Décode un code ; toute autre valeur (ancien emoji, donnée vide) donne un portrait stable dérivé de cette valeur */
export function decodePortrait(code: string): PortraitSpec {
  if (isAvatar(code)) {
    const spec = {} as PortraitSpec;
    PORTRAIT_PARTS.forEach((part, i) => (spec[part] = Number(code[2 + i])));
    return spec;
  }
  let h = hash(code || 'anonyme');
  const spec = {} as PortraitSpec;
  for (const part of PORTRAIT_PARTS) {
    spec[part] = h % PORTRAIT_SIZES[part];
    h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
  }
  return spec;
}

export function randomPortrait(rnd: () => number = Math.random): string {
  const spec = {} as PortraitSpec;
  for (const part of PORTRAIT_PARTS) spec[part] = Math.floor(rnd() * PORTRAIT_SIZES[part]);
  return encodePortrait(spec);
}

export function withPart(code: string, part: PortraitPart, value: number): string {
  return encodePortrait({ ...decodePortrait(code), [part]: value });
}
