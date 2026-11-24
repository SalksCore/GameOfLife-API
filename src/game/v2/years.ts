/**
 * Les années de jeu : temps à répartir (jetons), décision de l'année, coups du sort.
 *
 * Les inégalités sont des mécanismes visibles :
 * - aide aux devoirs : un jeton de travail rapporte plus quand les parents peuvent aider ;
 * - temps contraint : aider sa famille ou financer ses études prend des jetons ;
 * - argent : certaines options coûtent, la famille paie tout, la moitié ou rien ;
 * - réseau : dérogation, stage, piston, avis du conseil de classe contesté ;
 * - information : les filières sélectives restent invisibles tant qu'on n'en a pas entendu parler.
 */
import type { PathItem, ReportLine, Stage, TokenCategory } from '../protocol.js';
import {
  DIPLOMA_LABEL,
  DIPLOMA_LEVEL,
  FAMILY_SAFETY,
  FORMATIONS,
  HOME_HELP,
  JOB_LABEL,
  JOB_TIER,
  SAVINGS,
  SCHOOLS,
  clamp,
  familyShare,
  fmtGrade,
  fmtMoney,
  round1,
  type Character,
  type Diploma,
  type Job,
} from './model.js';

export type ReformId = 'bourses' | 'quotas' | 'info' | 'statu_quo';

export interface Ctx {
  rnd: () => number;
  roll: (p: number) => boolean;
  reform: ReformId | null;
  year: YearDef;
}

export interface Outcome {
  text: string;
  tone: 'good' | 'bad' | 'neutral';
  path?: Omit<PathItem, 'year'>;
}

export interface DecisionOption {
  id: string;
  icon: string;
  label: string;
  hint?: string;
  /** Coût (au lycée et pendant les études, la famille en paie une part selon sa classe) */
  cost?: number;
  show?: (c: Character, ctx: Ctx) => boolean;
  requires?: (c: Character, ctx: Ctx) => string | null;
  resolve: (c: Character, ctx: Ctx) => Outcome;
}

export interface Decision {
  id: string;
  icon: string;
  title: string;
  text: string;
  options: DecisionOption[];
  /** Choix appliqué sans réponse : la voie la plus probable pour ce dossier (jamais la pire) */
  fallback: (c: Character, ctx: Ctx) => string;
}

export interface YearDef {
  id: string;
  label: string;
  stage: Stage;
  decision: Decision;
}

export const TOTAL_TOKENS = 6;

const SCHOOL_CATS: TokenCategory[] = [
  { id: 'etudes', icon: 'books', label: 'Travail scolaire', hint: 'Fait monter ta moyenne' },
  { id: 'job', icon: 'receipt', label: 'Petit boulot', hint: 'Rapporte de l’argent, prend du temps' },
  { id: 'amis', icon: 'handshake', label: 'Amis et sorties', hint: 'Contacts et moral' },
  { id: 'repos', icon: 'sleep', label: 'Repos', hint: 'Recharge ton énergie' },
  { id: 'engagement', icon: 'megaphone', label: 'Engagement', hint: 'Délégué, asso, sport : bon pour le dossier' },
];
const WORK_CATS: TokenCategory[] = [
  { id: 'travail', icon: 'briefcase', label: 'Travail', hint: 'Performance : compte pour les promotions' },
  { id: 'formation', icon: 'graduation', label: 'Formation', hint: 'Compétences, concours, diplôme' },
  { id: 'reseau', icon: 'handshake', label: 'Réseau', hint: 'Contacts professionnels' },
  { id: 'repos', icon: 'sleep', label: 'Repos', hint: 'Énergie, santé' },
  { id: 'projet', icon: 'rocket', label: 'Projet perso', hint: 'Side project, entreprise' },
];
export const categoriesFor = (stage: Stage) => (stage === 'travail' ? WORK_CATS : SCHOOL_CATS);

const good = (text: string, path?: Outcome['path']): Outcome => ({ text, tone: 'good', path });
const bad = (text: string, path?: Outcome['path']): Outcome => ({ text, tone: 'bad', path });
const meh = (text: string, path?: Outcome['path']): Outcome => ({ text, tone: 'neutral', path });

// ================================================================= Coût annuel des études

/** Coût annuel de la formation et du logement, avant aide familiale et bourse */
export function studyCost(c: Character): number {
  if (!c.formation || c.formation === 'vie_active') return 0;
  const f = FORMATIONS[c.formation];
  let cost = f.cost;
  // Logement : chez les parents = pas de loyer ; internat de prépa = presque rien
  if (c.housing === 'parents') cost -= c.formation === 'alternance' ? 0 : Math.min(cost, 3_000);
  if (c.housing === 'internat') cost = Math.min(cost, 1_500);
  if (c.housing === 'crous') cost -= 1_500;
  if (c.housing === 'studio') cost += 2_500;
  return cost;
}

export function bourseAmount(c: Character, reform: ReformId | null): number {
  if (!c.boursier) return 0;
  const base = c.origin === 'populaire' ? 5_500 : c.origin === 'moyenne' ? 2_000 : 0;
  return reform === 'bourses' ? base * 2 : base;
}

/** Jetons imposés cette année (aider sa famille, financer ses études) */
export function forcedTokens(c: Character, year: YearDef, reform: ReformId | null): { category: string; count: number; reason: string }[] {
  const out: { category: string; count: number; reason: string }[] = [];
  if (year.stage === 'lycee' && c.origin === 'populaire') {
    out.push({ category: 'famille', count: 1, reason: 'Tu aides à la maison : petits frères, courses, papiers' });
  }
  if (year.stage === 'etudes') {
    const cost = studyCost(c);
    const toPay = (cost > 0 ? familyShare(c, cost) : cost) - bourseAmount(c, reform);
    const missing = toPay - Math.max(0, c.budget);
    if (missing > 0) {
      const n = clamp(Math.ceil(missing / 1_000), 1, 3);
      out.push({ category: 'job', count: n, reason: `Il manque ${fmtMoney(missing)} pour payer tes études : job étudiant obligatoire` });
    }
  }
  return out;
}

// ================================================================= Effets des jetons

const energyFactor = (e: number) => (e >= 3 ? 1 : e >= 2 ? 0.85 : e >= 1 ? 0.7 : 0.5);

export function applyTokens(c: Character, year: YearDef, forced: { category: string; count: number }[], ctx: Ctx): ReportLine[] {
  const lines: ReportLine[] = [];
  const t: Record<string, number> = { ...c.tokens };
  for (const f of forced) if (f.category !== 'famille') t[f.category] = (t[f.category] ?? 0) + f.count;
  const ef = energyFactor(c.energy);

  if (year.stage === 'travail') {
    const work = t.travail ?? 0;
    c.performance += work;
    const savings = c.job ? SAVINGS[c.job] : 0;
    c.budget += savings;
    lines.push({ icon: 'money', text: `${c.job ? JOB_LABEL[c.job] : 'Sans emploi'} : ${savings >= 0 ? '+' : ''}${fmtMoney(savings)} d’épargne sur l’année`, tone: savings >= 0 ? 'good' : 'bad' });
    if (work) lines.push({ icon: 'briefcase', text: `${work} jeton${work > 1 ? 's' : ''} de travail : ta hiérarchie le remarque (performance ${c.performance})`, tone: 'neutral' });
    if (t.formation) {
      c.grade = round1(clamp(c.grade + 0.3 * t.formation, 0, 20));
      lines.push({ icon: 'graduation', text: `Formation : compétences en hausse (${fmtGrade(c.grade)}/20)`, tone: 'good' });
    }
    if (t.reseau) {
      const g = round1(0.4 * t.reseau);
      c.contacts = round1(clamp(c.contacts + g, 0, 10));
      lines.push({ icon: 'handshake', text: `Réseau : +${fmtGrade(g)} contact${g >= 2 ? 's' : ''}`, tone: 'good' });
    }
    if (t.projet) {
      if (c.job === 'chef') {
        const rev = 1_500 * t.projet;
        c.budget += rev;
        lines.push({ icon: 'rocket', text: `Ton entreprise grandit : +${fmtMoney(rev)}`, tone: 'good' });
      } else {
        c.engagement += t.projet;
        lines.push({ icon: 'rocket', text: 'Ton projet perso avance : utile si tu crées ton entreprise', tone: 'neutral' });
      }
    }
    const fatigue = 1.2 + Math.max(0, work - 3) * 0.4 - (t.repos ?? 0) * 0.6;
    c.energy = round1(clamp(c.energy - fatigue, 0, 5));
    if (c.job) c.jobYears++;
    return lines;
  }

  // ----- Lycée et études
  const study = t.etudes ?? 0;
  const help = year.stage === 'lycee' ? HOME_HELP[c.origin] : (HOME_HELP[c.origin] + 1) / 2;
  let gain = 0;
  for (let k = 1; k <= study; k++) gain += (k <= 3 ? 1 : 0.5) * 0.36 * help * ef;
  const drift = year.stage === 'lycee' ? 0.45 : 0.55 + (c.formation === 'prepa' || c.formation === 'prepa_privee' ? 0.4 : 0);
  const schoolBonus = year.stage === 'lycee' ? SCHOOLS[c.school].gradeBonus : 0;
  const noise = (ctx.rnd() - 0.5) * 0.6;
  const jobPenalty = (t.job ?? 0) * 0.08;
  const before = c.grade;
  c.grade = round1(clamp(c.grade + gain - drift + schoolBonus + noise - jobPenalty, 0, 20));
  if (study) {
    const helpText = help > 1.05 ? ' (tes parents t’aident)' : help < 0.95 ? ' (personne pour t’aider à la maison)' : '';
    lines.push({ icon: 'books', text: `${study} jeton${study > 1 ? 's' : ''} de travail : +${fmtGrade(gain)}${helpText}`, tone: 'good' });
  }
  lines.push({ icon: 'trend-up', text: `L’année est plus exigeante : −${fmtGrade(drift)}`, tone: 'neutral' });
  if (schoolBonus) lines.push({ icon: 'school', text: `${SCHOOLS[c.school].name} : +${fmtGrade(schoolBonus)} (petits effectifs, exigence)`, tone: 'good' });
  if (ef < 1) lines.push({ icon: 'battery', text: 'La fatigue a freiné ton travail : il a moins payé', tone: 'bad' });
  if (t.job) {
    const pay = (year.stage === 'lycee' ? 150 : 1_000) * t.job;
    c.budget += pay;
    lines.push({ icon: 'receipt', text: `Petit boulot : +${fmtMoney(pay)}${jobPenalty ? `, mais −${fmtGrade(jobPenalty)} de moyenne` : ''}`, tone: 'neutral' });
  }
  if (t.amis) {
    const g = round1((c.contacts < 8 ? 0.35 : 0.15) * t.amis);
    c.contacts = round1(clamp(c.contacts + g, 0, 10));
    lines.push({ icon: 'handshake', text: `Amis : +${fmtGrade(g)} contact${g >= 2 ? 's' : ''}`, tone: 'good' });
  }
  if (t.engagement) {
    c.engagement += t.engagement;
    c.contacts = round1(clamp(c.contacts + 0.15 * t.engagement, 0, 10));
    lines.push({ icon: 'megaphone', text: 'Engagement : ton dossier s’étoffe', tone: 'good' });
  }
  const fatigue = 1.3 + (t.job ?? 0) * 0.35 + Math.max(0, study - 3) * 0.35 - (t.repos ?? 0) * 0.6 - (t.amis ?? 0) * 0.2;
  c.energy = round1(clamp(c.energy - fatigue, 0, 5));
  if (c.energy <= 0) {
    c.grade = round1(clamp(c.grade - 0.4, 0, 20));
    c.energy = 1;
    lines.push({ icon: 'sick', text: 'Épuisement : tu tombes malade en fin d’année (−0,4)', tone: 'bad' });
  }
  void before;
  return lines;
}

// ================================================================= Décisions

const needGrade = (g: number, label = 'moyenne') => (c: Character) => (c.grade >= g ? null : `Il faut ${fmtGrade(g)} de ${label} (tu as ${fmtGrade(c.grade)})`);
const needContacts = (n: number) => (c: Character) => (c.contacts >= n ? null : `Il faut ${n} contacts (tu en as ${fmtGrade(c.contacts)})`);

const SECONDE: YearDef = {
  id: 'seconde',
  label: 'Seconde',
  stage: 'lycee',
  decision: {
    id: 'lycee',
    icon: 'school',
    title: 'Ton lycée',
    text: 'La carte scolaire t’affecte au lycée de ton secteur. Certaines familles contournent cette règle.',
    options: [
      { id: 'secteur', icon: 'school', label: 'Rester au lycée de secteur', hint: 'Gratuit', resolve: (c) => meh(`Tu restes au ${SCHOOLS[c.school].name.toLowerCase()}.`) },
      {
        id: 'derogation',
        icon: 'compass',
        label: 'Demander une dérogation (option rare : latin, chinois)',
        hint: 'Il faut connaître les bonnes options',
        show: (c) => c.school === 'quartier',
        resolve: (c, ctx) =>
          ctx.roll(clamp(0.2 + 0.09 * c.contacts, 0.1, 0.9))
            ? ((c.school = 'centre'), good('Dérogation acceptée : tu entres au lycée de centre-ville.', { kind: 'open', text: 'Dérogation : lycée de centre-ville' }))
            : bad('Dérogation refusée : il fallait connaître les options rares qui ouvrent les portes.'),
      },
      {
        id: 'prive',
        icon: 'church',
        label: 'Lycée privé sous contrat',
        hint: 'Classes plus calmes',
        cost: 1_800,
        resolve: (c) => ((c.school = 'prive'), good('Inscription au lycée privé : petits effectifs et suivi serré.', { kind: 'open', text: 'Lycée privé sous contrat' })),
      },
      {
        id: 'elite',
        icon: 'crown',
        label: 'Lycée privé d’élite (sur dossier)',
        hint: 'Sélection + frais élevés',
        cost: 6_000,
        show: (c) => c.origin === 'superieure' || c.contacts >= 6,
        resolve: (c) => ((c.school = 'elite'), (c.contacts = clamp(c.contacts + 1, 0, 10)), good('Admission dans un lycée d’élite : réseau et exigence.', { kind: 'open', text: 'Lycée privé d’élite' })),
      },
    ],
    fallback: () => 'secteur',
  },
};

const PREMIERE: YearDef = {
  id: 'premiere',
  label: 'Première',
  stage: 'lycee',
  decision: {
    id: 'specialites',
    icon: 'compass',
    title: 'Tes spécialités',
    text: 'Ce choix décide des formations possibles après le bac. Le conseil de classe donne son avis.',
    options: [
      {
        id: 'sciences',
        icon: 'flask',
        label: 'Maths + physique',
        hint: 'Ouvre : prépa scientifique, écoles d’ingénieurs',
        requires: (c) => (c.grade >= 11.5 ? null : 'Avis défavorable du conseil de classe (moins de 11,5)'),
        resolve: (c) => ((c.specialty = 'sciences'), good('Spécialités maths et physique : toutes les portes restent ouvertes.', { kind: 'open', text: 'Spécialités scientifiques' })),
      },
      {
        id: 'contester',
        icon: 'speak',
        label: 'Contester l’avis : tes parents insistent pour maths',
        hint: 'Il faut connaître les codes',
        show: (c) => c.grade < 11.5 && (c.origin !== 'populaire' || c.contacts >= 5),
        resolve: (c, ctx) =>
          ctx.roll(c.origin === 'superieure' ? 0.8 : 0.5)
            ? ((c.specialty = 'sciences'), good('Tes parents obtiennent un rendez-vous : l’avis est levé.', { kind: 'open', text: 'Avis du conseil de classe contesté avec succès' }))
            : ((c.specialty = 'ses'), bad('L’avis est maintenu : ce sera SES + histoire-géo.')),
      },
      { id: 'ses', icon: 'globe', label: 'SES + histoire-géo', hint: 'Ouvre : Sciences Po, droit, éco', resolve: (c) => ((c.specialty = 'ses'), good('Spécialités SES et histoire-géo.', { kind: 'open', text: 'Spécialités SES' })) },
      { id: 'arts', icon: 'palette', label: 'Arts + langues', hint: 'Ouvre : écoles d’art, langues', resolve: (c) => ((c.specialty = 'arts'), meh('Spécialités arts et langues.', { kind: 'open', text: 'Spécialités artistiques' })) },
      {
        id: 'pro',
        icon: 'wrench',
        label: 'Voie professionnelle (apprentissage payé)',
        hint: 'Ferme : prépa, Sciences Po · Ouvre : BTS, alternance',
        resolve: (c) => ((c.specialty = 'pro'), (c.track = 'pro'), (c.budget += 1_500), meh('Tu passes en bac pro et touches un salaire d’apprenti.', { kind: 'close', text: 'Voie pro : prépa et Sciences Po fermées' })),
      },
    ],
    // Sans réponse : orientation proposée par le conseil de classe
    fallback: (c) => (c.grade < 9.5 ? 'pro' : c.grade >= 11.5 ? 'sciences' : 'ses'),
  },
};

const TERMINALE: YearDef = {
  id: 'terminale',
  label: 'Terminale',
  stage: 'lycee',
  decision: {
    id: 'apres-bac',
    icon: 'folders',
    title: 'Préparer l’après-bac',
    text: 'Parcoursup approche. Tu n’as le temps que pour une chose cette année.',
    options: [
      { id: 'orientation', icon: 'compass', label: 'Rendez-vous avec la conseillère d’orientation', hint: 'Découvrir toutes les filières', resolve: (c) => ((c.info = true), good('Tu découvres les prépas, Sciences Po, les écoles d’ingénieurs…', { kind: 'open', text: 'Filières sélectives découvertes' })) },
      {
        id: 'cordees',
        icon: 'link',
        label: 'Candidater aux Cordées de la réussite',
        hint: 'Tutorat par une grande école',
        show: (c) => c.origin !== 'superieure' && c.track === 'generale',
        requires: needGrade(12),
        resolve: (c, ctx) =>
          ctx.roll(0.65)
            ? ((c.cordees = true), (c.info = true), (c.letter = clamp(c.letter + 0.35, 0, 1)), (c.contacts = clamp(c.contacts + 1, 0, 10)), good('Candidature retenue ! Un tuteur t’aide pour ton dossier ; une place en internat est possible.', { kind: 'open', text: 'Cordées de la réussite' }))
            : bad('Dossier non retenu cette année.'),
      },
      { id: 'stage', icon: 'school', label: 'Stage de révision intensif', hint: '+ moyenne', cost: 900, resolve: (c) => ((c.grade = round1(clamp(c.grade + 0.6, 0, 20))), good('Une semaine de stage : +0,6 de moyenne.')) },
      { id: 'coaching', icon: 'user', label: 'Coaching Parcoursup privé', hint: 'Lettre de motivation soignée', cost: 1_200, resolve: (c) => ((c.letter = clamp(c.letter + 0.4, 0, 1)), (c.info = true), good('Un coach réécrit tes lettres et t’explique la stratégie.', { kind: 'open', text: 'Coaching Parcoursup' })) },
      { id: 'seul', icon: 'lamp', label: 'Réviser en solo', hint: 'Gratuit', resolve: (c) => ((c.grade = round1(clamp(c.grade + 0.2, 0, 20))), meh('Tu révises en solo : +0,2.')) },
    ],
    fallback: () => 'seul',
  },
};

const ETUDES1: YearDef = {
  id: 'etudes1',
  label: 'Première année d’études',
  stage: 'etudes',
  decision: {
    id: 'logement',
    icon: 'home',
    title: 'Ton logement',
    text: 'Ta formation est en ville. Le logement est le premier budget étudiant.',
    options: [
      { id: 'parents', icon: 'train', label: 'Rester chez tes parents', hint: 'Gratuit · longs trajets', show: (c) => c.formation !== 'vie_active', resolve: (c) => ((c.housing = 'parents'), (c.energy = round1(clamp(c.energy - 1, 0, 5))), meh('Deux heures de transport par jour : −1 énergie.')) },
      { id: 'internat', icon: 'bed', label: 'Internat de la prépa', hint: 'Presque gratuit', show: (c) => c.formation === 'prepa' && (c.cordees || c.boursier), resolve: (c) => ((c.housing = 'internat'), good('Internat : logement, repas et encadrement assurés.', { kind: 'open', text: 'Internat de prépa' })) },
      { id: 'crous', icon: 'building', label: 'Chambre CROUS', hint: 'Réservé aux boursiers · pas garanti', show: (c) => c.formation !== 'vie_active', requires: (c) => (c.boursier ? null : 'Réservé aux étudiants boursiers'), resolve: (c, ctx) => (ctx.roll(0.6) ? ((c.housing = 'crous'), good('Chambre CROUS obtenue : loyer réduit.')) : ((c.housing = 'parents'), (c.energy = round1(clamp(c.energy - 1, 0, 5))), bad('Liste d’attente : tu restes chez tes parents (−1 énergie).'))) },
      { id: 'coloc', icon: 'couch', label: 'Colocation', hint: 'Contacts + · loyer moyen', show: (c) => c.formation !== 'vie_active', resolve: (c) => ((c.housing = 'coloc'), (c.contacts = clamp(c.contacts + 1, 0, 10)), good('Des colocs devenus amis : +1 contact.')) },
      { id: 'studio', icon: 'building', label: 'Studio en centre-ville', hint: 'Confort · loyer élevé', show: (c) => c.formation !== 'vie_active', resolve: (c) => ((c.housing = 'studio'), (c.energy = round1(clamp(c.energy + 0.5, 0, 5))), good('Ton chez-toi, à deux pas des cours.')) },
      { id: 'travailler', icon: 'receipt', label: 'Prendre un CDD à temps plein', hint: 'Tu es déjà dans la vie active', show: (c) => c.formation === 'vie_active', resolve: (c) => ((c.budget += 4_000), meh('Un CDD dans la logistique : +4 000 €.')) },
      { id: 'formation-courte', icon: 'toolbox', label: 'Formation courte payée par Pôle emploi', show: (c) => c.formation === 'vie_active', resolve: (c) => ((c.grade = round1(clamp(c.grade + 0.5, 0, 20))), good('Tu obtiens un certificat professionnel.')) },
    ],
    fallback: (c) => (c.formation === 'vie_active' ? 'travailler' : c.formation === 'prepa' && (c.cordees || c.boursier) ? 'internat' : 'parents'),
  },
};

const ETUDES2: YearDef = {
  id: 'etudes2',
  label: 'Fin d’études',
  stage: 'etudes',
  decision: {
    id: 'stage',
    icon: 'building',
    title: 'Stage et suite des études',
    text: 'Ta dernière année se joue sur un stage… ou une poursuite d’études.',
    options: [
      { id: 'piston', icon: 'key', label: 'Stage chez un proche de la famille', hint: 'Il faut un bon réseau', show: (c) => c.formation !== 'vie_active', requires: needContacts(5), resolve: (c) => ((c.promise = true), (c.contacts = clamp(c.contacts + 1, 0, 10)), good('Un stage en or, avec une promesse d’embauche.', { kind: 'open', text: 'Promesse d’embauche (réseau)' })) },
      { id: 'seul', icon: 'mail', label: 'Chercher un stage par toi-même', hint: 'Pas garanti', show: (c) => c.formation !== 'vie_active', resolve: (c, ctx) => (ctx.roll(clamp(0.25 + 0.05 * c.contacts + (c.grade - 10) * 0.04, 0.1, 0.8)) ? ((c.promise = true), good('Une entreprise te propose un poste à la sortie !', { kind: 'open', text: 'Promesse d’embauche' })) : ((c.contacts = clamp(c.contacts + 0.5, 0, 10)), meh('Un stage formateur, sans promesse d’embauche.'))) },
      { id: 'erasmus', icon: 'europe', label: 'Semestre Erasmus', hint: 'Contacts ++', cost: 3_000, show: (c) => c.formation !== 'vie_active' && c.formation !== 'alternance', resolve: (c) => ((c.contacts = clamp(c.contacts + 1.5, 0, 10)), (c.grade = round1(clamp(c.grade + 0.2, 0, 20))), good('Un semestre à l’étranger : ton CV brille.', { kind: 'open', text: 'Erasmus' })) },
      { id: 'master', icon: 'scroll', label: 'Candidater en master sélectif', hint: 'Bac+5', show: (c) => c.formation === 'licence', requires: needGrade(12), resolve: (c, ctx) => (ctx.roll(clamp(0.35 + (c.grade - 12) * 0.15 + c.contacts * 0.03, 0.2, 0.9)) ? ((c.masterTrack = true), good('Admission en master !', { kind: 'open', text: 'Master' })) : bad('Refus partout : ce sera la licence.', { kind: 'close', text: 'Master refusé' })) },
      { id: 'concours', icon: 'flame', label: 'Tout donner pour les concours', hint: 'Moyenne + · énergie −', show: (c) => c.formation === 'prepa' || c.formation === 'prepa_privee', resolve: (c) => ((c.grade = round1(clamp(c.grade + 0.6, 0, 20))), (c.energy = round1(clamp(c.energy - 1, 0, 5))), meh('Des mois de travail acharné : +0,6, −1 énergie.')) },
      { id: 'promotion', icon: 'trend-up', label: 'Viser un CDI dans ton entreprise', show: (c) => c.formation === 'vie_active', resolve: (c, ctx) => (ctx.roll(0.5) ? ((c.promise = true), good('Ton CDD devient un CDI.')) : meh('Pas de CDI pour l’instant.')) },
    ],
    fallback: (c) => (c.formation === 'vie_active' ? 'promotion' : c.formation === 'prepa' || c.formation === 'prepa_privee' ? 'concours' : 'seul'),
  },
};

const TRAVAIL1: YearDef = {
  id: 'travail1',
  label: 'Premières années de travail',
  stage: 'travail',
  decision: {
    id: 'carriere',
    icon: 'trend-up',
    title: 'Ta carrière',
    text: 'Te voilà dans la vie active. Quelle est ta priorité ?',
    options: [
      {
        id: 'promotion',
        icon: 'trend-up',
        label: 'Demander une promotion',
        hint: 'Selon ta performance et ton réseau',
        show: (c) => !!c.job && c.job !== 'chef' && c.job !== 'chomage' && !c.job.startsWith('fonction'),
        resolve: (c, ctx) => promotion(c, ctx),
      },
      {
        id: 'concours-interne',
        icon: 'note',
        label: 'Passer le concours interne',
        hint: 'Au mérite : ta moyenne compte, pas ton réseau',
        show: (c) => c.job === 'fonction_c' || c.job === 'fonction_b',
        resolve: (c) => (c.grade >= (c.job === 'fonction_c' ? 11 : 12.5) ? ((c.job = c.job === 'fonction_c' ? 'fonction_b' : 'fonction_a'), (c.jobYears = 0), good(`Concours réussi : ${JOB_LABEL[c.job]}.`, { kind: 'title', text: JOB_LABEL[c.job] })) : bad('Concours manqué de peu.')),
      },
      {
        id: 'chercher',
        icon: 'search',
        label: 'Chercher un emploi',
        show: (c) => c.job === 'chomage',
        resolve: (c, ctx) => (ctx.roll(clamp(0.35 + c.contacts * 0.05 + DIPLOMA_LEVEL[c.diploma ?? 'aucun'] * 0.06, 0.2, 0.9)) ? ((c.job = DIPLOMA_LEVEL[c.diploma ?? 'aucun'] >= 3 ? 'intermediaire' : 'employe'), (c.jobYears = 0), good(`Embauche : ${JOB_LABEL[c.job]}.`, { kind: 'title', text: JOB_LABEL[c.job] })) : bad('Encore une année de recherche.')),
      },
      {
        id: 'logement',
        icon: 'home',
        label: 'Acheter ton logement',
        hint: 'Apport de 20 000 €',
        show: (c) => !c.homeOwner,
        requires: (c) => (c.budget >= 20_000 ? null : `Il faut 20 000 € d’apport (tu as ${fmtMoney(c.budget)})`),
        resolve: (c) => ((c.homeOwner = true), (c.budget += 10_000), good('Propriétaire : ton logement prend de la valeur (+10 000 €).', { kind: 'title', text: 'Propriétaire' })),
      },
      { id: 'stabilite', icon: 'chair', label: 'Assurer ta place', hint: 'Sans risque', resolve: () => meh('Tu consolides ta position.') },
    ],
    fallback: () => 'stabilite',
  },
};

const TRAVAIL2: YearDef = {
  id: 'travail2',
  label: 'Dix ans plus tard',
  stage: 'travail',
  decision: {
    id: 'cap',
    icon: 'compass',
    title: 'Un nouveau cap',
    text: 'Dix ans après le bac. Un dernier choix de carrière.',
    options: [
      {
        id: 'promotion',
        icon: 'trend-up',
        label: 'Viser le poste au-dessus',
        hint: 'Plafond de verre : il faut du réseau pour devenir cadre',
        show: (c) => !!c.job && c.job !== 'chef' && c.job !== 'chomage' && !c.job.startsWith('fonction'),
        resolve: (c, ctx) => promotion(c, ctx),
      },
      {
        id: 'vae',
        icon: 'graduation',
        label: 'Reprendre une formation diplômante (VAE)',
        hint: 'Un niveau de diplôme de plus',
        cost: 2_000,
        show: (c) => DIPLOMA_LEVEL[c.diploma ?? 'aucun'] < 5,
        resolve: (c) => {
          const next: Diploma = DIPLOMA_LEVEL[c.diploma ?? 'aucun'] <= 1 ? 'bts' : DIPLOMA_LEVEL[c.diploma ?? 'aucun'] <= 2 ? 'licence' : 'master';
          c.diploma = next;
          return good(`Nouveau diplôme : ${DIPLOMA_LABEL[next]}.`, { kind: 'title', text: DIPLOMA_LABEL[next] });
        },
      },
      {
        id: 'entreprise',
        icon: 'rocket',
        label: 'Créer ton entreprise',
        hint: 'Il faut 15 000 € d’apport',
        show: (c) => c.job !== 'chef',
        requires: (c) => (c.budget >= 15_000 ? null : `Il faut 15 000 € d’apport (tu as ${fmtMoney(c.budget)})`),
        resolve: (c, ctx) =>
          ctx.roll(clamp(0.35 + c.contacts * 0.04 + c.engagement * 0.03, 0.2, 0.85))
            ? ((c.job = 'chef'), (c.jobYears = 1), (c.budget += 10_000), good('Ton entreprise décolle : te voilà chef d’entreprise.', { kind: 'title', text: 'Chef d’entreprise' }))
            : ((c.budget -= 15_000), bad(`Faillite : tu perds ton apport (−15 000 €).`, { kind: 'event', text: 'Faillite' })),
      },
      { id: 'equilibre', icon: 'leaf', label: 'Privilégier ta vie personnelle', hint: 'Énergie +', resolve: (c) => ((c.energy = round1(clamp(c.energy + 1.5, 0, 5))), meh('Tu prends du temps pour toi.')) },
    ],
    fallback: () => 'equilibre',
  },
};

/** Promotion : performance + réseau ; le passage cadre demande du réseau ou un bac+5 (plafond de verre) */
function promotion(c: Character, ctx: Ctx): Outcome {
  const job = c.job as Job;
  const next: Job | null = job === 'ouvrier' || job === 'employe' ? 'intermediaire' : job === 'intermediaire' ? 'cadre' : null;
  if (!next) return meh('Tu es déjà au sommet de ton entreprise.');
  if (next === 'cadre' && c.contacts < 5 && DIPLOMA_LEVEL[c.diploma ?? 'aucun'] < 5) {
    return bad('Le poste de cadre revient à un diplômé d’école : plafond de verre.', { kind: 'close', text: 'Plafond de verre' });
  }
  const p = clamp(0.2 + c.performance * 0.06 + c.contacts * 0.04, 0.1, 0.85);
  if (!ctx.roll(p)) return bad('« Ce n’est pas le moment. » Promotion refusée.');
  c.job = next;
  c.jobYears = 0;
  return good(`Promotion : ${JOB_LABEL[next]} !`, { kind: 'title', text: JOB_LABEL[next] });
}

export const YEARS: YearDef[] = [SECONDE, PREMIERE, TERMINALE, ETUDES1, ETUDES2, TRAVAIL1, TRAVAIL2];
export const yearById = (id: string) => YEARS.find((y) => y.id === id);

// ================================================================= Coups du sort

interface Shock {
  id: string;
  stage: Stage;
  /** Probabilité selon la classe d'origine (la précarité expose davantage) */
  weight: (c: Character) => number;
  apply: (c: Character, ctx: Ctx) => ReportLine;
}

const SHOCKS: Shock[] = [
  {
    id: 'ordi',
    stage: 'lycee',
    weight: () => 1,
    apply: (c) => {
      const pay = familyShare(c, 600);
      if (c.budget >= pay) {
        c.budget -= pay;
        return { icon: 'laptop', text: pay ? `Ordinateur en panne : −${fmtMoney(pay)}` : 'Ordinateur en panne : tes parents en rachètent un', tone: pay ? 'bad' : 'neutral' };
      }
      c.grade = round1(clamp(c.grade - 0.4, 0, 20));
      return { icon: 'laptop', text: 'Ordinateur en panne, pas les moyens d’en racheter : −0,4', tone: 'bad' };
    },
  },
  { id: 'prof', stage: 'lycee', weight: () => 1, apply: (c) => ((c.grade = round1(clamp(c.grade + 0.4, 0, 20))), { icon: 'teacher', text: 'Un professeur croit en toi : +0,4', tone: 'good' }) },
  { id: 'famille', stage: 'lycee', weight: (c) => (c.origin === 'populaire' ? 1.6 : 0.8), apply: (c) => ((c.energy = round1(clamp(c.energy - 1, 0, 5))), { icon: 'home', text: 'Coup dur à la maison : −1 énergie', tone: 'bad' }) },
  { id: 'voyage', stage: 'lycee', weight: (c) => (c.origin === 'superieure' ? 1.6 : 0.3), apply: (c) => ((c.contacts = round1(clamp(c.contacts + 0.6, 0, 10))), { icon: 'plane', text: 'Séjour linguistique offert par tes parents : +0,6 contact', tone: 'good' }) },
  { id: 'sante', stage: 'etudes', weight: () => 1, apply: (c) => ((c.energy = round1(clamp(c.energy - 1, 0, 5))), { icon: 'sick', text: 'Grosse grippe pendant les partiels : −1 énergie', tone: 'bad' }) },
  {
    id: 'panne',
    stage: 'etudes',
    weight: (c) => (c.origin === 'populaire' ? 1.4 : 1),
    apply: (c) => {
      const pay = familyShare(c, 1_000);
      c.budget -= pay;
      return { icon: 'car', text: pay ? `Dépense imprévue : −${fmtMoney(pay)}` : 'Dépense imprévue, payée par tes parents', tone: pay ? 'bad' : 'neutral' };
    },
  },
  { id: 'rencontre', stage: 'etudes', weight: () => 1, apply: (c) => ((c.contacts = round1(clamp(c.contacts + 1, 0, 10))), { icon: 'handshake', text: 'Rencontre décisive dans ta promo : +1 contact', tone: 'good' }) },
  {
    id: 'maladie',
    stage: 'travail',
    weight: () => 1,
    apply: (c) => {
      const cost = Math.round(8_000 * (1 - FAMILY_SAFETY[c.origin]));
      c.budget -= cost;
      c.energy = round1(clamp(c.energy - 1, 0, 5));
      return { icon: 'hospital', text: cost ? `Accident de la vie : −${fmtMoney(cost)}, −1 énergie` : 'Accident de la vie : ta famille absorbe tous les frais', tone: cost ? 'bad' : 'neutral' };
    },
  },
  {
    id: 'licenciement',
    stage: 'travail',
    weight: (c) => (c.job && c.job !== 'chef' && !c.job.startsWith('fonction') && c.job !== 'chomage' ? (c.origin === 'populaire' ? 1.3 : 0.9) : 0),
    apply: (c) => {
      // Filet de sécurité : un réseau solide retrouve aussitôt un poste équivalent
      if (c.contacts >= 6) return { icon: 'trend-down', text: 'Plan social… mais ton réseau te retrouve un poste équivalent', tone: 'neutral' };
      const before = c.job;
      c.job = 'chomage';
      c.jobYears = 0;
      return { icon: 'trend-down', text: `Licenciement économique : tu perds ton poste (${JOB_LABEL[before as Job]})`, tone: 'bad' };
    },
  },
  {
    id: 'greve',
    stage: 'travail',
    // Grève dans l'entreprise : salariés du privé, hors cadres et chefs d'entreprise
    weight: (c) => (c.job === 'ouvrier' || c.job === 'employe' || c.job === 'intermediaire' ? 1 : 0),
    apply: (c, ctx) =>
      ctx.roll(0.5)
        ? ((c.budget += 600), { icon: 'fist', text: 'Grève dans ton entreprise : 3 jours sans salaire, mais une hausse obtenue (+600 € net sur l’année)', tone: 'good' as const })
        : ((c.budget -= 300), { icon: 'fist', text: 'Grève dans ton entreprise : 3 jours sans salaire, rien d’obtenu (−300 €)', tone: 'bad' as const }),
  },
  { id: 'prime', stage: 'travail', weight: (c) => (c.job && c.job !== 'chomage' ? 1 : 0), apply: (c) => ((c.budget += 2_000), { icon: 'money', text: 'Prime exceptionnelle : +2 000 €', tone: 'good' }) },
];

/** Tire au plus un coup du sort pour l'année (≈ 35 %) */
export function rollShock(c: Character, year: YearDef, ctx: Ctx): ReportLine | null {
  if (!ctx.roll(0.35)) return null;
  const pool = SHOCKS.filter((s) => s.stage === year.stage).map((s) => ({ s, w: s.weight(c) })).filter((x) => x.w > 0);
  const total = pool.reduce((sum, x) => sum + x.w, 0);
  let r = ctx.rnd() * total;
  for (const { s, w } of pool) {
    r -= w;
    if (r <= 0) return s.apply(c, ctx);
  }
  return null;
}

/** Vérifie l'accès d'une option : prérequis puis argent */
export function lockReason(c: Character, o: DecisionOption, ctx: Ctx): string | null {
  const req = o.requires?.(c, ctx);
  if (req) return req;
  if (o.cost) {
    const pay = ctx.year.stage === 'travail' ? o.cost : familyShare(c, o.cost);
    if (pay > 0 && c.budget < pay) return `Il te manque ${fmtMoney(pay - Math.max(0, c.budget))}`;
  }
  return null;
}

export function costHint(c: Character, o: DecisionOption, stage: Stage): string {
  const parts: string[] = [];
  if (o.cost) {
    const pay = stage === 'travail' ? o.cost : familyShare(c, o.cost);
    parts.push(pay === 0 ? 'Payé par tes parents' : pay < o.cost ? `−${fmtMoney(pay)} (parents : le reste)` : `−${fmtMoney(pay)}`);
  }
  if (o.hint) parts.push(o.hint);
  return parts.join(' · ');
}

export { JOB_TIER };
