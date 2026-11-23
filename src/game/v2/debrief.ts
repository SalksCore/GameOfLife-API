/**
 * Débrief de l'exposé : une série de diapositives calculées à partir de la partie jouée.
 * Chaque diapositive montre un chiffre de la partie par classe d'origine, l'interprète en phrases simples
 * et le compare au chiffre réel publié (cartes « Le saviez-vous »).
 */
import type { DebriefView, SocialClass } from '../protocol.js';
import { SOCIAL_CLASSES } from '../protocol.js';
import { DIPLOMA_LEVEL, round1, type Character } from './model.js';
import { moveOf, type FinalOutcome } from './results.js';

export interface DebriefInput {
  chars: Character[];
  finals: Map<string, FinalOutcome>;
  reform: string | null;
}

interface DebriefDef {
  id: string;
  title: string;
  build: (d: DebriefInput) => Omit<DebriefView, 'id' | 'index' | 'total'>;
}

const fmt = (n: number) => String(round1(n)).replace('.', ',');

/** Part (%) des joueurs de chaque classe d'origine qui vérifient la condition (null si personne) */
function pctBy(chars: Character[], pred: (c: Character) => boolean): Record<SocialClass, number | null> {
  const out = {} as Record<SocialClass, number | null>;
  for (const s of SOCIAL_CLASSES) {
    const l = chars.filter((c) => c.origin === s);
    out[s] = l.length ? Math.round((l.filter(pred).length / l.length) * 100) : null;
  }
  return out;
}
function avgBy(chars: Character[], f: (c: Character) => number): Record<SocialClass, number | null> {
  const out = {} as Record<SocialClass, number | null>;
  for (const s of SOCIAL_CLASSES) {
    const l = chars.filter((c) => c.origin === s);
    out[s] = l.length ? round1(l.reduce((sum, c) => sum + f(c), 0) / l.length) : null;
  }
  return out;
}
const hasPath = (c: Character, text: string) => c.path.some((p) => p.text.includes(text));

/** « 3 fois plus », « 1,5 fois plus », ou null si non calculable */
function ratio(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null;
  if (b === 0) return a === 0 ? 1 : null;
  return round1(a / b);
}

/** Compare l'écart de la partie (ratio supérieure / populaire) à l'écart réel */
function compareGap(game: number | null, real: number): string {
  if (game === null) return 'Pas assez de joueurs dans une des classes pour comparer avec la réalité.';
  if (game >= real * 0.66 && game <= real * 1.5) return `Notre partie reproduit un écart du même ordre que la réalité (×${fmt(game)} contre ×${fmt(real)}).`;
  if (game < real) return `Notre partie est un peu moins inégale que la réalité (×${fmt(game)} contre ×${fmt(real)}) : petit groupe, part de hasard.`;
  return `Notre partie est plus inégale que la réalité (×${fmt(game)} contre ×${fmt(real)}) : petit groupe, le hasard amplifie les écarts.`;
}

/** Phrase « X % des joueurs supérieurs contre Y % des joueurs populaires » */
function gapSentence(v: Record<SocialClass, number | null>, what: string): string {
  const { populaire: p, superieure: s } = v;
  if (p === null || s === null) return `Dans notre partie, une des classes n’avait pas de joueur : impossible de comparer ${what}.`;
  if (p === s) return `Dans notre partie, autant de joueurs populaires que supérieurs ${what} (${p} %).`;
  const r = ratio(s, p);
  return `Dans notre partie, ${s} % des joueurs nés en classe supérieure ${what}, contre ${p} % en classe populaire${r && r > 1 ? ` : ${fmt(r)} fois plus` : ''}.`;
}

const DEBRIEFS: DebriefDef[] = [
  {
    id: 'depart',
    title: 'Le point de départ',
    build: ({ chars }) => {
      const start = avgBy(chars, (c) => c.grades[0] ?? c.grade);
      const end = avgBy(chars, (c) => c.grades[2] ?? c.grade);
      const gapStart = start.superieure !== null && start.populaire !== null ? round1(start.superieure - start.populaire) : null;
      const gapEnd = end.superieure !== null && end.populaire !== null ? round1(end.superieure - end.populaire) : null;
      return {
        eyebrow: 'Partie I · Au lycée',
        title: 'Un écart qui grandit au lycée',
        question: 'À travail égal, les notes avancent-elles au même rythme ?',
        charts: [
          { label: 'Moyenne après la Seconde', unit: '/20', game: start, real: null, max: 20 },
          { label: 'Moyenne en Terminale', unit: '/20', game: end, real: null, max: 20 },
        ],
        interpretation: [
          gapStart !== null && gapEnd !== null
            ? `L’écart de moyenne entre joueurs supérieurs et populaires passe de ${fmt(gapStart)} point${Math.abs(gapStart) >= 2 ? 's' : ''} en Seconde à ${fmt(gapEnd)} en Terminale.`
            : 'Une des classes n’avait pas de joueur : l’écart ne peut pas être calculé.',
          'Même nombre de jetons, mêmes règles : la différence vient de l’aide aux devoirs (×0,8 contre ×1,2) et du jeton pris par la famille en classe populaire.',
        ],
        reality: { figure: '+32 pts / 113 pts', text: 'Dès la maternelle, 32 points d’avance en langage pour les enfants très favorisés ; à 15 ans, 113 points d’écart en maths (PISA 2022).', source: 'DEPP, L’état de l’École 2025', cards: ['F1', 'F2'] },
        verdict: gapStart !== null && gapEnd !== null && gapEnd > gapStart ? 'L’école n’a pas réduit l’écart de départ : il s’est creusé.' : 'Ici, l’écart ne s’est pas creusé : quelques bons joueurs populaires ont rattrapé leur retard.',
        notes: 'Montrer la flèche entre les deux graphiques. Rappeler : personne n’a choisi sa famille.',
      };
    },
  },
  {
    id: 'lycee',
    title: 'Le lycée où l’on va',
    build: ({ chars }) => {
      const prive = pctBy(chars, (c) => c.school === 'prive' || c.school === 'elite');
      const derog = pctBy(chars, (c) => hasPath(c, 'Dérogation'));
      const contest = pctBy(chars, (c) => hasPath(c, 'contesté'));
      return {
        eyebrow: 'Partie I · Au lycée',
        title: 'Changer de lycée, ça s’achète et ça s’apprend',
        question: 'Qui a quitté le lycée de son secteur ?',
        charts: [
          { label: 'Au lycée privé ou d’élite', unit: '%', game: prive, real: null, max: 100 },
          { label: 'Dérogation obtenue', unit: '%', game: derog, real: null, max: 100 },
          { label: 'Avis du conseil de classe contesté avec succès', unit: '%', game: contest, real: null, max: 100 },
        ],
        interpretation: [
          gapSentence(prive, 'sont allés dans le privé'),
          'Le privé coûte 1 800 € (6 000 € pour l’élite) : la famille paie tout en classe supérieure, rien en classe populaire.',
          'Contester un avis n’est même pas proposé à un joueur populaire sans réseau : il faut connaître les codes.',
        ],
        reality: { figure: '57 % / 32 %', text: 'Le privé scolarise 57 % d’élèves favorisés ou très favorisés, contre 32 % dans le public.', source: 'Insee, France, portrait social 2025', cards: ['F4', 'F3'] },
        verdict: 'Le lycée n’est pas le même pour tous : il dépend de l’adresse, de l’argent et des codes.',
        notes: 'Faire réagir : qui savait qu’on pouvait contester un avis du conseil de classe ?',
      };
    },
  },
  {
    id: 'information',
    title: 'L’information inégale',
    build: ({ chars }) => {
      const blind = pctBy(chars, (c) => c.stats.hiddenSelective);
      const coaching = pctBy(chars, (c) => hasPath(c, 'Coaching'));
      const cordees = pctBy(chars, (c) => c.cordees);
      return {
        eyebrow: 'Partie II · L’orientation',
        title: 'On ne demande pas ce qu’on ne connaît pas',
        question: 'Qui a vu la prépa et Sciences Po dans sa liste Parcoursup ?',
        charts: [
          { label: 'N’ont jamais vu la prépa', unit: '%', game: blind, real: null, max: 100 },
          { label: 'Ont payé un coaching Parcoursup', unit: '%', game: coaching, real: null, max: 100 },
          { label: 'Ont obtenu les Cordées de la réussite', unit: '%', game: cordees, real: null, max: 100 },
        ],
        interpretation: [
          blind.populaire !== null ? `${blind.populaire} % des joueurs populaires n’ont jamais vu la prépa dans leur liste, faute d’information.` : 'Pas de joueur populaire dans cette partie.',
          'Le coaching privé (1 200 €) donne à la fois une meilleure lettre et l’information. Les Cordées aident aussi… mais demandent 12 de moyenne.',
        ],
        reality: { figure: '40 % / 20 %', text: 'En voie générale, 40 % des élèves sont d’origine très favorisée, contre 20 % en série technologique des services.', source: 'DEPP, L’état de l’École 2025', cards: ['F5', 'F19'] },
        verdict: 'L’autocensure n’est pas un manque d’ambition : c’est souvent un manque d’information.',
        notes: 'Demander à un joueur populaire s’il a vu la prépa. Lire F19 si on a le temps.',
      };
    },
  },
  {
    id: 'bac',
    title: 'Le bac',
    build: ({ chars }) => {
      const mention = pctBy(chars, (c) => !!c.mention);
      const success = pctBy(chars, (c) => !!c.bac && c.bac !== 'aucun');
      const grade = avgBy(chars, (c) => c.bacGrade);
      return {
        eyebrow: 'Fin de la partie I',
        title: 'Même examen, pas les mêmes mentions',
        question: 'Le bac est-il un examen égalitaire ?',
        charts: [
          { label: 'Bac obtenu', unit: '%', game: success, real: null, max: 100 },
          { label: 'Bac avec mention', unit: '%', game: mention, real: null, max: 100 },
          { label: 'Note moyenne au bac', unit: '/20', game: grade, real: null, max: 20 },
        ],
        interpretation: [gapSentence(mention, 'ont eu une mention'), 'Le bac note tout le monde de la même façon. Mais il note un parcours déjà inégal : ce qu’on mesure, c’est aussi ce que la famille a apporté.'],
        reality: { figure: '113 pts', text: 'En maths, 113 points séparent le quart d’élèves le plus favorisé du moins favorisé en France (94 dans l’OCDE).', source: 'DEPP, L’état de l’École 2025', cards: ['F2'] },
        verdict: 'L’examen est le même pour tous ; le chemin pour y arriver ne l’est pas.',
        notes: 'Un joueur populaire avec mention ? « Ça arrive, mais regardez la colonne entière. »',
      };
    },
  },
  {
    id: 'etudes',
    title: 'Ce que coûtent les études',
    build: ({ chars }) => {
      const selective = pctBy(chars, (c) => c.formation === 'prepa' || c.formation === 'prepa_privee' || c.formation === 'iep' || c.formation === 'ecole');
      const jobs = avgBy(chars, (c) => c.stats.forcedJobs);
      const bourse = pctBy(chars, (c) => c.stats.askedBourse);
      return {
        eyebrow: 'Partie II · Les études',
        title: 'Étudier ou travailler pour payer',
        question: 'Qui a dû prendre un job pendant ses études ?',
        charts: [
          { label: 'En formation sélective (prépa, IEP, école)', unit: '%', game: selective, real: null, max: 100 },
          { label: 'Jetons de job imposés (moyenne sur 2 ans)', unit: '', game: jobs, real: null, max: 6 },
          { label: 'Ont demandé une bourse', unit: '%', game: bourse, real: null, max: 100 },
        ],
        interpretation: [
          jobs.populaire !== null && jobs.superieure !== null
            ? `Un joueur populaire a eu en moyenne ${fmt(jobs.populaire)} jeton${jobs.populaire >= 2 ? 's' : ''} de job imposé${jobs.populaire >= 2 ? 's' : ''}, contre ${fmt(jobs.superieure)} en classe supérieure : autant de temps en moins pour réviser.`
            : 'Une des classes n’avait pas de joueur dans cette partie.',
          'L’école de commerce (11 000 € par an) n’est pas très sélective : elle est surtout chère. La licence est presque gratuite, mais exigeante quand on travaille à côté.',
          bourse.populaire !== null && bourse.populaire < 100 ? `${100 - bourse.populaire} % des joueurs populaires n’ont pas demandé la bourse à laquelle ils avaient droit : c’est le non-recours.` : 'Tous les joueurs populaires ont demandé leur bourse.',
        ],
        reality: { figure: '−29 %', text: 'Travailler au moins à mi-temps pendant ses études fait baisser de 29 % les chances de réussir ses examens.', source: 'OVE, rapport du Sénat n° 436', cards: ['F20', 'F7'] },
        verdict: 'Le coût des études transforme une inégalité d’argent en inégalité de temps, puis de diplôme.',
        notes: 'Faire le lien avec la licence abandonnée (R18) si c’est arrivé dans la partie.',
      };
    },
  },
  {
    id: 'diplomes',
    title: 'Les diplômes',
    build: ({ chars }) => {
      const bac5 = pctBy(chars, (c) => DIPLOMA_LEVEL[c.diploma ?? 'aucun'] >= 5);
      const sup = pctBy(chars, (c) => DIPLOMA_LEVEL[c.diploma ?? 'aucun'] >= 2);
      const r = ratio(bac5.superieure, bac5.populaire);
      return {
        eyebrow: 'Fin de la partie II',
        title: 'Les inégalités de départ deviennent des écarts de diplômes',
        question: 'Qui sort avec un bac+5 ?',
        charts: [
          { label: 'Diplômés d’un bac+5', unit: '%', game: bac5, real: { populaire: 10, moyenne: null, superieure: 48 }, max: 100 },
          { label: 'Diplômés du supérieur (bac+2 ou plus)', unit: '%', game: sup, real: null, max: 100 },
        ],
        interpretation: [gapSentence(bac5, 'sortent avec un bac+5'), compareGap(r, 4.8)],
        reality: { figure: '48 % / 10 %', text: 'Part de bac+5 chez les jeunes issus de familles cadres, contre environ 10 % pour les ménages les plus modestes.', source: 'France Stratégie (2023)', cards: ['F7', 'F6'] },
        verdict: 'C’est la réponse à notre problématique : l’école transforme les inégalités de départ en inégalités de diplômes.',
        notes: 'Moment clé de l’exposé : bien poser la phrase de verdict.',
      };
    },
  },
  {
    id: 'travail',
    title: 'Le travail',
    build: ({ chars }) => {
      const cadre = pctBy(chars, (c) => c.job === 'cadre' || c.job === 'chef' || c.job === 'fonction_a');
      const cadreOuPi = pctBy(chars, (c) => ['cadre', 'chef', 'fonction_a', 'intermediaire', 'fonction_b'].includes(c.job ?? ''));
      const chomage = pctBy(chars, (c) => c.job === 'chomage');
      const r = ratio(cadreOuPi.superieure, cadreOuPi.populaire);
      return {
        eyebrow: 'Partie III · Le travail',
        title: 'Le diplôme compte, le réseau aussi',
        question: 'Qui devient cadre ou profession intermédiaire ?',
        charts: [
          { label: 'Cadre ou profession intermédiaire', unit: '%', game: cadreOuPi, real: { populaire: 26, moyenne: null, superieure: 73 }, max: 100 },
          { label: 'Cadre ou chef·fe d’entreprise', unit: '%', game: cadre, real: null, max: 100 },
          { label: 'Au chômage à la fin', unit: '%', game: chomage, real: null, max: 100 },
        ],
        interpretation: [
          gapSentence(cadreOuPi, 'sont cadres ou professions intermédiaires'),
          compareGap(r, 2.8),
          'Le stage chez un proche, la promesse d’embauche, le licenciement évité avec 6 contacts : le réseau familial continue d’agir après le diplôme.',
        ],
        reality: { figure: '26 % / 73 %', text: 'Cinq à huit ans après leurs études, 26 % des fils d’ouvrier sont cadres ou professions intermédiaires, contre 73 % des fils de cadre (2019).', source: 'France Stratégie (2023)', cards: ['F11', 'F14', 'F17'] },
        verdict: 'Au travail, l’origine pèse encore, par le diplôme mais aussi par le réseau et parfois le nom.',
        notes: 'Citer F17 (testing) si un joueur a été bloqué à dossier égal.',
      };
    },
  },
  {
    id: 'mobilite',
    title: 'La mobilité sociale',
    build: ({ chars, finals }) => {
      const up = pctBy(chars, (c) => moveOf(c.origin, finals.get(c.id)?.cls ?? c.origin) > 0);
      const down = pctBy(chars, (c) => moveOf(c.origin, finals.get(c.id)?.cls ?? c.origin) < 0);
      const moved = chars.length ? Math.round((chars.filter((c) => moveOf(c.origin, finals.get(c.id)?.cls ?? c.origin) !== 0).length / chars.length) * 100) : 0;
      return {
        eyebrow: 'La pyramide',
        title: 'Monter est dur, descendre est facile',
        question: 'Combien ont changé de classe ?',
        charts: [
          { label: 'Ont monté d’une classe ou plus', unit: '%', game: up, real: null, max: 100 },
          { label: 'Ont descendu', unit: '%', game: down, real: null, max: 100 },
        ],
        interpretation: [
          `${moved} % des joueurs ont changé de classe sociale, souvent d’un seul cran.`,
          up.populaire !== null ? `${up.populaire} % des joueurs populaires ont monté : c’est possible, mais il a fallu enchaîner les bons choix et un peu de chance.` : 'Pas de joueur populaire dans cette partie.',
          'Un joueur supérieur ne descend jamais sous la classe moyenne : la famille sert de filet.',
        ],
        reality: { figure: '65 %', text: '65 % des hommes de 35 à 59 ans appartiennent à un groupe social différent de celui de leur père, mais souvent d’un seul cran.', source: 'Insee, France, portrait social 2025', cards: ['F10', 'F12', 'F13'] },
        verdict: moved >= 50 ? 'La mobilité existe, mais elle reste courte : on monte d’un cran, rarement de deux.' : 'Dans notre partie, la plupart sont restés dans leur classe de départ.',
        notes: 'Revenir sur la pyramide : combien de joueurs populaires sur le podium ?',
      };
    },
  },
  {
    id: 'reforme',
    title: 'Et la réforme ?',
    build: ({ chars, reform }) => {
      const boursiers = pctBy(chars, (c) => c.boursier);
      const selective = pctBy(chars, (c) => c.formation === 'prepa' || c.formation === 'iep' || c.formation === 'but');
      return {
        eyebrow: 'Ce que fait la société',
        title: reform ? `La classe a choisi : ${reform}` : 'Le vote de réforme',
        question: 'Les dispositifs d’égalité ont-ils changé quelque chose ?',
        charts: [
          { label: 'Boursiers', unit: '%', game: boursiers, real: null, max: 100 },
          { label: 'Entrés en prépa, IEP ou BUT (formations à quota)', unit: '%', game: selective, real: null, max: 100 },
        ],
        interpretation: [
          reform === 'Statu quo' || !reform
            ? 'Rien n’a changé : les écarts que vous voyez sont ceux du système actuel.'
            : `La réforme « ${reform} » a aidé certains joueurs, mais elle n’a pas effacé l’écart de départ.`,
          'Bourses, quotas, Cordées, éducation prioritaire, concours : ces dispositifs aident vraiment, mais ils arrivent tard et pour peu d’élèves.',
        ],
        reality: { figure: '15 → 26 %', text: 'L’accès des fils d’ouvrier aux emplois de cadre ou intermédiaire est passé de 15 % (1983) à 26 % (2019) : ça progresse, lentement.', source: 'France Stratégie (2023)', cards: ['F14', 'F19', 'F16'] },
        verdict: 'Corriger après coup aide, mais ne compense pas tout ce qui s’est joué avant.',
        notes: 'Lancer la question du débat : agir dès la maternelle, ou corriger après ?',
      };
    },
  },
];

export const DEBRIEF_IDS = DEBRIEFS.map((d) => d.id);
export const DEBRIEF_TITLES: Record<string, string> = Object.fromEntries(DEBRIEFS.map((d) => [d.id, d.title]));

export function buildDebrief(id: string, input: DebriefInput): DebriefView | null {
  const i = DEBRIEFS.findIndex((d) => d.id === id);
  if (i < 0) return null;
  return { id, index: i, total: DEBRIEFS.length, ...DEBRIEFS[i]!.build(input) };
}

