/**
 * Les moments de résultats : bac (J7), diplômes (J10), premier emploi (J11), classe finale (J12),
 * et les chiffres de la partie par classe d'origine (exposé, étape 20).
 */
import type { SocialClass, StatLine, Tone } from '../protocol.js';
import { SOCIAL_CLASSES } from '../protocol.js';
import {
  DIPLOMA_LABEL,
  DIPLOMA_LEVEL,
  FAMILY_GIFT,
  JOB_LABEL,
  JOB_TIER,
  clamp,
  fmtGrade,
  fmtMoney,
  round1,
  type Character,
  type Diploma,
  type Job,
} from './model.js';

const ORDER: Record<SocialClass, number> = { populaire: 0, moyenne: 1, superieure: 2 };
const BY_ORDER: SocialClass[] = ['populaire', 'moyenne', 'superieure'];

export interface PersonalOutcome {
  emoji: string;
  title: string;
  text: string;
  tone: Tone;
}

// ================================================================= Bac

/** Note du bac = moyenne de Première et de Terminale ; rattrapage entre 8 et 10 */
export function computeBac(c: Character, roll: (p: number) => boolean): PersonalOutcome {
  const premiere = c.grades[1] ?? c.grade;
  const terminale = c.grades[2] ?? c.grade;
  const note = round1((premiere + terminale) / 2);
  c.bacGrade = note;
  if (c.track === 'pro') {
    if (note >= 9) {
      c.bac = 'pro';
      c.mention = null;
      c.path.push({ year: 'Bac', kind: 'title', text: 'Bac professionnel' });
      return { emoji: '🎓', title: 'Bac pro obtenu', text: `Note : ${fmtGrade(note)}/20. BTS, BUT et alternance te sont ouverts.`, tone: 'good' };
    }
    c.bac = 'aucun';
    c.path.push({ year: 'Bac', kind: 'close', text: 'Bac pro manqué' });
    return { emoji: '📄', title: 'Bac pro manqué', text: `Note : ${fmtGrade(note)}/20 (il fallait 9). Direction la vie active.`, tone: 'bad' };
  }
  let passed = note >= 10;
  let rattrapage = false;
  if (!passed && note >= 8) {
    rattrapage = true;
    passed = roll(c.energy >= 1 ? 0.7 : 0.4);
  }
  if (!passed) {
    c.bac = 'aucun';
    c.path.push({ year: 'Bac', kind: 'close', text: rattrapage ? 'Bac raté au rattrapage' : 'Bac raté' });
    return {
      emoji: '📄',
      title: rattrapage ? 'Rattrapage raté' : 'Bac raté',
      text: `Note : ${fmtGrade(note)}/20. ${rattrapage ? 'Trop fatigué·e pour l’oral.' : 'Il fallait 8 pour le rattrapage.'} Direction la vie active.`,
      tone: 'bad',
    };
  }
  c.bac = 'general';
  c.mention = rattrapage ? null : note >= 16 ? 'Très bien' : note >= 14 ? 'Bien' : note >= 12 ? 'Assez bien' : null;
  c.path.push({ year: 'Bac', kind: 'title', text: c.mention ? `Bac mention ${c.mention}` : rattrapage ? 'Bac au rattrapage' : 'Bac' });
  return {
    emoji: c.mention ? '🏅' : '🎓',
    title: c.mention ? `Bac mention ${c.mention}` : rattrapage ? 'Bac obtenu au rattrapage !' : 'Bac obtenu',
    text: `Note : ${fmtGrade(note)}/20 (moyenne de Première et Terminale). Parcoursup t’attend.`,
    tone: 'good',
  };
}

// ================================================================= Diplômes

export function computeDiploma(c: Character): PersonalOutcome {
  const g = c.grade;
  let d: Diploma;
  let text: string;
  switch (c.formation) {
    case 'prepa':
      d = g >= 12 ? 'grande_ecole' : 'licence';
      text = g >= 12 ? 'Concours réussi : diplôme de grande école.' : 'Concours manqués : équivalence de licence.';
      break;
    case 'iep':
      d = g >= 10 ? 'master' : 'licence';
      text = g >= 10 ? 'Master de Sciences Po.' : 'Tu sors avec une licence.';
      break;
    case 'ecole':
      d = g >= 8 ? 'ecole' : 'bac';
      text = g >= 8 ? 'Diplôme d’école de commerce (bac+5) : il fallait surtout pouvoir payer.' : 'Tu quittes l’école sans diplôme.';
      break;
    case 'licence':
      if (g < 10) {
        d = 'bac';
        text = 'Abandon en cours de licence : tu restes avec le bac.';
        c.path.push({ year: 'Diplômes', kind: 'close', text: 'Abandon de licence' });
      } else if (c.masterTrack && g >= 12) {
        d = 'master';
        text = 'Master obtenu : bac+5.';
      } else {
        d = 'licence';
        text = c.masterTrack ? 'Licence en poche, mais le master t’échappe (moins de 12).' : 'Licence en poche : bac+3.';
      }
      break;
    case 'but':
      d = g >= 10 ? 'but' : 'bac';
      text = g >= 10 ? 'BUT obtenu : bac+3.' : 'BUT non validé.';
      break;
    case 'bts':
    case 'alternance':
      d = g >= 9 ? 'bts' : 'bac';
      text = g >= 9 ? 'BTS obtenu : bac+2.' : 'BTS non validé.';
      if (c.formation === 'alternance') {
        c.contacts = clamp(c.contacts + 2, 0, 10);
        text += ' L’alternance t’a fait +2 contacts.';
      }
      break;
    default:
      d = c.bac && c.bac !== 'aucun' ? 'bac' : 'aucun';
      text = d === 'bac' ? 'Pas d’études supérieures : tu entres dans la vie active avec le bac.' : 'Pas de diplôme : la recherche d’emploi sera dure.';
  }
  c.diploma = d;
  if (DIPLOMA_LEVEL[d] >= 2) c.path.push({ year: 'Diplômes', kind: 'title', text: DIPLOMA_LABEL[d] });
  const level = DIPLOMA_LEVEL[d];
  return {
    emoji: level >= 5 ? '🎓' : level >= 2 ? '📜' : '📄',
    title: DIPLOMA_LABEL[d],
    text,
    tone: level >= 3 ? 'good' : level >= 2 ? 'neutral' : 'bad',
  };
}

// ================================================================= Premier emploi

export interface Tier {
  id: Job;
  label: string;
  /** Part des postes (null = le reste / non limité) */
  share: number | null;
  public: boolean;
}

export const TIERS: Tier[] = [
  { id: 'chef', label: JOB_LABEL.chef, share: null, public: false },
  { id: 'cadre', label: JOB_LABEL.cadre, share: 0.22, public: false },
  { id: 'fonction_a', label: JOB_LABEL.fonction_a, share: 0.06, public: true },
  { id: 'intermediaire', label: JOB_LABEL.intermediaire, share: 0.33, public: false },
  { id: 'fonction_b', label: JOB_LABEL.fonction_b, share: 0.08, public: true },
  { id: 'fonction_c', label: JOB_LABEL.fonction_c, share: 0.08, public: true },
  { id: 'employe', label: JOB_LABEL.employe, share: 0.25, public: false },
  { id: 'ouvrier', label: JOB_LABEL.ouvrier, share: null, public: false },
  { id: 'chomage', label: JOB_LABEL.chomage, share: null, public: false },
];

const level = (c: Character) => DIPLOMA_LEVEL[c.diploma ?? 'aucun'];

/** Accès à un poste (null = accessible, sinon la raison) */
export function jobAccess(c: Character, job: Job): string | null {
  const l = level(c);
  switch (job) {
    case 'cadre':
      return l >= 5 || (l >= 3 && c.contacts >= 7) ? null : 'Il faut un bac+5, ou un bac+3 et 7 contacts';
    case 'fonction_a':
      return l >= 3 && c.grade >= 12.5 ? null : 'Concours A : bac+3 et 12,5 de moyenne';
    case 'intermediaire':
      return l >= 2 ? null : 'Il faut un bac+2';
    case 'fonction_b':
      return l >= 2 && c.grade >= 11 ? null : 'Concours B : bac+2 et 11 de moyenne';
    case 'fonction_c':
      return l >= 1 && c.grade >= 9.5 ? null : 'Concours C : le bac et 9,5 de moyenne';
    case 'employe':
      return l >= 1 ? null : 'Il faut le bac';
    default:
      return null;
  }
}

export function employability(c: Character, addressEffect: boolean): number {
  const prestige = c.diploma === 'grande_ecole' ? 0.08 : c.formation === 'iep' && c.diploma === 'master' ? 0.06 : c.diploma === 'ecole' ? 0.05 : 0;
  let e = 0.45 * (level(c) / 5) + 0.3 * (c.contacts / 10) + 0.15 * clamp((c.grade - 8) / 10, 0, 1) + prestige + (c.promise ? 0.1 : 0);
  if (addressEffect && c.school === 'quartier') e -= 0.04;
  return Math.round(e * 1000) / 1000;
}

/** Poste garanti par une promesse d'embauche */

export type Strategy = 'haut' | 'premier' | 'concours' | 'promesse' | 'entreprise';

export const STRATEGIES: { id: Strategy; emoji: string; label: string; hint: string }[] = [
  { id: 'haut', emoji: '🎯', label: 'Viser le plus haut', hint: 'Le meilleur poste encore libre auquel tu as accès · un refus est possible' },
  { id: 'premier', emoji: '🤝', label: 'Accepter le premier poste', hint: 'Un cran en dessous, presque sûr' },
  { id: 'concours', emoji: '📝', label: 'Passer un concours', hint: 'Fonction publique : seule ta moyenne compte, places à part' },
  { id: 'promesse', emoji: '🔑', label: 'Faire jouer ta promesse d’embauche', hint: 'Poste garanti' },
  { id: 'entreprise', emoji: '🚀', label: 'Créer ton entreprise', hint: '15 000 € d’apport (le don familial compte)' },
];

export function strategyLock(c: Character, s: Strategy): string | null {
  if (s === 'promesse') return c.promise ? null : 'Tu n’as pas de promesse d’embauche';
  if (s === 'entreprise') return c.budget >= 15_000 ? null : `Il faut 15 000 € (tu as ${fmtMoney(c.budget)})`;
  if (s === 'concours') return (['fonction_a', 'fonction_b', 'fonction_c'] as Job[]).some((j) => !jobAccess(c, j)) ? null : 'Il faut au moins le bac et 9,5 de moyenne';
  return null;
}

export const defaultStrategy = (c: Character): Strategy => (c.promise ? 'promesse' : 'premier');

/** Le don familial arrive à l'entrée dans la vie active */
export function giveFamilyGift(c: Character) {
  const gift = FAMILY_GIFT[c.origin];
  if (gift) c.budget += gift;
  return gift;
}

/**
 * Marché de l'emploi : postes limités, candidats traités par employabilité décroissante.
 * Renvoie le texte personnel de chacun.
 */
export function jobMarket(
  chars: Character[],
  strategies: Map<string, Strategy>,
  opts: { addressEffect: boolean; roll: (p: number) => boolean; rnd: () => number },
): Map<string, PersonalOutcome> {
  const n = chars.length;
  const seats = new Map<Job, number>();
  for (const t of TIERS) if (t.share !== null) seats.set(t.id, Math.max(1, Math.round(t.share * n)));
  const take = (j: Job) => {
    const s = seats.get(j);
    if (s === undefined) return true;
    if (s <= 0) return false;
    seats.set(j, s - 1);
    return true;
  };
  const free = (j: Job) => (seats.get(j) ?? 1) > 0;
  const out = new Map<string, PersonalOutcome>();
  const assign = (c: Character, job: Job, text: string, forced?: Tone) => {
    // Couleur du résultat : par rapport à la classe d'origine (monter, rester, descendre)
    const tone: Tone = forced ?? (ORDER[JOB_TIER[job]] > ORDER[c.origin] ? 'good' : ORDER[JOB_TIER[job]] < ORDER[c.origin] ? 'bad' : 'neutral');
    c.job = job;
    c.jobYears = 0;
    c.path.push({ year: 'Premier emploi', kind: job === 'chomage' ? 'close' : 'title', text: JOB_LABEL[job] });
    out.set(c.id, { emoji: job === 'chomage' ? '📉' : job === 'chef' ? '🚀' : job.startsWith('fonction') ? '🏛️' : '💼', title: JOB_LABEL[job], text, tone });
  };
  const emp = new Map(chars.map((c) => [c.id, employability(c, opts.addressEffect)]));
  const pending: Character[] = [];

  // 1. Promesses d'embauche : un poste garanti, le meilleur encore libre (les mieux classés d'abord)
  const ordered = [...chars].sort((a, b) => employability(b, opts.addressEffect) - employability(a, opts.addressEffect));
  for (const c of ordered) {
    const s = strategies.get(c.id) ?? defaultStrategy(c);
    if (s === 'promesse' && c.promise) {
      const j = (['cadre', 'intermediaire', 'employe'] as Job[]).find((x) => !jobAccess(c, x) && free(x)) ?? 'ouvrier';
      take(j);
      assign(c, j, 'Ta promesse d’embauche se concrétise : tu signes dès la sortie.');
    } else if (s === 'entreprise' && c.budget >= 15_000) {
      if (opts.roll(clamp(0.35 + c.contacts * 0.04 + c.engagement * 0.03, 0.2, 0.85))) {
        c.budget += 10_000;
        assign(c, 'chef', 'Ton entreprise décolle : te voilà chef·fe d’entreprise.');
      } else {
        c.budget -= 15_000;
        c.path.push({ year: 'Premier emploi', kind: 'event', text: 'Faillite' });
        pending.push(c);
        out.set(c.id, { emoji: '💥', title: 'Faillite', text: 'Ton entreprise ferme : −15 000 €. Tu cherches un poste.', tone: 'bad' });
      }
    } else pending.push(c);
  }

  // 2. Concours : seule la moyenne compte, places à part
  const concours = pending.filter((c) => strategies.get(c.id) === 'concours').sort((a, b) => b.grade - a.grade);
  const rest: Character[] = pending.filter((c) => strategies.get(c.id) !== 'concours');
  for (const c of concours) {
    const j = (['fonction_a', 'fonction_b', 'fonction_c'] as Job[]).find((x) => !jobAccess(c, x) && free(x));
    if (j && take(j)) assign(c, j, `Concours réussi grâce à ta moyenne (${fmtGrade(c.grade)}) : ${JOB_LABEL[j]}.`);
    else {
      out.set(c.id, { emoji: '📝', title: 'Concours manqué', text: 'Plus de place au concours : tu cherches dans le privé.', tone: 'bad' });
      rest.push(c);
    }
  }

  // 3. Les autres, par employabilité décroissante : les mieux classés choisissent d'abord
  const privateOrder: Job[] = ['cadre', 'intermediaire', 'employe', 'ouvrier'];
  rest.sort((a, b) => emp.get(b.id)! - emp.get(a.id)!);
  for (const c of rest) {
    const s = strategies.get(c.id) ?? defaultStrategy(c);
    const reachable = privateOrder.filter((j) => !jobAccess(c, j) && free(j));
    let target = reachable[0] ?? 'ouvrier';
    let note = '';
    if (s === 'haut') {
      if (!opts.roll(0.8)) {
        target = reachable[1] ?? 'ouvrier';
        note = 'Refusé·e au dernier entretien, tu te rabats sur le poste suivant.';
      }
    } else {
      // « Accepter le premier poste » : un cran en dessous, presque sûr
      target = reachable[1] ?? reachable[0] ?? 'ouvrier';
    }
    // Sans diplôme, le chômage guette (F8 : 42,4 % sans diplôme)
    const l = level(c);
    const risk = l === 0 ? 0.42 : l === 1 ? 0.15 : 0.05;
    if ((target === 'ouvrier' || target === 'employe') && opts.roll(risk * (s === 'premier' ? 0.6 : 1))) {
      assign(c, 'chomage', 'Aucune réponse à tes candidatures : tu commences au chômage.', 'bad');
      continue;
    }
    take(target);
    const prev = out.get(c.id);
    assign(c, target, `${prev ? prev.text + ' ' : ''}${note || `Classé·e ${rest.indexOf(c) + 1}ᵉ sur ${rest.length} : ${JOB_LABEL[target]}.`}`);
  }
  return out;
}

// ================================================================= Classe finale (J12)

export interface FinalOutcome {
  cls: SocialClass;
  ascending: boolean;
}

export function finalClass(c: Character): FinalOutcome {
  let o = ORDER[JOB_TIER[c.job ?? 'chomage']];
  // Patrimoine : +1 cran à partir de 60 000 € · −1 cran au-delà de 15 000 € de dette
  if (c.budget >= 60_000) o++;
  if (c.budget < -15_000) o--;
  o = clamp(o, 0, 2);
  let ascending = false;
  // Consolidation : pour monter au-dessus de sa classe d'origine, il faut avoir tenu ce poste les deux périodes
  if (o > ORDER[c.origin] && c.jobYears < 2) {
    o--;
    ascending = true;
  }
  // Filet familial : un enfant de classe supérieure ne descend jamais sous la classe moyenne
  if (c.origin === 'superieure') o = Math.max(o, 1);
  return { cls: BY_ORDER[o]!, ascending };
}

export const compareFinal = (a: { c: Character; f: FinalOutcome }, b: { c: Character; f: FinalOutcome }) =>
  ORDER[b.f.cls] - ORDER[a.f.cls] || b.c.budget - a.c.budget || level(b.c) - level(a.c);

export const moveOf = (origin: SocialClass, cls: SocialClass) => ORDER[cls] - ORDER[origin];

// ================================================================= Chiffres de la partie

const pct = (list: Character[], pred: (c: Character) => boolean) => (list.length ? Math.round((list.filter(pred).length / list.length) * 100) : 0);
const avg = (list: Character[], f: (c: Character) => number) => (list.length ? list.reduce((s, c) => s + f(c), 0) / list.length : 0);

export function statLines(chars: Character[], finals: Map<string, FinalOutcome>): StatLine[] {
  const by = Object.fromEntries(SOCIAL_CLASSES.map((s) => [s, chars.filter((c) => c.origin === s)])) as Record<SocialClass, Character[]>;
  const line = (label: string, unit: StatLine['unit'], f: (list: Character[]) => number, real: string | null = null): StatLine => ({
    label,
    unit,
    real,
    values: Object.fromEntries(SOCIAL_CLASSES.map((s) => [s, f(by[s])])) as Record<SocialClass, number>,
  });
  return [
    line('N’ont jamais vu la prépa', '%', (l) => pct(l, (c) => c.stats.hiddenSelective), null),
    line('Bac avec mention', '%', (l) => pct(l, (c) => !!c.mention), null),
    line('Formation sélective (prépa, IEP, école)', '%', (l) => pct(l, (c) => c.formation === 'prepa' || c.formation === 'iep' || c.formation === 'ecole'), 'Accès : écart de ×2 à ×4'),
    line('Jetons de job imposés (moyenne)', '', (l) => round1(avg(l, (c) => c.stats.forcedJobs))),
    line('Diplômé·e d’un bac+5', '%', (l) => pct(l, (c) => DIPLOMA_LEVEL[c.diploma ?? 'aucun'] >= 5), 'Réel : 48 % (cadres) / 10 % (modestes)'),
    line('Cadre ou chef·fe d’entreprise', '%', (l) => pct(l, (c) => c.job === 'cadre' || c.job === 'chef' || c.job === 'fonction_a'), 'Réel : ×3,1 pour un fils de cadre'),
    line('Ont monté d’une classe ou plus', '%', (l) => pct(l, (c) => moveOf(c.origin, finals.get(c.id)?.cls ?? c.origin) > 0), 'Réel : 26 % des fils d’ouvrier'),
    line('Patrimoine moyen', '€', (l) => Math.round(avg(l, (c) => c.budget))),
  ];
}

export { JOB_LABEL, DIPLOMA_LABEL };
