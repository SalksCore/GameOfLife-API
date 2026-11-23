import type { PathItem, SocialClass, Tone } from '../protocol.js';

/**
 * Modèle V2 : un personnage vit lycée -> études -> vie active.
 * Les unités sont celles de la vraie vie : moyenne /20, contacts, énergie, budget en euros.
 * Le patrimoine familial n'est pas l'argent du joueur : il agit comme aide et comme filet de sécurité.
 */

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
export const round1 = (v: number) => Math.round(v * 10) / 10;
export const fmtMoney = (n: number) => `${n < 0 ? '−' : ''}${Math.abs(Math.round(n)).toLocaleString('fr-FR')} €`;
export const fmtGrade = (g: number) => g.toFixed(1).replace('.', ',');

// ---------------------------------------------------------------- Famille

/** Part des dépenses d'études payée par la famille */
export const FAMILY_SUPPORT: Record<SocialClass, number> = { populaire: 0, moyenne: 0.5, superieure: 1 };
/** Part d'un « coup dur » absorbée par la famille (filet de sécurité) */
export const FAMILY_SAFETY: Record<SocialClass, number> = { populaire: 0, moyenne: 0.5, superieure: 1 };
/** Aide aux devoirs : efficacité d'un jeton de travail scolaire */
export const HOME_HELP: Record<SocialClass, number> = { populaire: 0.8, moyenne: 1, superieure: 1.2 };
/** Donation à l'entrée dans la vie active (apport, logement) */
export const FAMILY_GIFT: Record<SocialClass, number> = { populaire: 0, moyenne: 8_000, superieure: 40_000 };
export const FAMILY_LABEL: Record<SocialClass, string> = {
  populaire: 'Parents ouvrier et employée : pas d’aide financière possible',
  moyenne: 'Parents technicien et infirmière : ils paient la moitié de tes études',
  superieure: 'Parents cadres supérieurs : ils financent tout et connaissent du monde',
};
/** Lettre de motivation : aide reçue pour la rédiger */
export const LETTER_HELP: Record<SocialClass, number> = { populaire: 0.45, moyenne: 0.75, superieure: 1 };

// ---------------------------------------------------------------- Lycées

export type SchoolId = 'quartier' | 'centre' | 'prive' | 'elite';
export const SCHOOLS: Record<SchoolId, { name: string; reputation: number; gradeBonus: number }> = {
  quartier: { name: 'Lycée de secteur (quartier)', reputation: 0, gradeBonus: 0 },
  centre: { name: 'Lycée de centre-ville', reputation: 1, gradeBonus: 0.05 },
  prive: { name: 'Lycée privé sous contrat', reputation: 2, gradeBonus: 0.2 },
  elite: { name: 'Lycée privé d’élite', reputation: 3, gradeBonus: 0.35 },
};
/** Lycée de secteur selon le lieu de vie de la famille */
export const SECTOR_SCHOOL: Record<SocialClass, SchoolId> = { populaire: 'quartier', moyenne: 'centre', superieure: 'centre' };

// ---------------------------------------------------------------- Formations (Parcoursup)

export type Specialty = 'sciences' | 'ses' | 'arts' | 'pro';
export type FormationId = 'prepa' | 'prepa_privee' | 'iep' | 'ecole' | 'licence' | 'but' | 'bts' | 'alternance';

export interface Formation {
  id: FormationId;
  label: string;
  emoji: string;
  /** Part des personnages de la partie (places) */
  share: number;
  selective: boolean;
  /** Visible seulement si l'on a été informé (orientation, Cordées, réseau…) */
  needsInfo: boolean;
  /** Formation publique sélective : quota de boursiers */
  quota: boolean;
  needsGeneralBac: boolean;
  /** Coût annuel (frais + logement), avant aide familiale et bourse */
  cost: number;
  /** Adéquation des spécialités (0-1) */
  fit: Record<Specialty, number>;
  hint: string;
}

export const FORMATIONS: Record<FormationId, Formation> = {
  prepa: { id: 'prepa', label: 'Classe prépa publique (puis grande école)', emoji: '🏛️', share: 0.09, selective: true, needsInfo: true, quota: true, needsGeneralBac: true, cost: 4_000, fit: { sciences: 1, ses: 0.9, arts: 0.3, pro: 0 }, hint: 'Très sélectif · gratuit, logement à payer' },
  prepa_privee: { id: 'prepa_privee', label: 'Classe prépa privée (puis grande école)', emoji: '🏰', share: 0.05, selective: true, needsInfo: true, quota: false, needsGeneralBac: true, cost: 12_000, fit: { sciences: 1, ses: 0.9, arts: 0.3, pro: 0 }, hint: '≈ 8 000 € de frais par an + logement · pas de quota' },
  iep: { id: 'iep', label: 'Sciences Po / IEP', emoji: '🎓', share: 0.07, selective: true, needsInfo: true, quota: true, needsGeneralBac: true, cost: 6_500, fit: { sciences: 0.7, ses: 1, arts: 0.6, pro: 0 }, hint: 'Très sélectif · frais selon les revenus' },
  ecole: { id: 'ecole', label: 'École de commerce privée post-bac', emoji: '💼', share: 0.12, selective: true, needsInfo: false, quota: false, needsGeneralBac: true, cost: 11_000, fit: { sciences: 0.8, ses: 1, arts: 0.7, pro: 0.3 }, hint: '≈ 9 000 € de frais par an + logement' },
  licence: { id: 'licence', label: 'Licence à l’université', emoji: '📚', share: 0.5, selective: false, needsInfo: false, quota: false, needsGeneralBac: true, cost: 4_000, fit: { sciences: 1, ses: 1, arts: 1, pro: 0.4 }, hint: 'Peu sélective · beaucoup d’abandons en 1ʳᵉ année' },
  but: { id: 'but', label: 'BUT (IUT)', emoji: '🛠️', share: 0.16, selective: true, needsInfo: false, quota: true, needsGeneralBac: false, cost: 3_000, fit: { sciences: 1, ses: 1, arts: 0.7, pro: 0.6 }, hint: 'Sélectif · encadré' },
  bts: { id: 'bts', label: 'BTS', emoji: '🧰', share: 0.2, selective: true, needsInfo: false, quota: false, needsGeneralBac: false, cost: 2_000, fit: { sciences: 0.7, ses: 0.7, arts: 0.7, pro: 1 }, hint: 'Places réservées aux bacs pros' },
  alternance: { id: 'alternance', label: 'BTS en alternance (payé)', emoji: '🔁', share: 0.12, selective: true, needsInfo: false, quota: false, needsGeneralBac: false, cost: -7_000, fit: { sciences: 0.8, ses: 0.8, arts: 0.8, pro: 1 }, hint: 'Salarié · il faut trouver une entreprise' },
};
export const FORMATION_IDS = Object.keys(FORMATIONS) as FormationId[];

// ---------------------------------------------------------------- Diplômes et emplois

export type Diploma = 'aucun' | 'bac' | 'bts' | 'but' | 'licence' | 'ecole' | 'master' | 'grande_ecole';
export const DIPLOMA_LABEL: Record<Diploma, string> = {
  aucun: 'Sans diplôme',
  bac: 'Baccalauréat',
  bts: 'BTS',
  but: 'BUT',
  licence: 'Licence',
  ecole: 'Diplôme d’école de commerce',
  master: 'Master',
  grande_ecole: 'Diplôme de grande école',
};
/** Niveau du diplôme : 0 (aucun) à 5 (bac+5) */
export const DIPLOMA_LEVEL: Record<Diploma, number> = { aucun: 0, bac: 1, bts: 2, but: 3, licence: 3, ecole: 5, master: 5, grande_ecole: 5 };

export type Job = 'chomage' | 'ouvrier' | 'employe' | 'intermediaire' | 'cadre' | 'chef' | 'fonction_a' | 'fonction_b' | 'fonction_c';
export const JOB_LABEL: Record<Job, string> = {
  chomage: 'Au chômage',
  ouvrier: 'Ouvrier·e',
  employe: 'Employé·e',
  intermediaire: 'Profession intermédiaire',
  cadre: 'Cadre',
  chef: 'Chef·fe d’entreprise',
  fonction_a: 'Fonctionnaire de catégorie A',
  fonction_b: 'Fonctionnaire de catégorie B',
  fonction_c: 'Fonctionnaire de catégorie C',
};
/** Classe sociale associée à l'emploi (inspirée des groupes socioprofessionnels de l'INSEE) */
export const JOB_TIER: Record<Job, SocialClass> = {
  chomage: 'populaire',
  ouvrier: 'populaire',
  employe: 'populaire',
  fonction_c: 'populaire',
  intermediaire: 'moyenne',
  fonction_b: 'moyenne',
  cadre: 'superieure',
  chef: 'superieure',
  fonction_a: 'superieure',
};
/** Épargne nette par année de vie active */
export const SAVINGS: Record<Job, number> = {
  chomage: -2_000,
  ouvrier: 1_800,
  employe: 2_000,
  fonction_c: 2_200,
  intermediaire: 4_500,
  fonction_b: 4_200,
  cadre: 9_000,
  fonction_a: 7_500,
  chef: 12_000,
};

// ---------------------------------------------------------------- Personnage

export type Track = 'generale' | 'pro';
export type BacResult = 'aucun' | 'pro' | 'general';

export interface Character {
  /** Identifiant = joueur principal (binôme : le premier des deux) */
  id: string;
  members: string[];
  origin: SocialClass;
  school: SchoolId;
  track: Track;
  specialty: Specialty | null;
  /** Moyennes successives (une par année jouée) */
  grades: number[];
  grade: number;
  contacts: number;
  energy: number;
  budget: number;
  /** A eu accès à l'information sur les filières sélectives */
  info: boolean;
  cordees: boolean;
  boursier: boolean;
  /** Qualité de la lettre de motivation (0-1) */
  letter: number;
  engagement: number;
  bac: BacResult | null;
  mention: string | null;
  /** Moyenne retenue pour le bac et Parcoursup */
  bacGrade: number;
  formation: FormationId | 'vie_active' | null;
  housing: 'parents' | 'crous' | 'coloc' | 'studio' | 'internat';
  failedYear: boolean;
  masterTrack: boolean;
  diploma: Diploma | null;
  promise: boolean;
  job: Job | null;
  /** Années consécutives dans la classe de l'emploi actuel */
  jobYears: number;
  performance: number;
  homeOwner: boolean;
  path: PathItem[];
  /** Statistiques pour l'exposé */
  stats: { refusedMoney: number; hiddenSelective: boolean; askedBourse: boolean; forcedJobs: number };
  /** Saisies de l'année en cours */
  tokens: Record<string, number>;
  choice: string | null;
  /** Mini-jeu de l'année : élément -> option */
  mini: Record<string, string>;
  done: boolean;
  report: { title: string; grade: number; before: number; appreciation: string; lines: { emoji: string; text: string; tone: Tone }[] } | null;
  outcome: { title: string; text: string; tone: Tone } | null;
  flash: { text: string; until: number } | null;
}

const START: Record<SocialClass, { grade: number; contacts: number; budget: number }> = {
  populaire: { grade: 10.6, contacts: 1, budget: 100 },
  moyenne: { grade: 11.4, contacts: 3, budget: 400 },
  superieure: { grade: 12.2, contacts: 5, budget: 1_500 },
};

export function newCharacter(id: string, members: string[], origin: SocialClass, rnd: () => number): Character {
  const s = START[origin];
  const grade = round1(s.grade + (rnd() - 0.5) * 1.6);
  return {
    id,
    members,
    origin,
    school: SECTOR_SCHOOL[origin],
    track: 'generale',
    specialty: null,
    grades: [],
    grade,
    contacts: s.contacts,
    energy: 4,
    budget: s.budget,
    info: origin !== 'populaire',
    cordees: false,
    boursier: false,
    letter: LETTER_HELP[origin],
    engagement: 0,
    bac: null,
    mention: null,
    bacGrade: grade,
    formation: null,
    housing: 'parents',
    failedYear: false,
    masterTrack: false,
    diploma: null,
    promise: false,
    job: null,
    jobYears: 0,
    performance: 0,
    homeOwner: false,
    path: [],
    stats: { refusedMoney: 0, hiddenSelective: false, askedBourse: false, forcedJobs: 0 },
    tokens: {},
    choice: null,
    mini: {},
    done: false,
    report: null,
    outcome: null,
    flash: null,
  };
}

/** Somme payée par le joueur après l'aide de sa famille (études) */
export const familyShare = (c: Character, cost: number) => Math.round(cost * (1 - FAMILY_SUPPORT[c.origin]));

/** Trajectoire estimée, affichée pendant la partie */
export function trendOf(c: Character): 'up' | 'flat' | 'down' {
  if (c.job) {
    const tier = JOB_TIER[c.job];
    const order = { populaire: 0, moyenne: 1, superieure: 2 };
    return order[tier] > order[c.origin] ? 'up' : order[tier] < order[c.origin] ? 'down' : 'flat';
  }
  if (c.diploma) return DIPLOMA_LEVEL[c.diploma] >= 5 ? (c.origin === 'superieure' ? 'flat' : 'up') : DIPLOMA_LEVEL[c.diploma] <= 1 ? (c.origin === 'populaire' ? 'flat' : 'down') : c.origin === 'superieure' ? 'down' : c.origin === 'populaire' ? 'up' : 'flat';
  if (c.grade >= 13.5) return c.origin === 'superieure' ? 'flat' : 'up';
  if (c.grade < 9) return c.origin === 'populaire' ? 'flat' : 'down';
  return 'flat';
}

export function statusOf(c: Character, yearLabel: string | null): string {
  if (c.job) return JOB_LABEL[c.job];
  if (c.formation && c.formation !== 'vie_active') return FORMATIONS[c.formation].label;
  if (c.formation === 'vie_active') return 'Dans la vie active';
  return yearLabel ? `Lycéen·ne, ${yearLabel}` : 'Lycéen·ne';
}
