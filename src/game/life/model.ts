import { CLASS_THRESHOLDS, type Capitals, type SocialClass, type Stage, type Tone } from '../protocol.js';

export type Track = 'general' | 'pro';
export type Bac = 'aucun' | 'pro' | 'general' | 'mention';
export type Cursus = 'prepa' | 'commerce' | 'licence' | 'court' | 'alternance' | 'cap' | 'aucun';
export type Diploma = 'aucun' | 'cap' | 'bts' | 'licence' | 'ecole_commerce' | 'master' | 'grande_ecole';
export type Job =
  | 'chomage'
  | 'ouvrier'
  | 'employe'
  | 'technicien'
  | 'cadre'
  | 'cadre_sup'
  | 'dirigeant'
  | 'entrepreneur';

export const BAC_LABEL: Record<Bac, string> = {
  aucun: 'Pas de bac',
  pro: 'Bac pro',
  general: 'Bac général',
  mention: 'Bac mention très bien',
};
export const DIPLOMA_LABEL: Record<Diploma, string> = {
  aucun: 'Sans diplôme du supérieur',
  cap: 'CAP',
  bts: 'BTS / BUT',
  licence: 'Licence',
  ecole_commerce: 'École de commerce',
  master: 'Master',
  grande_ecole: 'Grande école',
};
export const JOB_LABEL: Record<Job, string> = {
  chomage: 'Au chômage',
  ouvrier: 'Ouvrier·e',
  employe: 'Employé·e',
  technicien: 'Technicien·ne',
  cadre: 'Cadre',
  cadre_sup: 'Cadre supérieur·e',
  dirigeant: 'Dirigeant·e',
  entrepreneur: 'Entrepreneur·e',
};

/** Échelle des postes pour les promotions */
export const JOB_LADDER: Job[] = ['chomage', 'ouvrier', 'employe', 'technicien', 'cadre', 'cadre_sup', 'dirigeant'];

/** Épargne nette par tour de travail (salaire − dépenses) */
export const SALARY: Record<Job, number> = {
  chomage: -150,
  ouvrier: 200,
  employe: 350,
  technicien: 550,
  cadre: 900,
  cadre_sup: 1_800,
  dirigeant: 4_000,
  entrepreneur: 0, // variable : voir l'étape travail
};

const BAC_BONUS: Record<Bac, number> = { aucun: 0, pro: 4, general: 7, mention: 10 };
const DIPLOMA_BONUS: Record<Diploma, number> = {
  aucun: 0,
  cap: 5,
  bts: 12,
  licence: 15,
  ecole_commerce: 18,
  master: 24,
  grande_ecole: 30,
};

export interface LifePlayer {
  id: string;
  origin: SocialClass;
  cls: SocialClass;
  cap: Capitals;
  flags: Set<string>;
  track: Track;
  bac: Bac | null;
  cursus: Cursus | null;
  diploma: Diploma | null;
  job: Job | null;
  /** Augmentations cumulées (0.2 = +20 %) */
  raise: number;
  titles: string[];
  score: number;
  /** Score avant le dernier changement (tendance affichée à l'écran) */
  prevScore: number;
  /** Lieu de la scène où se trouve le joueur */
  place: string;
}

const START: Record<SocialClass, Capitals> = {
  basse: { money: 500, savoir: 38, reseau: 20, moral: 60 },
  moyenne: { money: 12_000, savoir: 52, reseau: 45, moral: 65 },
  riche: { money: 80_000, savoir: 60, reseau: 75, moral: 70 },
};

/** Part des dépenses d'études payée par la famille (lycée, université) */
export const FAMILY_SUPPORT: Record<SocialClass, number> = { basse: 0, moyenne: 0.5, riche: 1 };

export function newPlayer(id: string, origin: SocialClass, rnd: () => number): LifePlayer {
  const jitter = () => Math.round((rnd() - 0.5) * 8);
  const cap = { ...START[origin] };
  cap.savoir += jitter();
  cap.reseau = Math.max(0, cap.reseau + jitter());
  const p: LifePlayer = {
    id,
    origin,
    cls: origin,
    cap,
    flags: new Set(),
    track: 'general',
    bac: null,
    cursus: null,
    diploma: null,
    job: null,
    raise: 0,
    titles: [],
    score: 0,
    prevScore: 0,
    place: 'maison',
  };
  refresh(p);
  p.prevScore = p.score;
  return p;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const round1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Capital économique ramené sur 0-100, échelle logarithmique :
 * 300 € ≈ 6 · 3 000 € ≈ 30 · 10 000 € ≈ 52 · 30 000 € ≈ 75 · 100 000 € = 100. Les dettes comptent en négatif.
 */
export function economicScore(money: number): number {
  if (money < 0) return Math.max(-20, money / 1_000);
  return clamp(((Math.log10(money + 1_000) - 3) / 2) * 100, 0, 100);
}

export function culturalScore(p: LifePlayer): number {
  const bonus = Math.max(BAC_BONUS[p.bac ?? 'aucun'], DIPLOMA_BONUS[p.diploma ?? 'aucun']);
  return clamp(p.cap.savoir * 0.8 + bonus, 0, 100);
}

/** Position sociale : 45 % économique, 30 % culturel, 25 % social */
export function socialScore(p: LifePlayer): number {
  const s = 0.45 * economicScore(p.cap.money) + 0.3 * culturalScore(p) + 0.25 * p.cap.reseau;
  return round1(clamp(s, 0, 100));
}


export function classOf(score: number): SocialClass {
  if (score >= CLASS_THRESHOLDS.riche) return 'riche';
  if (score >= CLASS_THRESHOLDS.moyenne) return 'moyenne';
  return 'basse';
}

/** Applique des variations aux capitaux (bornées) et recalcule la position. */
export function applyDelta(p: LifePlayer, d: Partial<Capitals>): Capitals {
  const before = { ...p.cap };
  p.cap.money = Math.round(p.cap.money + (d.money ?? 0));
  p.cap.savoir = clamp(p.cap.savoir + diminishing(p.cap.savoir, d.savoir ?? 0), 0, 100);
  p.cap.reseau = clamp(p.cap.reseau + diminishing(p.cap.reseau, d.reseau ?? 0), 0, 100);
  p.cap.moral = clamp(p.cap.moral + (d.moral ?? 0), 0, 100);
  refresh(p);
  return {
    money: p.cap.money - before.money,
    savoir: p.cap.savoir - before.savoir,
    reseau: p.cap.reseau - before.reseau,
    moral: p.cap.moral - before.moral,
  };
}

/** Rendements décroissants : plus une compétence est haute, plus il est dur de la faire monter */
function diminishing(current: number, gain: number): number {
  if (gain <= 0) return gain;
  return Math.round(gain * clamp(1.15 - current / 85, 0.1, 1) * 10) / 10;
}

export function refresh(p: LifePlayer): void {
  p.score = socialScore(p);
  p.cls = classOf(p.score);
}

export const zeroCapitals = (): Capitals => ({ money: 0, savoir: 0, reseau: 0, moral: 0 });

export const sumCapitals = (a: Capitals, b: Capitals): Capitals => ({
  money: a.money + b.money,
  savoir: a.savoir + b.savoir,
  reseau: a.reseau + b.reseau,
  moral: a.moral + b.moral,
});

/** Probabilité de réussite : base + poids × (stat − 50), bornée 5-95 %, pénalisée si le moral est bas */
export function chance(p: LifePlayer, base: number, w: Partial<Record<'savoir' | 'reseau' | 'moral', number>> = {}) {
  let v = base;
  for (const [k, weight] of Object.entries(w) as ['savoir' | 'reseau' | 'moral', number][]) {
    v += weight * (p.cap[k] - 50);
  }
  if (p.cap.moral < 25) v -= 15;
  return clamp(v, 5, 95) / 100;
}

export const fmtMoney = (n: number) => `${n < 0 ? '−' : ''}${Math.abs(Math.round(n)).toLocaleString('fr-FR')} €`;

// ---------------------------------------------------------------- Contenu

export interface Outcome {
  text: string;
  d?: Partial<Capitals>;
  tone?: Tone;
  /** Message pour le fil de l'écran projeté ({name} = nom du joueur) */
  feed?: string;
  /** Modifications d'état (cursus, emploi, drapeaux…) */
  apply?: (p: LifePlayer) => void;
}

export interface Ctx {
  /** Tire au sort avec la probabilité donnée */
  roll: (probability: number) => boolean;
  rnd: () => number;
}

export interface Option {
  id: string;
  emoji: string;
  label: string;
  /** Indication affichée (le coût est ajouté automatiquement) */
  hint?: string;
  /** Coût en euros (pris en charge par la famille au lycée et à l'université selon la classe d'origine) */
  cost?: number;
  /** Option masquée pour ce joueur */
  show?: (p: LifePlayer) => boolean;
  /** Raison du blocage, ou null si accessible */
  requires?: (p: LifePlayer) => string | null;
  /** Option appliquée quand le joueur ne répond pas */
  fallback?: boolean;
  resolve: (p: LifePlayer, ctx: Ctx) => Outcome;
}

/** Activité d'un lieu : elle prend du temps, puis ses effets s'appliquent */
export interface Action {
  id: string;
  place: string;
  emoji: string;
  label: string;
  /** Durée en secondes */
  seconds: number;
  hint?: string;
  /** Coût en euros, payé au lancement (famille selon la classe d'origine, hors monde du travail) */
  cost?: number;
  show?: (p: LifePlayer) => boolean;
  requires?: (p: LifePlayer) => string | null;
  resolve: (p: LifePlayer, ctx: Ctx) => Outcome;
}

export interface Situation {
  id: string;
  stage: Stage;
  emoji: string;
  title: string;
  text: string;
  options: Option[];
}
