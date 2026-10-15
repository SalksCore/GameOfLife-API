/**
 * Contenu du jeu : situations, choix et conséquences, étape par étape.
 *
 * Principes :
 * - chaque situation est la même pour tous (affichée au même moment, façon Kahoot), mais les choix
 *   accessibles dépendent du joueur : argent, savoir, réseau, diplômes ;
 * - au lycée et à l'université, la famille paie tout ou partie des dépenses (classe d'origine) ;
 * - les choix risqués réussissent plus souvent avec du savoir, du réseau et un bon moral ;
 * - monter de classe est possible, mais demande plusieurs bons choix d'affilée.
 */
import type { SocialClass, Stage } from '../protocol.js';
import {
  BAC_LABEL,
  DIPLOMA_LABEL,
  JOB_LABEL,
  JOB_LADDER,
  chance,
  fmtMoney,
  type Bac,
  type Diploma,
  type Job,
  type LifePlayer,
  type Option,
  type Outcome,
  type Situation,
} from './model.js';

// ---------------------------------------------------------------- Aides

const atLeast =
  (stat: 'savoir' | 'reseau' | 'moral', n: number, label: string) =>
  (p: LifePlayer): string | null =>
    p.cap[stat] >= n ? null : `Il faut ${n} en ${label} (tu as ${Math.round(p.cap[stat])})`;
const needSavoir = (n: number) => atLeast('savoir', n, 'savoir');
const needReseau = (n: number) => atLeast('reseau', n, 'réseau');
const hasBac = (p: LifePlayer) => !!p.bac && p.bac !== 'aucun';
const needBac = (p: LifePlayer) => (hasBac(p) ? null : 'Il faut le bac');
const needGeneralBac = (p: LifePlayer) =>
  p.bac === 'general' || p.bac === 'mention' ? null : 'Il faut un bac général';
const DIPLOMA_RANK: Diploma[] = ['aucun', 'cap', 'bts', 'licence', 'ecole_commerce', 'master', 'grande_ecole'];
const diplomaAtLeast = (d: Diploma) => (p: LifePlayer) =>
  DIPLOMA_RANK.indexOf(p.diploma ?? 'aucun') >= DIPLOMA_RANK.indexOf(d) ? null : `Il faut au moins : ${DIPLOMA_LABEL[d]}`;
const working = (p: LifePlayer) => !!p.job && p.job !== 'chomage';
const both =
  (...checks: ((p: LifePlayer) => string | null)[]) =>
  (p: LifePlayer) => {
    for (const c of checks) {
      const r = c(p);
      if (r) return r;
    }
    return null;
  };

const good = (text: string, d: Outcome['d'], extra: Partial<Outcome> = {}): Outcome => ({ text, d, tone: 'good', ...extra });
const bad = (text: string, d: Outcome['d'], extra: Partial<Outcome> = {}): Outcome => ({ text, d, tone: 'bad', ...extra });
const meh = (text: string, d: Outcome['d'], extra: Partial<Outcome> = {}): Outcome => ({ text, d, tone: 'neutral', ...extra });

export function promote(p: LifePlayer): Job | null {
  const i = JOB_LADDER.indexOf(p.job ?? 'chomage');
  if (i < 0 || i >= JOB_LADDER.length - 1) return null;
  const next = JOB_LADDER[i + 1]!;
  p.job = next;
  p.titles.push(JOB_LABEL[next]);
  return next;
}
export function setJob(p: LifePlayer, job: Job) {
  p.job = job;
  p.titles.push(JOB_LABEL[job]);
}

// ================================================================= LYCÉE

const LYCEE_FIRST: Situation = {
  id: 'ly-rentree',
  stage: 'lycee',
  emoji: '🎒',
  title: 'Rentrée en seconde',
  text: 'Nouveau lycée, nouvelles têtes. Comment tu abordes cette année ?',
  options: [
    { id: 'serieux', emoji: '📚', label: 'Bosser sérieusement dès le début', hint: '+ savoir', resolve: () => good('Tu prends de bonnes habitudes de travail.', { savoir: 6, moral: -2 }) },
    { id: 'potes', emoji: '🤝', label: 'Se faire un max de potes', hint: '+ réseau', resolve: () => good('Tu deviens vite populaire.', { reseau: 6, moral: 4 }) },
    { id: 'job', emoji: '🧾', label: 'Trouver un petit boulot le week-end', hint: '+ argent', resolve: () => meh('Un peu d’argent de poche, mais moins de temps pour réviser.', { money: 450, savoir: -3, moral: -2 }) },
    { id: 'tranquille', emoji: '😴', label: 'Le minimum syndical', fallback: true, resolve: () => meh('L’année commence tranquillement… trop peut-être.', { savoir: -3, moral: 5 }) },
  ],
};

const LYCEE_LAST: Situation = {
  id: 'ly-bac',
  stage: 'lycee',
  emoji: '📝',
  title: 'Les révisions du bac',
  text: 'Le bac approche. Comment tu révises ?',
  options: [
    { id: 'stage', emoji: '🏫', label: 'Stage de révision intensif', cost: 900, hint: '+ + savoir', resolve: () => good('Une semaine de stage : tu arrives au bac en confiance.', { savoir: 10, moral: 2 }) },
    { id: 'seul', emoji: '🕯️', label: 'Réviser à fond, seul·e', hint: '+ savoir, − moral', resolve: () => good('Des nuits courtes, mais tu connais tes fiches par cœur.', { savoir: 7, moral: -6 }) },
    { id: 'groupe', emoji: '👥', label: 'Réviser avec des amis', hint: '+ savoir, + réseau', resolve: (p, c) => (c.roll(chance(p, 60, { savoir: 0.3 })) ? good('Le groupe te tire vers le haut.', { savoir: 5, reseau: 3 }) : meh('Beaucoup de discussions, peu de révisions…', { savoir: 1, reseau: 4, moral: 3 })) },
    { id: 'chance', emoji: '🍀', label: 'Compter sur la chance', fallback: true, resolve: () => meh('Tu arrives au bac détendu·e… mais pas très préparé·e.', { moral: 5 }) },
  ],
};

const LYCEE_POOL: Situation[] = [
  {
    id: 'ly-cours',
    stage: 'lycee',
    emoji: '📐',
    title: 'Décrochage en maths',
    text: 'Tes notes de maths plongent. Que fais-tu ?',
    options: [
      { id: 'prof', emoji: '👩‍🏫', label: 'Cours particuliers', cost: 600, hint: '+ + savoir', resolve: () => good('Ton prof particulier fait des miracles.', { savoir: 10 }) },
      { id: 'cdi', emoji: '📖', label: 'Aide aux devoirs gratuite au CDI', resolve: (p, c) => (c.roll(chance(p, 55, { moral: 0.4 })) ? good('Tu t’accroches et ça paie.', { savoir: 6 }) : meh('Difficile de rester motivé·e seul·e.', { savoir: 2, moral: -2 })) },
      { id: 'tuto', emoji: '📱', label: 'Tutos vidéo le soir', resolve: () => meh('Un peu mieux, sans plus.', { savoir: 3 }) },
      { id: 'rien', emoji: '🙈', label: 'Laisser tomber les maths', fallback: true, resolve: () => bad('Tes notes continuent de baisser.', { savoir: -4, moral: 2 }) },
    ],
  },
  {
    id: 'ly-stage',
    stage: 'lycee',
    emoji: '💼',
    title: 'Stage d’observation',
    text: 'Tu dois trouver un stage d’une semaine.',
    options: [
      { id: 'famille', emoji: '🏢', label: 'Dans l’entreprise d’un ami de la famille', requires: needReseau(45), hint: 'Réseau', resolve: () => good('Un stage en or dans une grande entreprise : tu rencontres des gens importants.', { reseau: 10, savoir: 2 }, { feed: '🏢 {name} fait son stage chez un ami de la famille' }) },
      { id: 'spontanee', emoji: '✉️', label: 'Candidatures spontanées partout', hint: 'Risqué', resolve: (p, c) => (c.roll(chance(p, 40, { reseau: 0.4, savoir: 0.2 })) ? good('Une agence de com’ te dit oui !', { reseau: 7, moral: 3 }) : bad('Aucune réponse. Tu finis au dernier moment dans un magasin.', { reseau: 1, moral: -4 })) },
      { id: 'local', emoji: '🛒', label: 'Le supermarché du quartier', fallback: true, resolve: () => meh('Une semaine en rayon : instructif, sans plus.', { reseau: 2 }) },
    ],
  },
  {
    id: 'ly-voyage',
    stage: 'lycee',
    emoji: '✈️',
    title: 'Voyage scolaire à Londres',
    text: 'Ta classe part une semaine à Londres.',
    options: [
      { id: 'partir', emoji: '🇬🇧', label: 'Partir', cost: 800, resolve: () => good('Souvenirs, anglais et nouveaux amis.', { savoir: 4, reseau: 4, moral: 8 }) },
      { id: 'aide', emoji: '🤲', label: 'Demander une aide au fonds social', show: (p) => p.origin !== 'riche', hint: 'Pas garanti', resolve: (p, c) => (c.roll(0.6) ? good('Le lycée prend en charge ton voyage !', { savoir: 4, reseau: 4, moral: 8 }) : bad('Dossier refusé, tu restes au lycée.', { moral: -5 })) },
      { id: 'rester', emoji: '🏠', label: 'Rester', fallback: true, resolve: () => meh('Une semaine de cours avec les autres absents.', { moral: -3, savoir: 1 }) },
    ],
  },
  {
    id: 'ly-fete',
    stage: 'lycee',
    emoji: '🎉',
    title: 'Grosse soirée… la veille d’un contrôle',
    text: 'Tout le lycée sera à la soirée de samedi. Contrôle de SES lundi.',
    options: [
      { id: 'fete', emoji: '🕺', label: 'Y aller à fond', hint: 'Risqué', resolve: (p, c) => (c.roll(chance(p, 45, { savoir: 0.5 })) ? good('Soirée mémorable ET bonne note : la classe.', { reseau: 6, moral: 6 }) : bad('Soirée géniale… contrôle raté.', { reseau: 6, moral: 3, savoir: -5 })) },
      { id: 'reviser', emoji: '📚', label: 'Rester réviser', resolve: () => good('Très bonne note au contrôle.', { savoir: 5, moral: -2, reseau: -1 }) },
      { id: 'mix', emoji: '⚖️', label: 'Passer deux heures puis rentrer', fallback: true, resolve: () => meh('Un peu des deux.', { savoir: 2, reseau: 3 }) },
    ],
  },
  {
    id: 'ly-specialites',
    stage: 'lycee',
    emoji: '🧭',
    title: 'Choix de la filière',
    text: 'Fin de seconde : il faut choisir ta voie.',
    options: [
      { id: 'sciences', emoji: '🔬', label: 'Spécialités maths + physique', requires: needSavoir(45), hint: 'Sélectif', resolve: () => good('La voie royale : exigeante mais ouverte sur tout.', { savoir: 8, moral: -4 }, { apply: (p) => p.flags.add('scientifique') }) },
      { id: 'ses', emoji: '🌍', label: 'SES + histoire-géo', resolve: () => good('Tu comprends mieux le monde qui t’entoure.', { savoir: 5, reseau: 2 }) },
      { id: 'arts', emoji: '🎨', label: 'Arts + langues', resolve: () => meh('Tu t’épanouis.', { savoir: 3, moral: 7 }) },
      { id: 'pro', emoji: '🔧', label: 'Bac pro en apprentissage (payé)', hint: '+ argent', fallback: true, resolve: () => meh('Tu apprends un métier et tu touches un salaire d’apprenti.', { money: 1_800, savoir: -3, reseau: 2 }, { apply: (p) => (p.track = 'pro') }) },
    ],
  },
  {
    id: 'ly-delegue',
    stage: 'lycee',
    emoji: '🗳️',
    title: 'Élection des délégués',
    text: 'Les élections de délégués de classe arrivent.',
    options: [
      { id: 'candidat', emoji: '🎤', label: 'Te présenter', hint: 'Risqué', resolve: (p, c) => (c.roll(chance(p, 45, { reseau: 0.5, moral: 0.3 })) ? good('Élu·e ! Tu côtoies la direction et les profs.', { reseau: 10, moral: 4 }, { feed: '🗳️ {name} est élu·e délégué·e' }) : bad('Battu·e de peu. Dur.', { moral: -4, reseau: 2 })) },
      { id: 'soutien', emoji: '📣', label: 'Faire campagne pour un ami', resolve: () => good('Ton ami gagne grâce à toi.', { reseau: 4 }) },
      { id: 'bof', emoji: '🤷', label: 'Pas intéressé·e', fallback: true, resolve: () => meh('Rien ne change.', {}) },
    ],
  },
  {
    id: 'ly-tiktok',
    stage: 'lycee',
    emoji: '📱',
    title: 'Les réseaux sociaux',
    text: 'Tu passes des heures sur ton téléphone…',
    options: [
      { id: 'chaine', emoji: '🎬', label: 'Lancer ta chaîne', hint: 'Très risqué', resolve: (p, c) => (c.roll(0.15) ? good('Une vidéo devient virale ! Des marques te contactent.', { money: 2_500, reseau: 15, moral: 8 }, { feed: '🔥 La chaîne de {name} explose : +2 500 €' }) : bad('Trois abonnés, dont ta mère. Et ton bulletin s’en ressent.', { savoir: -4, moral: -2 })) },
      { id: 'detox', emoji: '📵', label: 'Détox avant le bac blanc', resolve: () => good('Tu te concentres enfin.', { savoir: 5, moral: -2 }) },
      { id: 'scroll', emoji: '🌀', label: 'Continuer à scroller', fallback: true, resolve: () => bad('Le temps file…', { savoir: -3, moral: 2 }) },
    ],
  },
  {
    id: 'ly-ete',
    stage: 'lycee',
    emoji: '☀️',
    title: 'Les vacances d’été',
    text: 'Deux mois de vacances devant toi.',
    options: [
      { id: 'fastfood', emoji: '🍔', label: 'Bosser tout l’été au fast-food', hint: '+ argent', resolve: () => meh('Fatiguant, mais ton compte se remplit.', { money: 1_400, moral: -3 }) },
      { id: 'cabinet', emoji: '⚖️', label: 'Stage dans le cabinet d’un ami de tes parents', requires: needReseau(55), hint: 'Réseau', resolve: () => good('Un stage qui fera très bien sur ton dossier.', { reseau: 12, savoir: 3 }, { feed: '⚖️ {name} décroche un stage grâce au réseau familial' }) },
      { id: 'colo', emoji: '🏕️', label: 'Partir en vacances', cost: 700, resolve: () => good('Tu rentres reposé·e et plein·e d’énergie.', { moral: 12, reseau: 2 }) },
      { id: 'rien', emoji: '🛋️', label: 'Rester chez toi', fallback: true, resolve: () => meh('Un été tranquille.', { moral: 3 }) },
    ],
  },
  {
    id: 'ly-eloquence',
    stage: 'lycee',
    emoji: '🎙️',
    title: 'Concours d’éloquence',
    text: 'Le lycée organise un concours d’éloquence devant un jury.',
    options: [
      { id: 'go', emoji: '🔥', label: 'Participer', hint: 'Risqué', resolve: (p, c) => (c.roll(chance(p, 40, { savoir: 0.4, moral: 0.4 })) ? good('Tu remportes le concours ! Le jury est bluffé.', { reseau: 9, savoir: 4, moral: 7 }, { feed: '🎙️ {name} gagne le concours d’éloquence' }) : bad('Trou de mémoire en plein discours…', { moral: -5, reseau: 1 })) },
      { id: 'coach', emoji: '🧑‍🏫', label: 'Prendre un coach avant', cost: 400, resolve: (p, c) => (c.roll(chance(p, 65, { savoir: 0.3 })) ? good('Bien préparé·e, tu termines sur le podium.', { reseau: 8, savoir: 3, moral: 5 }) : meh('Correct, sans plus.', { reseau: 3 })) },
      { id: 'public', emoji: '👀', label: 'Regarder depuis le public', fallback: true, resolve: () => meh('Un bon moment.', { moral: 1 }) },
    ],
  },
  {
    id: 'ly-harcelement',
    stage: 'lycee',
    emoji: '🛑',
    title: 'Un camarade harcelé',
    text: 'Un élève de ta classe se fait harceler.',
    options: [
      { id: 'adulte', emoji: '🧑‍💼', label: 'Prévenir la CPE', resolve: () => good('La situation est prise en charge. Tu as bien fait.', { moral: 4, reseau: 2 }) },
      { id: 'defendre', emoji: '🛡️', label: 'Le défendre devant tout le monde', hint: 'Risqué', resolve: (p, c) => (c.roll(chance(p, 55, { reseau: 0.3 })) ? good('Les harceleurs reculent. On te respecte.', { reseau: 6, moral: 6 }) : bad('Tu deviens la nouvelle cible…', { moral: -8 })) },
      { id: 'rien', emoji: '😶', label: 'Ne rien dire', fallback: true, resolve: () => bad('Tu culpabilises.', { moral: -4 }) },
    ],
  },
  {
    id: 'ly-ordi',
    stage: 'lycee',
    emoji: '💻',
    title: 'Ton ordinateur lâche',
    text: 'Ton ordi rend l’âme, un dossier noté est à rendre dans trois jours.',
    options: [
      { id: 'neuf', emoji: '🛍️', label: 'En racheter un', cost: 700, resolve: () => good('Dossier rendu à temps.', { savoir: 3 }) },
      { id: 'cdi', emoji: '🏫', label: 'Utiliser les ordis du CDI', resolve: () => meh('Tu y passes tes pauses, mais tu rends ton dossier.', { savoir: 1, moral: -3 }) },
      { id: 'main', emoji: '✍️', label: 'Tout faire à la main', fallback: true, resolve: (p, c) => (c.roll(0.5) ? meh('Ton prof apprécie l’effort.', { savoir: 1 }) : bad('Mauvaise note pour la présentation.', { savoir: -4 })) },
    ],
  },
  {
    id: 'ly-maison',
    stage: 'lycee',
    emoji: '🏚️',
    title: 'Coup dur à la maison',
    text: 'Un de tes parents perd son emploi. L’ambiance est tendue.',
    options: [
      { id: 'aider', emoji: '💪', label: 'Travailler le soir pour aider', hint: '− savoir', resolve: (p) => (p.origin === 'riche' ? meh('Tes parents ont des économies : ils refusent ton aide.', { moral: -2 }) : meh('Tu aides ta famille, au prix de tes révisions.', { money: 300, savoir: -5, moral: -3 })) },
      { id: 'parler', emoji: '💬', label: 'En parler à l’infirmière scolaire', resolve: () => good('Ça fait du bien d’en parler.', { moral: 6 }) },
      { id: 'travail', emoji: '📚', label: 'Te réfugier dans le travail', resolve: () => meh('Tu te concentres sur tes cours.', { savoir: 4, moral: -4 }) },
      { id: 'jeux', emoji: '🎮', label: 'T’évader dans les jeux vidéo', fallback: true, resolve: () => meh('Tu oublies tout… et tes devoirs aussi.', { moral: 2, savoir: -4 }) },
    ],
  },
  {
    id: 'ly-orientation',
    stage: 'lycee',
    emoji: '🧑‍🏫',
    title: 'Rendez-vous d’orientation',
    text: 'La conseillère d’orientation te demande ce que tu vises après le bac.',
    options: [
      { id: 'grande', emoji: '🏛️', label: 'Viser une prépa / grande école', requires: needSavoir(50), resolve: () => good('Elle t’encourage et t’aide à préparer ton dossier.', { savoir: 3, moral: 2 }, { apply: (p) => p.flags.add('ambition') }) },
      { id: 'fac', emoji: '🎓', label: 'Viser l’université', resolve: () => good('Elle te présente les licences qui recrutent.', { savoir: 2 }) },
      { id: 'court', emoji: '🛠️', label: 'Viser un BTS / BUT', resolve: () => good('Des études courtes et concrètes.', { reseau: 2, savoir: 1 }) },
      { id: 'rien', emoji: '❓', label: 'Aucune idée', fallback: true, resolve: () => meh('« Revenez me voir quand vous saurez. »', { moral: -2 }) },
    ],
  },
];

// ================================================================= UNIVERSITÉ

const UNIV_FIRST: Situation = {
  id: 'un-parcoursup',
  stage: 'universite',
  emoji: '🗂️',
  title: 'Parcoursup',
  text: 'Les résultats tombent. Quelle voie choisis-tu après le bac ?',
  options: [
    { id: 'prepa-cordees', emoji: '🪢', label: 'Prépa financée (Cordées de la réussite)', show: (p) => p.flags.has('cordees'), requires: both(needGeneralBac, needSavoir(50)), hint: 'Internat et bourse', resolve: () => good('Admis·e en prépa, logé·e à l’internat : tout est financé.', { savoir: 6, reseau: 4, moral: -4 }, { apply: (p) => (p.cursus = 'prepa'), feed: '🪢 {name} entre en prépa grâce aux Cordées de la réussite' }) },
    { id: 'prepa', emoji: '🏛️', label: 'Classe prépa (puis grande école)', requires: both(needGeneralBac, needSavoir(56)), hint: 'Très sélectif', cost: 1_500, resolve: () => good('Admis·e en prépa ! Deux années intenses commencent.', { savoir: 6, moral: -6 }, { apply: (p) => (p.cursus = 'prepa'), feed: '🏛️ {name} entre en classe prépa' }) },
    { id: 'commerce', emoji: '💎', label: 'École de commerce privée', requires: needBac, cost: 9_000, hint: 'Très cher', resolve: () => good('Bienvenue dans une école réputée… et chère.', { reseau: 14 }, { apply: (p) => (p.cursus = 'commerce') }) },
    { id: 'pret', emoji: '🏦', label: 'École de commerce avec un prêt étudiant', show: (p) => p.origin !== 'riche', requires: both(needBac, needSavoir(45)), hint: '−12 000 € de dette', resolve: () => meh('La banque te prête l’argent. Il faudra rembourser.', { money: -12_000, reseau: 14, moral: -4 }, { apply: (p) => (p.cursus = 'commerce'), feed: '🏦 {name} s’endette pour une école de commerce' }) },
    { id: 'licence', emoji: '🎓', label: 'Licence à l’université', requires: needGeneralBac, resolve: () => good('Tu entres à la fac : liberté et autonomie.', { moral: 3 }, { apply: (p) => (p.cursus = 'licence') }) },
    { id: 'court', emoji: '🛠️', label: 'BTS / BUT', requires: needBac, resolve: () => good('Des études courtes, encadrées et professionnalisantes.', { savoir: 2 }, { apply: (p) => (p.cursus = 'court') }) },
    { id: 'alternance', emoji: '🔁', label: 'Alternance (payée)', requires: needBac, hint: '+ argent', resolve: () => good('Moitié école, moitié entreprise, avec un salaire.', { money: 2_500, reseau: 4 }, { apply: (p) => (p.cursus = 'alternance') }) },
    { id: 'cap', emoji: '🧰', label: 'Formation pro courte (CAP)', show: (p) => !hasBac(p), resolve: () => meh('Un métier en un an.', { savoir: 2 }, { apply: (p) => (p.cursus = 'cap') }) },
    { id: 'actif', emoji: '🏃', label: 'Arrêter les études et travailler', fallback: true, hint: '+ argent', resolve: () => meh('Tu entres tout de suite dans la vie active.', { money: 2_200 }, { apply: (p) => { p.cursus = 'aucun'; p.flags.add('experience'); } }) },
  ],
};

const UNIV_LAST: Situation = {
  id: 'un-master',
  stage: 'universite',
  emoji: '🎯',
  title: 'Dernière année',
  text: 'Fin de cursus en vue. Tu continues ou tu t’arrêtes ?',
  options: [
    { id: 'master', emoji: '📜', label: 'Candidater en master sélectif', show: (p) => p.cursus === 'licence', requires: needSavoir(55), resolve: (p, c) => (c.roll(chance(p, 60, { savoir: 0.5 })) ? good('Accepté·e en master !', { savoir: 4 }, { apply: (q) => q.flags.add('master'), feed: '📜 {name} est admis·e en master' }) : bad('Refusé·e partout. Ce sera la licence.', { moral: -6 })) },
    { id: 'etranger', emoji: '🌐', label: 'Master à l’étranger', show: (p) => p.cursus === 'licence', cost: 6_000, requires: needSavoir(48), resolve: () => good('Un master international : ton CV brille.', { savoir: 4, reseau: 8 }, { apply: (q) => q.flags.add('master') }) },
    { id: 'concours', emoji: '🏆', label: 'Tout donner pour les concours', show: (p) => p.cursus === 'prepa', resolve: () => meh('Des mois de travail acharné.', { savoir: 9, moral: -8 }) },
    { id: 'reseau', emoji: '🤝', label: 'Soigner ton réseau avant le diplôme', resolve: () => good('Tu connais du monde dans ton secteur.', { reseau: 6 }) },
    { id: 'reviser', emoji: '📚', label: 'Assurer tes examens', fallback: true, resolve: () => good('Tu sécurises ton diplôme.', { savoir: 4 }) },
  ],
};

const UNIV_POOL: Situation[] = [
  {
    id: 'un-logement',
    stage: 'universite',
    emoji: '🏠',
    title: 'Se loger',
    text: 'Ta formation est loin de chez tes parents.',
    options: [
      { id: 'studio', emoji: '🏙️', label: 'Studio en centre-ville', cost: 2_400, resolve: () => good('Ton chez-toi, à deux pas des cours.', { moral: 6, savoir: 2 }) },
      { id: 'coloc', emoji: '🛋️', label: 'Colocation', cost: 1_000, resolve: () => good('Des colocs devenus amis.', { reseau: 6, moral: 4 }) },
      { id: 'crous', emoji: '🏢', label: 'Résidence CROUS', show: (p) => p.origin !== 'riche', hint: 'Pas garanti', resolve: (p, c) => (c.roll(0.5) ? good('Chambre obtenue pour pas cher !', { money: -300, savoir: 2 }) : bad('Liste d’attente. Tu fais 1 h 30 de trajet par jour.', { moral: -6, savoir: -3 })) },
      { id: 'parents', emoji: '🚆', label: 'Rester chez tes parents', fallback: true, resolve: () => meh('Économique, mais beaucoup de transport.', { moral: -3, savoir: -2 }) },
    ],
  },
  {
    id: 'un-bourse',
    stage: 'universite',
    emoji: '💶',
    title: 'Bourse sur critères sociaux',
    text: 'Le dossier de bourse du CROUS est ouvert.',
    options: [
      { id: 'dossier', emoji: '📄', label: 'Faire le dossier', show: (p) => p.origin !== 'riche', resolve: (p) => (p.origin === 'basse' ? good('Bourse échelon maximal : un vrai coup de pouce.', { money: 3_000, moral: 3 }) : meh('Petit échelon : c’est toujours ça.', { money: 900 })) },
      { id: 'parents', emoji: '👨‍👩‍👧', label: 'Demander à tes parents', resolve: (p) => (p.origin === 'riche' ? good('Tes parents te versent une rente mensuelle.', { money: 6_000 }) : p.origin === 'moyenne' ? meh('Ils t’aident un peu.', { money: 1_200 }) : bad('Ils n’ont pas les moyens…', { moral: -3 })) },
      { id: 'rien', emoji: '🙅', label: 'Ne rien demander', fallback: true, resolve: () => meh('Tu te débrouilles seul·e.', {}) },
    ],
  },
  {
    id: 'un-job',
    stage: 'universite',
    emoji: '🧑‍🍳',
    title: 'Job étudiant',
    text: 'Les fins de mois sont difficiles. Tu prends un job ?',
    options: [
      { id: 'caisse', emoji: '🛒', label: 'Caissier·e 15 h par semaine', hint: '+ argent, − savoir', resolve: () => meh('Tu payes ton loyer, mais tu rates des cours.', { money: 2_000, savoir: -5, moral: -4 }) },
      { id: 'babysit', emoji: '🧸', label: 'Baby-sitting dans des familles aisées', resolve: () => good('Bien payé, et tu rencontres des parents influents.', { money: 1_000, reseau: 5 }) },
      { id: 'cours', emoji: '🧑‍🏫', label: 'Donner des cours particuliers', requires: needSavoir(55), resolve: () => good('Bien payé et ça entretient tes connaissances.', { money: 1_500, savoir: 2 }) },
      { id: 'non', emoji: '📚', label: 'Non, je me concentre', fallback: true, resolve: (p) => (p.cap.money < 500 ? bad('Les fins de mois sont très dures.', { savoir: 3, moral: -6 }) : good('Tu peux te consacrer à tes études.', { savoir: 4 })) },
    ],
  },
  {
    id: 'un-partiels',
    stage: 'universite',
    emoji: '🧠',
    title: 'Les partiels',
    text: 'Semaine de partiels. Ta stratégie ?',
    options: [
      { id: 'bachoter', emoji: '🔥', label: 'Bachoter jour et nuit', resolve: () => good('Bonnes notes, gros cernes.', { savoir: 7, moral: -6 }) },
      { id: 'fiches', emoji: '🗒️', label: 'Fiches en groupe avec ta promo', resolve: () => good('Efficace et sympa.', { savoir: 4, reseau: 3 }) },
      { id: 'triche', emoji: '🕵️', label: 'Tricher', hint: 'Très risqué', resolve: (p, c) => (c.roll(0.65) ? meh('Ni vu ni connu…', { savoir: 2 }) : bad('Pris·e la main dans le sac : conseil de discipline.', { savoir: -12, moral: -10, reseau: -5 }, { feed: '🚨 {name} s’est fait prendre en train de tricher' })) },
      { id: 'secher', emoji: '🛌', label: 'Réviser au dernier moment', fallback: true, resolve: () => bad('Rattrapages en vue…', { savoir: -2, moral: 2 }) },
    ],
  },
  {
    id: 'un-erasmus',
    stage: 'universite',
    emoji: '🇪🇸',
    title: 'Erasmus',
    text: 'Un semestre à Barcelone, ça te tente ?',
    options: [
      { id: 'partir', emoji: '✈️', label: 'Partir', cost: 2_500, resolve: () => good('Le meilleur semestre de ta vie.', { reseau: 10, savoir: 5, moral: 10 }) },
      { id: 'bourse', emoji: '🎫', label: 'Partir avec une bourse de mobilité', requires: needSavoir(52), cost: 700, resolve: () => good('Ton dossier est retenu, la bourse couvre l’essentiel.', { reseau: 10, savoir: 5, moral: 10 }) },
      { id: 'rester', emoji: '🏠', label: 'Rester', fallback: true, resolve: () => meh('Tes amis te racontent leurs aventures sur Instagram.', { moral: -2 }) },
    ],
  },
  {
    id: 'un-bde',
    stage: 'universite',
    emoji: '🎪',
    title: 'Association étudiante',
    text: 'Le bureau des élèves cherche du monde.',
    options: [
      { id: 'president', emoji: '👑', label: 'Viser la présidence', hint: 'Risqué', resolve: (p, c) => (c.roll(chance(p, 40, { reseau: 0.6 })) ? good('Président·e ! Ton carnet d’adresses explose.', { reseau: 14, savoir: -4 }, { feed: '👑 {name} prend la tête de l’asso étudiante' }) : meh('Battu·e, mais tu restes dans l’équipe.', { reseau: 5, moral: -3 })) },
      { id: 'benevole', emoji: '🙋', label: 'Bénévole', resolve: () => good('Tu rencontres plein de monde.', { reseau: 6, moral: 4 }) },
      { id: 'non', emoji: '🙅', label: 'Pas le temps', fallback: true, resolve: () => meh('Tu restes concentré·e sur tes cours.', { savoir: 2 }) },
    ],
  },
  {
    id: 'un-stage',
    stage: 'universite',
    emoji: '🏢',
    title: 'Stage obligatoire',
    text: 'Tu dois trouver un stage de trois mois.',
    options: [
      { id: 'piston', emoji: '🔑', label: 'Grand groupe, grâce à un contact', requires: needReseau(55), hint: 'Réseau', resolve: () => good('Stage prestigieux, gratifié, avec une promesse d’embauche.', { reseau: 12, savoir: 4, money: 1_800 }, { apply: (p) => p.flags.add('promesse'), feed: '🔑 {name} décroche un stage dans un grand groupe' }) },
      { id: 'candidater', emoji: '📮', label: 'Postuler partout', hint: 'Risqué', resolve: (p, c) => (c.roll(chance(p, 40, { savoir: 0.4, reseau: 0.4 })) ? good('Une belle entreprise te prend.', { reseau: 8, money: 1_200, savoir: 2 }) : bad('Cinquante candidatures, aucune réponse. Tu prends ce qui reste.', { reseau: 2, moral: -6 })) },
      { id: 'petit', emoji: '🏪', label: 'Petite entreprise locale', fallback: true, resolve: () => meh('Tu touches à tout.', { reseau: 4, savoir: 2 }) },
    ],
  },
  {
    id: 'un-burnout',
    stage: 'universite',
    emoji: '😮‍💨',
    title: 'La pression monte',
    text: 'Fatigue, stress, sommeil en vrac…',
    options: [
      { id: 'psy', emoji: '🛋️', label: 'Voir un psy', cost: 400, resolve: () => good('Tu reprends pied.', { moral: 15 }) },
      { id: 'sport', emoji: '🏃', label: 'Sport et sommeil', resolve: () => good('Tu retrouves de l’énergie.', { moral: 9, savoir: -1 }) },
      { id: 'tenir', emoji: '🧱', label: 'Tenir coûte que coûte', fallback: true, resolve: () => bad('Tu tiens… mais à quel prix.', { savoir: 3, moral: -12 }) },
    ],
  },
  {
    id: 'un-startup',
    stage: 'universite',
    emoji: '🚀',
    title: 'Projet de start-up',
    text: 'Avec deux amis, vous avez une idée d’appli.',
    options: [
      { id: 'lancer', emoji: '💡', label: 'Lancer la start-up', cost: 2_000, hint: 'Très risqué', resolve: (p, c) => (c.roll(chance(p, 20, { reseau: 0.3, savoir: 0.2 })) ? good('Des investisseurs rachètent votre appli !', { money: 12_000, reseau: 12 }, { feed: '🚀 La start-up de {name} est rachetée : +12 000 €' }) : bad('L’appli ne décolle pas. Argent perdu.', { moral: -8, reseau: 3 })) },
      { id: 'aider', emoji: '🧑‍💻', label: 'Aider sans investir', resolve: () => meh('Belle expérience.', { reseau: 5, savoir: 2 }) },
      { id: 'non', emoji: '✋', label: 'Refuser', fallback: true, resolve: () => meh('Tu restes sur tes études.', { savoir: 2 }) },
    ],
  },
  {
    id: 'un-pret',
    stage: 'universite',
    emoji: '🏦',
    title: 'La banque te propose un prêt',
    text: 'Un conseiller te propose un prêt étudiant de 8 000 €.',
    options: [
      { id: 'oui', emoji: '✍️', label: 'Accepter', hint: 'À rembourser (+ intérêts)', resolve: () => meh('Ton compte est plein… pour l’instant.', { money: 8_000, moral: 3 }, { apply: (p) => p.flags.add('pret') }) },
      { id: 'non', emoji: '🙅', label: 'Refuser', fallback: true, resolve: () => meh('Pas de dette, pas de stress.', {}) },
    ],
  },
  {
    id: 'un-afterwork',
    stage: 'universite',
    emoji: '🥂',
    title: 'Soirée des anciens',
    text: 'L’association des anciens organise un cocktail.',
    options: [
      { id: 'costume', emoji: '👔', label: 'Y aller sur ton 31', cost: 250, resolve: () => good('Tu repars avec trois cartes de visite.', { reseau: 9 }) },
      { id: 'linkedin', emoji: '💻', label: 'Plutôt soigner ton LinkedIn', resolve: () => meh('Quelques contacts en ligne.', { reseau: 4 }) },
      { id: 'non', emoji: '🏠', label: 'Rester chez toi', fallback: true, resolve: () => meh('Soirée série.', { moral: 3 }) },
    ],
  },
  {
    id: 'un-concours',
    stage: 'universite',
    emoji: '🏆',
    title: 'Concours national',
    text: 'Un concours national récompense les meilleurs projets étudiants.',
    options: [
      { id: 'go', emoji: '🔥', label: 'Participer', hint: 'Risqué', resolve: (p, c) => (c.roll(chance(p, 35, { savoir: 0.6 })) ? good('Premier prix ! Ton nom circule.', { money: 3_000, reseau: 10, savoir: 3 }, { feed: '🏆 {name} remporte le concours national' }) : meh('Belle expérience, pas de prix.', { savoir: 3, moral: -2 })) },
      { id: 'non', emoji: '🙂', label: 'Pas cette année', fallback: true, resolve: () => meh('Tu restes sur tes cours.', { savoir: 1 }) },
    ],
  },
];

// ================================================================= TRAVAIL

const TRAVAIL_FIRST: Situation = {
  id: 'tr-emploi',
  stage: 'travail',
  emoji: '📨',
  title: 'Premier emploi',
  text: 'Diplôme en poche (ou pas), tu cherches ton premier poste.',
  options: [
    { id: 'cadre', emoji: '🏙️', label: 'Cadre dans un grand groupe', requires: diplomaAtLeast('ecole_commerce'), resolve: () => good('CDI de cadre signé.', { reseau: 4 }, { apply: (p) => setJob(p, 'cadre'), feed: '🏙️ {name} est embauché·e comme cadre' }) },
    { id: 'piston', emoji: '🔑', label: 'Le poste promis par ton réseau', requires: (p) => (p.flags.has('promesse') || p.cap.reseau >= 70 ? null : 'Il faut un très bon réseau (70) ou une promesse d’embauche'), resolve: () => good('Un coup de fil, et c’est signé.', { reseau: 3 }, { apply: (p) => setJob(p, 'cadre'), feed: '🔑 {name} est embauché·e grâce à son réseau' }) },
    { id: 'technicien', emoji: '🧪', label: 'Technicien·ne / commercial·e', requires: diplomaAtLeast('bts'), resolve: () => good('Un poste qualifié.', {}, { apply: (p) => setJob(p, 'technicien') }) },
    { id: 'employe', emoji: '🗃️', label: 'Employé·e de bureau ou de vente', requires: (p) => (hasBac(p) || (p.diploma && p.diploma !== 'aucun') ? null : 'Il faut le bac ou un diplôme'), resolve: () => meh('Un CDD qui peut devenir un CDI.', {}, { apply: (p) => setJob(p, 'employe') }) },
    { id: 'ouvrier', emoji: '🏗️', label: 'Ouvrier·e en intérim', resolve: () => meh('Du travail physique, mais du travail.', {}, { apply: (p) => setJob(p, 'ouvrier') }) },
    { id: 'creer', emoji: '🚀', label: 'Créer ton entreprise', cost: 4_000, hint: 'Risqué', resolve: () => meh('Tu te lances à ton compte !', { moral: 5 }, { apply: (p) => setJob(p, 'entrepreneur'), feed: '🚀 {name} crée son entreprise' }) },
    { id: 'chercher', emoji: '🔍', label: 'Continuer à chercher', fallback: true, resolve: () => bad('Rien pour l’instant… Pôle emploi t’attend.', { moral: -5 }, { apply: (p) => setJob(p, 'chomage') }) },
  ],
};

const TRAVAIL_LAST: Situation = {
  id: 'tr-bilan',
  stage: 'travail',
  emoji: '🧓',
  title: 'Préparer l’avenir',
  text: 'Les années passent. Comment prépares-tu la suite ?',
  options: [
    { id: 'immo', emoji: '🏡', label: 'Acheter un logement', requires: (p) => (p.cap.money >= 20_000 ? null : 'Il faut 20 000 € d’apport'), resolve: () => good('Propriétaire ! Un patrimoine qui prendra de la valeur.', { money: 8_000, moral: 6 }, { feed: '🏡 {name} devient propriétaire' }) },
    { id: 'transmettre', emoji: '🎁', label: 'Épargner pour tes enfants', requires: (p) => (p.cap.money >= 3_000 ? null : 'Il faut 3 000 € d’épargne'), resolve: () => good('Tes enfants partiront avec un coup de pouce.', { moral: 5 }) },
    { id: 'formation', emoji: '📚', label: 'Te former encore', cost: 1_000, resolve: () => good('Tu restes à la page.', { savoir: 6 }) },
    { id: 'profiter', emoji: '🌴', label: 'Profiter de la vie', fallback: true, resolve: () => meh('Tu profites.', { moral: 8, money: -500 }) },
  ],
};

const TRAVAIL_POOL: Situation[] = [
  {
    id: 'tr-augmentation',
    stage: 'travail',
    emoji: '💰',
    title: 'Entretien annuel',
    text: 'C’est l’heure de l’entretien annuel.',
    options: [
      { id: 'negocier', emoji: '🗣️', label: 'Négocier une augmentation', requires: (p) => (working(p) && p.job !== 'entrepreneur' ? null : 'Il faut un emploi salarié'), hint: 'Risqué', resolve: (p, c) => (c.roll(chance(p, 45, { reseau: 0.3, savoir: 0.3, moral: 0.2 })) ? good('+20 % de salaire !', { moral: 5 }, { apply: (q) => (q.raise += 0.2) }) : bad('« Ce n’est pas le moment. »', { moral: -5 })) },
      { id: 'objectifs', emoji: '🎯', label: 'Proposer de nouveaux objectifs', show: working, resolve: () => meh('Ta cheffe apprécie ton implication.', { reseau: 3 }) },
      { id: 'pole', emoji: '📋', label: 'Rendez-vous à Pôle emploi', show: (p) => !working(p), resolve: (p, c) => (c.roll(chance(p, 45, { savoir: 0.3, reseau: 0.3 })) ? good('Une offre d’employé·e t’attend !', {}, { apply: (q) => setJob(q, 'employe') }) : meh('On te propose une formation.', { savoir: 4 })) },
      { id: 'rien', emoji: '🤐', label: 'Ne rien demander', fallback: true, resolve: () => meh('Rien ne change.', {}) },
    ],
  },
  {
    id: 'tr-promotion',
    stage: 'travail',
    emoji: '📈',
    title: 'Un poste se libère',
    text: 'Un poste au-dessus du tien se libère.',
    options: [
      { id: 'postuler', emoji: '🙋', label: 'Postuler', show: (p) => working(p) && p.job !== 'entrepreneur' && p.job !== 'dirigeant', hint: 'Risqué', resolve: (p, c) => (c.roll(chance(p, 35, { savoir: 0.4, reseau: 0.4 })) ? good('Promotion !', { moral: 6 }, { apply: (q) => void promote(q), feed: '📈 {name} obtient une promotion' }) : bad('Le poste revient au neveu du directeur.', { moral: -5 })) },
      { id: 'formation', emoji: '🌙', label: 'Formation qualifiante le soir', cost: 1_500, resolve: () => good('Tu montes en compétences.', { savoir: 8, moral: -3 }) },
      { id: 'interim', emoji: '🔧', label: 'Enchaîner les missions d’intérim', show: (p) => !working(p), resolve: () => meh('Quelques mois de travail.', { money: 900 }, { apply: (q) => setJob(q, 'ouvrier') }) },
      { id: 'rester', emoji: '🪑', label: 'Rester à ta place', fallback: true, resolve: () => meh('Tu gardes ton confort.', { moral: 2 }) },
    ],
  },
  {
    id: 'tr-licenciement',
    stage: 'travail',
    emoji: '📉',
    title: 'Plan social',
    text: 'Une grande entreprise de la région annonce des licenciements.',
    options: [
      { id: 'prime', emoji: '💼', label: 'Partir avec une prime', show: (p) => working(p) && p.job !== 'entrepreneur', resolve: () => meh('Prime de départ empochée, mais te voilà sans emploi.', { money: 6_000 }, { apply: (q) => setJob(q, 'chomage') }) },
      { id: 'resister', emoji: '✊', label: 'Te battre pour garder ton poste', show: (p) => working(p) && p.job !== 'entrepreneur', hint: 'Risqué', resolve: (p, c) => (c.roll(chance(p, 60, { reseau: 0.4 })) ? good('Ton poste est sauvé.', { reseau: 3 }) : bad('Licencié·e quand même.', { moral: -10 }, { apply: (q) => setJob(q, 'chomage'), feed: '📉 {name} perd son emploi' })) },
      { id: 'postuler', emoji: '🔍', label: 'Postuler sur les postes qui restent', show: (p) => !working(p), resolve: (p, c) => (c.roll(chance(p, 30, { reseau: 0.4 })) ? good('Tu retrouves du travail.', {}, { apply: (q) => setJob(q, 'employe') }) : bad('La concurrence est rude.', { moral: -4 })) },
      { id: 'attendre', emoji: '⏳', label: 'Attendre de voir', fallback: true, resolve: (p, c) => (working(p) && p.job !== 'entrepreneur' && c.roll(0.3) ? bad('Tu fais partie de la liste…', { moral: -10 }, { apply: (q) => setJob(q, 'chomage'), feed: '📉 {name} perd son emploi' }) : meh('Tu passes entre les gouttes.', {})) },
    ],
  },
  {
    id: 'tr-investir',
    stage: 'travail',
    emoji: '📊',
    title: 'Que faire de tes économies ?',
    text: 'Ton banquier te propose plusieurs placements.',
    options: [
      { id: 'bourse', emoji: '📈', label: 'Placer la moitié en bourse', requires: (p) => (p.cap.money >= 2_000 ? null : 'Il faut 2 000 € d’épargne'), hint: 'Risqué', resolve: (p, c) => { const half = Math.round(p.cap.money / 2); return c.roll(0.55) ? good(`Les marchés montent : +${fmtMoney(half * 0.4)}.`, { money: half * 0.4 }) : bad(`Krach ! Tu perds ${fmtMoney(half * 0.35)}.`, { money: -half * 0.35 }); } },
      { id: 'crypto', emoji: '🪙', label: 'Tout miser sur une crypto', requires: (p) => (p.cap.money >= 500 ? null : 'Il faut 500 € d’épargne'), hint: 'Très risqué', resolve: (p, c) => (c.roll(0.25) ? good('To the moon ! Ton placement est multiplié par 3.', { money: p.cap.money * 2 }, { feed: '🪙 {name} fait fortune en crypto' }) : bad('La crypto s’effondre : -80 %.', { money: -p.cap.money * 0.8, moral: -8 }, { feed: '🪙 {name} perd presque tout en crypto' })) },
      { id: 'livret', emoji: '🐷', label: 'Livret A', resolve: (p) => meh('Ça rapporte peu, mais c’est sûr.', { money: Math.max(0, Math.round(p.cap.money * 0.03)) }) },
      { id: 'rien', emoji: '🤷', label: 'Rien du tout', fallback: true, resolve: () => meh('L’inflation grignote ton épargne.', { money: -100 }) },
    ],
  },
  {
    id: 'tr-reseau',
    stage: 'travail',
    emoji: '⛳',
    title: 'Réseauter',
    text: 'Ton patron t’invite à son club de golf. Tes collègues font un afterwork.',
    options: [
      { id: 'golf', emoji: '⛳', label: 'Rejoindre le club de golf', cost: 3_000, resolve: () => good('Tu joues avec des dirigeants de la région.', { reseau: 15 }) },
      { id: 'afterwork', emoji: '🍻', label: 'L’afterwork avec les collègues', cost: 60, resolve: () => good('Bonne ambiance d’équipe.', { reseau: 6, moral: 3 }) },
      { id: 'rentrer', emoji: '🏠', label: 'Rentrer chez toi', fallback: true, resolve: () => meh('Soirée tranquille.', { moral: 3 }) },
    ],
  },
  {
    id: 'tr-burnout',
    stage: 'travail',
    emoji: '🔋',
    title: 'Épuisement',
    text: 'Tu enchaînes les heures sup’ et tu n’en peux plus.',
    options: [
      { id: 'arret', emoji: '🩺', label: 'Arrêt maladie', resolve: () => meh('Tu te soignes.', { moral: 15, money: -400 }) },
      { id: 'tenir', emoji: '🧱', label: 'Tenir pour être bien vu·e', hint: 'Risqué', resolve: (p, c) => (c.roll(chance(p, 30, { moral: 0.5 })) ? good('Ton investissement est remarqué : promotion !', { moral: -8 }, { apply: (q) => void promote(q) }) : bad('Burn-out. Plusieurs mois d’arrêt.', { moral: -18, money: -1_000 }, { feed: '🔋 {name} fait un burn-out' })) },
      { id: 'demission', emoji: '🚪', label: 'Démissionner', resolve: () => meh('Libéré·e, mais sans emploi.', { moral: 12 }, { apply: (q) => setJob(q, 'chomage') }) },
      { id: 'rien', emoji: '😐', label: 'Continuer comme ça', fallback: true, resolve: () => bad('Ça ne va pas en s’arrangeant.', { moral: -8 }) },
    ],
  },
  {
    id: 'tr-famille',
    stage: 'travail',
    emoji: '🏥',
    title: 'Un parent tombe malade',
    text: 'Ton père a besoin d’aide au quotidien.',
    options: [
      { id: 'payer', emoji: '💳', label: 'Payer une aide à domicile', cost: 3_000, resolve: () => good('Il est bien entouré, tu peux continuer à travailler.', { moral: 2 }) },
      { id: 'temps', emoji: '🕰️', label: 'Passer à temps partiel pour t’en occuper', resolve: () => meh('Tu es présent·e pour lui, mais ton salaire baisse.', { money: -2_000, moral: -4 }) },
      { id: 'famille', emoji: '👨‍👩‍👧‍👦', label: 'Organiser un relais familial', resolve: (p, c) => (c.roll(chance(p, 50, { reseau: 0.5 })) ? good('Toute la famille se relaie.', { moral: 3 }) : bad('Tu te retrouves seul·e à gérer.', { moral: -8, money: -800 })) },
      { id: 'rien', emoji: '😔', label: 'Ne pas t’en mêler', fallback: true, resolve: () => bad('Tu culpabilises beaucoup.', { moral: -10 }) },
    ],
  },
  {
    id: 'tr-chasseur',
    stage: 'travail',
    emoji: '🎯',
    title: 'Un chasseur de têtes appelle',
    text: 'Une entreprise concurrente veut te recruter.',
    options: [
      { id: 'accepter', emoji: '🤝', label: 'Accepter l’offre', requires: (p) => (p.cap.savoir >= 55 || p.cap.reseau >= 55 ? null : 'Il faut 55 en savoir ou en réseau'), resolve: (p) => (working(p) && p.job !== 'entrepreneur' ? good('Nouveau poste, un cran au-dessus !', { reseau: 4 }, { apply: (q) => void promote(q), feed: '🎯 {name} est débauché·e par la concurrence' }) : good('Il te propose un poste d’employé·e.', {}, { apply: (q) => setJob(q, 'employe') })) },
      { id: 'negocier', emoji: '💬', label: 'Faire monter les enchères chez ton employeur', show: working, hint: 'Risqué', resolve: (p, c) => (c.roll(chance(p, 45, { reseau: 0.4 })) ? good('Ton employeur s’aligne : +15 % !', {}, { apply: (q) => (q.raise += 0.15) }) : bad('Bluff raté, l’ambiance est tendue.', { moral: -5, reseau: -3 })) },
      { id: 'refuser', emoji: '🙅', label: 'Refuser', fallback: true, resolve: () => meh('Tu restes fidèle.', {}) },
    ],
  },
  {
    id: 'tr-side',
    stage: 'travail',
    emoji: '🌙',
    title: 'Un projet le soir',
    text: 'Tu as une idée de projet à côté de ton travail.',
    options: [
      { id: 'freelance', emoji: '💻', label: 'Missions en freelance le soir', resolve: (p, c) => (c.roll(0.12) ? good('Un gros client t’adore : contrat énorme !', { money: 15_000, reseau: 8 }, { feed: '💻 {name} signe un énorme contrat en freelance' }) : meh('Quelques missions bien payées, beaucoup de fatigue.', { money: 1_800, moral: -6 })) },
      { id: 'asso', emoji: '🤲', label: 'Créer une association', resolve: () => good('Tu fais des rencontres qui comptent.', { reseau: 7, moral: 6 }) },
      { id: 'repos', emoji: '😌', label: 'Garder tes soirées', fallback: true, resolve: () => meh('Tu te reposes.', { moral: 5 }) },
    ],
  },
  {
    id: 'tr-levee',
    stage: 'travail',
    emoji: '🦄',
    title: 'Monter une grosse entreprise',
    text: 'Des investisseurs cherchent des projets ambitieux.',
    options: [
      { id: 'lever', emoji: '🦄', label: 'Lever des fonds', requires: both(needReseau(55), (p) => (p.cap.money >= 5_000 ? null : 'Il faut 5 000 € d’apport')), hint: 'Très risqué', resolve: (p, c) => (c.roll(chance(p, 35, { reseau: 0.5, savoir: 0.3 })) ? good('Levée réussie ! Tu diriges désormais ta société.', { money: 25_000, reseau: 12 }, { apply: (q) => setJob(q, 'dirigeant'), feed: '🦄 {name} lève des fonds et devient dirigeant·e' }) : bad('Les investisseurs se retirent. Tu perds ton apport.', { money: -5_000, moral: -10 })) },
      { id: 'associe', emoji: '🤝', label: 'Devenir associé·e d’un ami', cost: 2_000, resolve: (p, c) => (c.roll(0.45) ? good('L’entreprise marche bien.', { money: 7_000, reseau: 5 }) : bad('Elle met la clé sous la porte.', { moral: -5 })) },
      { id: 'non', emoji: '✋', label: 'Pas pour toi', fallback: true, resolve: () => meh('Tu préfères la sécurité.', {}) },
    ],
  },
  {
    id: 'tr-reconversion',
    stage: 'travail',
    emoji: '🔄',
    title: 'Envie de changement',
    text: 'Ton travail ne te plaît plus vraiment.',
    options: [
      { id: 'vae', emoji: '🎓', label: 'Reprendre des études (VAE)', cost: 1_500, resolve: (p) => {
          // La VAE valide l'expérience : au mieux un master, jamais une grande école
          const i = DIPLOMA_RANK.indexOf(p.diploma ?? 'aucun');
          const max = DIPLOMA_RANK.indexOf('master');
          if (i >= max) return good('Une formation de plus sur ton CV.', { savoir: 6 });
          const next = DIPLOMA_RANK[i < DIPLOMA_RANK.indexOf('bts') ? DIPLOMA_RANK.indexOf('bts') : i === DIPLOMA_RANK.indexOf('ecole_commerce') ? max : i + 1]!;
          return good(`Nouveau diplôme : ${DIPLOMA_LABEL[next]} !`, { savoir: 6 }, { apply: (q) => { q.diploma = next; q.titles.push(DIPLOMA_LABEL[next]); } });
        } },
      { id: 'foodtruck', emoji: '🚚', label: 'Ouvrir un food-truck', cost: 5_000, hint: 'Risqué', resolve: () => meh('Te voilà à ton compte !', { moral: 8 }, { apply: (q) => setJob(q, 'entrepreneur') }) },
      { id: 'rester', emoji: '🪑', label: 'Rester', fallback: true, resolve: () => meh('La sécurité avant tout.', { moral: -2 }) },
    ],
  },
  {
    id: 'tr-greve',
    stage: 'travail',
    emoji: '✊',
    title: 'Appel à la grève',
    text: 'Les syndicats appellent à la grève pour les salaires.',
    options: [
      { id: 'greve', emoji: '📢', label: 'Faire grève', show: working, resolve: (p, c) => (c.roll(0.5) ? good('Victoire : +10 % pour tout le monde !', { money: -300, reseau: 4 }, { apply: (q) => (q.raise += 0.1) }) : meh('Rien obtenu, une journée de salaire en moins.', { money: -300, reseau: 3 })) },
      { id: 'discret', emoji: '🤫', label: 'Te faire discret·e', fallback: true, resolve: () => meh('Tu continues ton travail.', {}) },
      { id: 'patron', emoji: '🤝', label: 'Soutenir la direction', show: working, resolve: () => meh('La direction s’en souviendra… tes collègues aussi.', { reseau: 2, moral: -3 }) },
    ],
  },
];

// ================================================================= Étapes

const byId = (list: Situation[], id: string) => list.find((s) => s.id === id)!;

/**
 * Situations de chaque étape :
 * - opening : moment clé, obligatoire pour tous au début de l'étape (filière, Parcoursup, premier emploi) ;
 * - events : événements de vie personnels, reçus au hasard pendant le temps libre.
 */
export const STAGE_CONTENT: Record<Stage, { opening: Situation; events: Situation[] }> = {
  lycee: {
    opening: byId(LYCEE_POOL, 'ly-specialites'),
    events: [LYCEE_FIRST, ...LYCEE_POOL.filter((s) => s.id !== 'ly-specialites'), LYCEE_LAST],
  },
  universite: { opening: UNIV_FIRST, events: [...UNIV_POOL, UNIV_LAST] },
  travail: { opening: TRAVAIL_FIRST, events: [...TRAVAIL_POOL, TRAVAIL_LAST] },
};

export const ALL_SITUATIONS: Situation[] = Object.values(STAGE_CONTENT).flatMap((s) => [s.opening, ...s.events]);

/** Textes d'introduction d'étape, personnalisés selon la classe d'origine */
export const STAGE_INTRO: Record<Stage, { title: string; board: string; byClass: Record<SocialClass, string> }> = {
  lycee: {
    title: 'Le lycée',
    board: 'Tout le monde entre en seconde. Les mêmes cours… mais pas les mêmes chances.',
    byClass: {
      basse: 'Tu grandis dans un HLM. Tes parents enchaînent les petits boulots : pas d’argent pour les extras, chaque choix compte.',
      moyenne: 'Tes parents sont employés. On ne manque de rien, mais il faut compter : ils paieront la moitié de tes dépenses d’études.',
      riche: 'Tes parents sont cadres supérieurs. Ils financeront tout ce qu’il faut pour ta réussite, et ils connaissent du monde.',
    },
  },
  universite: {
    title: 'Les études supérieures',
    board: 'Après le bac, les chemins se séparent : prépa, fac, BTS, alternance… ou le travail.',
    byClass: {
      basse: 'Les études coûtent cher : logement, transports, matériel. Les bourses peuvent t’aider.',
      moyenne: 'Tes parents t’aident un peu. À toi de faire les bons choix d’orientation.',
      riche: 'Le compte de tes parents est derrière toi. Les meilleures écoles te sont accessibles.',
    },
  },
  travail: {
    title: 'Le monde du travail',
    board: 'Place à la vie active. À chaque tour, chacun touche son salaire (ou ses allocations).',
    byClass: {
      basse: 'Plus personne pour payer à ta place : ton salaire tombe à chaque tour.',
      moyenne: 'Plus personne pour payer à ta place : ton salaire tombe à chaque tour.',
      riche: 'Ton salaire tombe à chaque tour… et l’héritage n’est jamais loin.',
    },
  },
};

// ================================================================= Bilans d'étape

export interface Milestone {
  title: string;
  text: string;
  tone: 'good' | 'bad' | 'neutral';
  feed?: string;
  d?: Outcome['d'];
}

/** Fin du lycée : le bac, selon la filière et le savoir */
export function bacMilestone(p: LifePlayer): Milestone {
  let bac: Bac;
  if (p.track === 'pro') bac = p.cap.savoir >= 25 ? 'pro' : 'aucun';
  else if (p.cap.savoir >= 62) bac = 'mention';
  else if (p.cap.savoir >= 42) bac = 'general';
  else if (p.cap.savoir >= 30) bac = 'pro';
  else bac = 'aucun';
  p.bac = bac;
  p.titles.push(BAC_LABEL[bac]);
  if (bac === 'mention')
    return { title: BAC_LABEL[bac], text: 'Félicitations du jury ! Toutes les portes s’ouvrent.', tone: 'good', d: { moral: 8, reseau: 3 }, feed: '🎓 {name} décroche le bac avec mention très bien' };
  if (bac === 'general') return { title: BAC_LABEL[bac], text: 'Bac en poche !', tone: 'good', d: { moral: 5 } };
  if (bac === 'pro') return { title: BAC_LABEL[bac], text: p.track === 'pro' ? 'Ton bac pro est validé.' : 'Repêché·e de justesse… avec un bac pro.', tone: 'neutral', d: { moral: 2 } };
  return { title: 'Bac raté', text: 'Pas de bac cette année. Certaines voies te seront fermées.', tone: 'bad', d: { moral: -10 }, feed: '❌ {name} rate son bac' };
}

/** Fin des études : le diplôme, selon le cursus et le savoir */
export function diplomaMilestone(p: LifePlayer): Milestone {
  const s = p.cap.savoir;
  let d: Diploma;
  switch (p.cursus) {
    case 'prepa':
      d = s >= 68 ? 'grande_ecole' : 'licence';
      break;
    case 'commerce':
      d = s >= 38 ? 'ecole_commerce' : 'licence';
      break;
    case 'licence':
      d = p.flags.has('master') && s >= 52 ? 'master' : s >= 42 ? 'licence' : 'aucun';
      break;
    case 'court':
      d = s >= 35 ? 'bts' : 'aucun';
      break;
    case 'alternance':
      d = 'bts';
      break;
    case 'cap':
      d = 'cap';
      break;
    default:
      d = 'aucun';
  }
  p.diploma = d;
  if (d !== 'aucun') p.titles.push(DIPLOMA_LABEL[d]);
  if (p.cursus === 'aucun' || p.cursus === null)
    return { title: 'Déjà dans la vie active', text: 'Pas de diplôme du supérieur, mais quelques années d’expérience.', tone: 'neutral', d: { reseau: 4 } };
  if (d === 'aucun')
    return { title: 'Échec', text: 'Tu n’obtiens pas ton diplôme. Dur retour à la réalité.', tone: 'bad', d: { moral: -10 }, feed: '❌ {name} échoue à obtenir son diplôme' };
  if (d === 'grande_ecole')
    return { title: DIPLOMA_LABEL[d], text: 'Diplômé·e d’une grande école : le réseau des anciens t’ouvre ses portes.', tone: 'good', d: { reseau: 10, moral: 8 }, feed: '🏛️ {name} sort diplômé·e d’une grande école' };
  if (d === 'master' || d === 'ecole_commerce')
    return { title: DIPLOMA_LABEL[d], text: 'Un diplôme bac+5 très recherché.', tone: 'good', d: { reseau: 5, moral: 6 }, feed: `🎓 {name} obtient : ${DIPLOMA_LABEL[d]}` };
  return { title: DIPLOMA_LABEL[d], text: 'Diplôme obtenu !', tone: 'good', d: { moral: 4 } };
}

/** Fin de partie : bilan de carrière (sans effet) */
export function careerMilestone(p: LifePlayer): Milestone {
  const job = p.job ?? 'chomage';
  return { title: JOB_LABEL[job], text: `Tu termines ta carrière : ${JOB_LABEL[job].toLowerCase()}.`, tone: job === 'chomage' ? 'bad' : 'neutral' };
}

// ================================================================= Événements (régie)

export interface GameEvent {
  id: string;
  emoji: string;
  label: string;
  description: string;
  apply: (players: LifePlayer[], rnd: () => number) => { feed: string; affected: { p: LifePlayer; d: Outcome['d'] }[] };
}

const each = (players: LifePlayer[], filter: (p: LifePlayer) => boolean, d: (p: LifePlayer) => Outcome['d']) =>
  players.filter(filter).map((p) => ({ p, d: d(p) }));

export const GAME_EVENTS: GameEvent[] = [
  {
    id: 'crise',
    emoji: '📉',
    label: 'Crise économique',
    description: 'Tout le monde perd 25 % de son épargne et du moral.',
    apply: (ps) => ({ feed: '📉 Crise économique : les épargnes fondent de 25 %', affected: each(ps, () => true, (p) => ({ money: p.cap.money > 0 ? -p.cap.money * 0.25 : 0, moral: -6 })) }),
  },
  {
    id: 'heritage',
    emoji: '💎',
    label: 'Héritages',
    description: 'Les familles riches transmettent 25 000 €, les moyennes 5 000 €.',
    apply: (ps) => ({ feed: '💎 Héritages : les familles aisées transmettent leur patrimoine', affected: each(ps, (p) => p.origin !== 'basse', (p) => ({ money: p.origin === 'riche' ? 25_000 : 5_000 })) }),
  },
  {
    id: 'bourse',
    emoji: '🎓',
    label: 'Bourse au mérite',
    description: '+2 500 € pour les joueurs d’origine modeste ayant au moins 50 en savoir.',
    apply: (ps) => ({ feed: '🎓 Bourses au mérite pour les élèves d’origine modeste', affected: each(ps, (p) => p.origin === 'basse' && p.cap.savoir >= 50, () => ({ money: 2_500, moral: 5 })) }),
  },
  {
    id: 'aides',
    emoji: '✂️',
    label: 'Baisse des aides sociales',
    description: 'La classe basse perd 800 € et du moral.',
    apply: (ps) => ({ feed: '✂️ Baisse des aides sociales', affected: each(ps, (p) => p.cls === 'basse', () => ({ money: -800, moral: -5 })) }),
  },
  {
    id: 'pandemie',
    emoji: '🦠',
    label: 'Pandémie',
    description: 'Confinement : −15 moral et −3 savoir pour tout le monde.',
    apply: (ps) => ({ feed: '🦠 Pandémie : tout le monde est confiné', affected: each(ps, () => true, () => ({ moral: -15, savoir: -3 })) }),
  },
  {
    id: 'boom',
    emoji: '🚀',
    label: 'Boom économique',
    description: '+2 000 € pour tous ceux qui ont un emploi.',
    apply: (ps) => ({ feed: '🚀 Boom économique : primes pour les salariés', affected: each(ps, working, () => ({ money: 2_000, moral: 4 })) }),
  },
  {
    id: 'impot',
    emoji: '🏛️',
    label: 'Impôt sur la fortune',
    description: 'La classe riche reverse 15 % de son épargne.',
    apply: (ps) => ({ feed: '🏛️ Impôt sur la fortune', affected: each(ps, (p) => p.cls === 'riche', (p) => ({ money: p.cap.money > 0 ? -p.cap.money * 0.15 : 0 })) }),
  },
  {
    id: 'ecole',
    emoji: '📚',
    label: 'Plan éducation',
    description: '+6 savoir pour les classes basse et moyenne.',
    apply: (ps) => ({ feed: '📚 Plan éducation : soutien scolaire gratuit', affected: each(ps, (p) => p.cls !== 'riche', () => ({ savoir: 6 })) }),
  },
  {
    id: 'loto',
    emoji: '🎰',
    label: 'Gagnant du loto',
    description: 'Un joueur tiré au sort gagne 50 000 €.',
    apply: (ps, rnd) => {
      const winner = ps[Math.floor(rnd() * ps.length)];
      return winner
        ? { feed: '🎰 Loto : un joueur gagne 50 000 € !', affected: [{ p: winner, d: { money: 50_000, moral: 15 } }] }
        : { feed: '🎰 Loto : personne ne gagne', affected: [] };
    },
  },
];
