/**
 * Personnalisation du profil joueur : emoji + couleur.
 * Ces valeurs sont visibles par les autres joueurs, donc la liste est fermée
 * (aucune saisie libre à afficher, aucun risque de contenu inapproprié).
 */

export const AVATARS = [
  '🙂', '😎', '🤩', '🥳', '😺', '🐻', '🦊', '🐼',
  '🐨', '🐯', '🦁', '🐸', '🐙', '🦄', '🐧', '🦉',
  '🐬', '🦋', '🌵', '🍀', '🌻', '🍉', '🍕', '🍩',
  '⚽', '🎸', '🚀', '⭐', '🔥', '🎲', '🎯', '👾',
] as const;

export const COLORS = [
  'violet',
  'rose',
  'rouge',
  'orange',
  'jaune',
  'vert',
  'cyan',
  'bleu',
] as const;

export type Avatar = (typeof AVATARS)[number];
export type Color = (typeof COLORS)[number];

export const DEFAULT_AVATAR: Avatar = '🙂';
export const DEFAULT_COLOR: Color = 'violet';

export const isAvatar = (value: unknown): value is Avatar => AVATARS.includes(value as Avatar);
export const isColor = (value: unknown): value is Color => COLORS.includes(value as Color);
