/**
 * Contenus de l'exposé (dossier de conception, onglet « L'exposé ») :
 * les 25 étapes et leurs textes, les sondages, les réformes, les cartes « Le saviez-vous ».
 * Les diapositives et les cartes sont modifiables depuis le panneau (ExposeContent).
 */
import type { DeckStep, ExposeContent, FactCard, GameEventInfo, SlideContent, StepKind } from '../protocol.js';

const slide = (title: string, subtitle = '', bullets: string[] = [], notes = ''): SlideContent => ({ title, subtitle, bullets, notes });

interface StepDef {
  id: string;
  kind: StepKind;
  ref?: string;
  who: string;
  cards?: string[];
  plan: number;
  slide: SlideContent;
}

/** Déroulé minute par minute (E3) et ce qu'on dit à chaque étape (E4) */
const STEPS: StepDef[] = [
  {
    id: 'titre',
    kind: 'slide',
    who: 'A',
    plan: 30,
    slide: slide(
      'Né·e sous la même étoile ?',
      'L’école corrige-t-elle les inégalités de départ, ou les transforme-t-elle en inégalités de diplômes ?',
      [],
      '« Levez la main si vous pensez qu’à l’école, tout le monde a les mêmes chances. Retenez votre réponse, on y revient à la fin. »\nSi des élèves ne sont pas connectés : laisser 30 s de plus.',
    ),
  },
  {
    id: 'sondage-entree',
    kind: 'poll',
    ref: 'entree',
    who: 'A',
    plan: 60,
    slide: slide('Sondage d’entrée', 'Anonyme : répondez honnêtement', [], '« C’est anonyme, répondez honnêtement. » Après les résultats : « La plupart pensent que le travail compte le plus. On va voir. »\nMoins de la moitié a répondu : +15 s. R pour révéler vers 0:50.'),
  },
  {
    id: 'regles',
    kind: 'slide',
    who: 'A',
    plan: 30,
    slide: slide(
      'Comment on joue',
      'Une vie, du lycée au premier emploi',
      [
        'Ta famille est tirée au sort : tu ne choisis pas où tu nais',
        'Chaque année : 6 jetons de temps à répartir',
        'Chaque année : un choix (lycée, spécialités, logement, carrière…)',
        'Les règles sont les mêmes pour tous. Seules les ressources changent.',
      ],
      '« Chaque année, vous avez 6 jetons de temps et un choix à faire. Votre famille est tirée au sort. Comme dans la vraie vie, vous ne choisissez pas où vous naissez. »',
    ),
  },
  {
    id: 'tirage',
    kind: 'draw',
    who: 'B',
    cards: ['F1'],
    plan: 30,
    slide: slide('Tirage des familles', 'Même âge, même classe, mais pas le même départ', [], '« Regardez votre carte. Même âge, même classe, mais pas le même départ : entre 10,6 et 12,2 de moyenne, entre 100 et 1 500 € de budget. »\nMoins de 2 joueurs dans une classe : en imposer (clic droit, avant de lancer).'),
  },
  {
    id: 'seconde',
    kind: 'year',
    ref: 'seconde',
    who: 'A puis B',
    cards: ['F4', 'F3'],
    plan: 90,
    slide: slide('Seconde', 'Ton lycée', [], 'A : « Vous entrez en Seconde, dans le lycée de votre quartier. Sauf si vous trouvez un moyen d’en changer. » B : carte F4.\nPrivé d’élite payé : « Ses parents ont tout payé. Un joueur populaire aurait dû sortir l’argent lui-même. »\nDérogation refusée : « Pour l’avoir, il faut connaître les bonnes options. Ça s’apprend en famille. »'),
  },
  {
    id: 'premiere',
    kind: 'year',
    ref: 'premiere',
    who: 'A puis B',
    cards: ['F1'],
    plan: 120,
    slide: slide('Première', 'Tes spécialités', [], 'B : « Regardez la colonne populaire. Un jeton sur six part pour aider à la maison, et sans aide aux devoirs, chaque heure de travail rapporte moins. »\nAvis contesté : « Ses parents ont obtenu un rendez-vous. En classe populaire, l’option n’apparaît même pas. »\nVoie pro : « Il touche un salaire d’apprenti, mais la prépa et Sciences Po viennent de se fermer. »'),
  },
  {
    id: 'terminale',
    kind: 'year',
    ref: 'terminale',
    who: 'B',
    cards: ['F5'],
    plan: 120,
    slide: slide('Terminale', 'Préparer l’après-bac', [], '« Certains ont payé un coach Parcoursup à 1 200 €. D’autres ne savent même pas que la prépa existe. »\nCoaching : « Sa lettre sera meilleure, et il découvre des filières que les autres ne voient pas. »\nCordées : « Les Cordées aident vraiment, mais il faut 12 de moyenne et il n’y a pas de place pour tout le monde. »'),
  },
  {
    id: 'bac',
    kind: 'bac',
    who: 'B',
    cards: ['F2'],
    plan: 75,
    slide: slide('Résultats du bac', 'Fin de la première partie', [], '« Fin de la première partie. Même jeu, mêmes règles, mais pas les mêmes mentions. Ce n’est pas un problème de travail, c’est ce que la famille apporte. »\nUn joueur populaire devant : « Ça arrive, et heureusement. Mais regardez la colonne entière : en moyenne, l’écart reste. » (F10)'),
  },
  {
    id: 'vote',
    kind: 'vote',
    who: 'A',
    plan: 45,
    slide: slide('Vote de réforme', 'C’est vous le gouvernement', [], '« Deuxième partie : l’orientation. Avant Parcoursup, c’est vous le gouvernement. Doubler les bourses, renforcer les quotas, informer tout le monde, ou ne rien changer ? »\nÉgalité : statu quo.'),
  },
  {
    id: 'voeux',
    kind: 'parcoursup',
    who: 'B',
    cards: ['F6'],
    plan: 75,
    slide: slide('Parcoursup : les vœux', 'Places limitées', [], '« Les places sont limitées : 4 en prépa pour 30 joueurs. Et certains ne voient même pas la prépa dans leur liste, parce que personne ne leur en a parlé. »\nPeu de bourses cochées : « Dans la vraie vie aussi, des élèves qui y ont droit ne la demandent pas. »'),
  },
  {
    id: 'ps-resultats',
    kind: 'parcoursupResults',
    who: 'B',
    plan: 60,
    slide: slide('Parcoursup : les résultats', 'Admis, en attente, refusés', [], '« Le classement regarde la moyenne, les spécialités, la réputation du lycée et la lettre de motivation. Souvent, ce sont les parents qui la relisent. »\nRefusé partout : « Phase complémentaire : il prendra ce qui reste. »\nEn attente : « Garder une place et attendre mieux, encore faut-il connaître la stratégie. »'),
  },
  {
    id: 'ps-affectations',
    kind: 'parcoursupFinal',
    who: 'A',
    cards: ['F7'],
    plan: 60,
    slide: slide('Parcoursup : les affectations', 'Qui entre où', [], '« Voilà qui entre en prépa, à Sciences Po, en école de commerce, et qui finit en phase complémentaire. »\nPersonne de populaire en prépa : « Ce n’est pas une question de talent. Une partie d’entre eux ne savait pas que ça existait. »'),
  },
  {
    id: 'etudes1',
    kind: 'year',
    ref: 'etudes1',
    who: 'B',
    cards: ['F20'],
    plan: 90,
    slide: slide('Première année d’études', 'Ton logement', [], '« Certains ont déjà 2 ou 3 jetons pris par un job pour payer le loyer. Ça laisse moins de temps pour réviser. »\nÉcole payée par les parents : « Un bac+5 qui s’achète, pendant qu’un autre lâche la licence pour travailler. »\nCROUS refusé : « Liste d’attente, retour chez les parents, deux heures de transport par jour. »'),
  },
  {
    id: 'etudes2',
    kind: 'year',
    ref: 'etudes2',
    who: 'A',
    cards: ['F8'],
    plan: 120,
    slide: slide('Fin d’études', 'Stage et suite', [], '« Le stage, certains l’ont trouvé grâce à un ami de leurs parents. Avec une promesse d’embauche au bout. »\nStage piston : « Le carnet d’adresses des parents vient de lui trouver un emploi. »\nMaster refusé : « Sans master, le bac+5 s’éloigne, et les postes de cadre avec. »'),
  },
  {
    id: 'diplomes',
    kind: 'diploma',
    who: 'B',
    cards: ['F7'],
    plan: 60,
    slide: slide('Remise des diplômes', 'Fin de la deuxième partie', [], '« Fin de la deuxième partie. Les inégalités de départ sont devenues des écarts de diplômes. »\nAbandon de licence : « Travailler à mi-temps à côté fait baisser les chances de réussite de 29 %. » (F20)'),
  },
  {
    id: 'emploi',
    kind: 'jobs',
    who: 'A',
    cards: ['F17', 'F18'],
    plan: 90,
    slide: slide('Premier emploi', 'Les mieux classés choisissent d’abord', [], '« Troisième partie : le travail. Il y a peu de postes de cadres. Les mieux classés choisissent en premier. Le diplôme compte, le réseau aussi, et parfois le nom. »\nConcours réussi : « Le concours ne regarde que la moyenne. C’est la voie la plus juste du jeu. »\nChômage : « Sans diplôme, plus de 40 % des jeunes sont au chômage. »\nEffet adresse : « À CV égal, venir d’un quartier sensible divise presque par deux les chances d’entretien. »'),
  },
  {
    id: 'travail1',
    kind: 'year',
    ref: 'travail1',
    who: 'B',
    cards: ['F9'],
    plan: 90,
    slide: slide('Premières années de travail', 'Ta carrière', [], '« Au début, beaucoup enchaînent les contrats courts. Et pour devenir cadre sans bac+5, il faut du réseau. »\nPlafond de verre : « Le poste de cadre va à un diplômé d’école. Sans bac+5 ni réseau, ça bloque. »\nLicenciement : « Avec 6 contacts, on lui retrouve un poste. Sans, c’est le chômage. »'),
  },
  {
    id: 'travail2',
    kind: 'year',
    ref: 'travail2',
    who: 'B',
    cards: ['F11'],
    plan: 90,
    slide: slide('Dix ans plus tard', 'Un nouveau cap', [], '« Pour créer son entreprise, il faut 15 000 €. La famille en donne 0, 8 000 ou 40 000 selon la classe. »\nFaillite : « 15 000 € perdus. Sans famille derrière, on ne repart pas pareil. »\nEntreprise créée : « 40 000 € donnés en classe supérieure, rien en classe populaire. »'),
  },
  {
    id: 'pyramide',
    kind: 'final',
    who: 'A',
    cards: ['F12', 'F13'],
    plan: 120,
    slide: slide('La pyramide', 'Qui est arrivé où ?', [], '« Regardez le podium, et à côté de chaque nom, la classe de départ. Combien sont restés dans leur classe ? »\nR révèle les étages un par un, puis le podium.\nJoueur populaire sur le podium : « Il a monté, avec l’étoile. C’est possible, mais regardez combien sont restés en bas. »'),
  },
  {
    id: 'chiffres',
    kind: 'stats',
    who: 'B',
    plan: 60,
    slide: slide('Notre partie face à la réalité', 'Par classe d’origine', [], '« Voici notre partie, chiffre par chiffre, et en face la réalité. » R : ce que la réforme votée a changé.\nChiffres loin du réel : petit groupe, part de hasard.'),
  },
  {
    id: 'realite',
    kind: 'slide',
    who: 'B',
    cards: ['F11', 'F7', 'F17'],
    plan: 150,
    slide: slide(
      'Et dans la réalité ?',
      'Le jeu simplifie, mais les écarts sont du même ordre',
      [
        '×3,1 : un fils de cadre devient 3,1 fois plus souvent cadre qu’un fils d’employé ou d’ouvrier (Insee, 2024)',
        '48 % contre 10 % : part de bac+5 chez les enfants de cadres et chez les plus modestes',
        '−32 % : à CV identique, un nom à consonance maghrébine reçoit un tiers de rappels en moins',
      ],
      'Trois chiffres : F11, F7, F17. « Le jeu simplifie, mais les écarts sont du même ordre. »\nEn retard : garder F11 et F7.',
    ),
  },
  {
    id: 'corriger',
    kind: 'slide',
    who: 'A',
    cards: ['F19', 'F14', 'F16'],
    plan: 60,
    slide: slide(
      'Ce qui existe pour corriger',
      'Ça aide, mais ça avance lentement',
      ['Bourses sur critères sociaux', 'Quotas de boursiers dans les formations sélectives', 'Cordées de la réussite : 152 800 élèves accompagnés', 'Éducation prioritaire (REP, REP+)', 'Concours de la fonction publique'],
      '« Des choses existent : bourses, quotas de boursiers, Cordées de la réussite, éducation prioritaire. Ça aide, mais ça avance lentement. »',
    ),
  },
  {
    id: 'sondage-sortie',
    kind: 'poll',
    ref: 'sortie',
    who: 'A',
    plan: 45,
    slide: slide('Sondage de sortie', 'Même questions, plus une', [], '« Même question qu’au début, plus une : est-ce que votre famille de départ a décidé de votre arrivée ? »'),
  },
  {
    id: 'avant-apres',
    kind: 'pollCompare',
    who: 'B',
    plan: 45,
    slide: slide('Avant / après', 'Avez-vous changé d’avis ?', [], '« Au début, X % pensaient que tout le monde avait les mêmes chances. Maintenant, Y %. »\nAvis inchangé : en faire la question du débat.'),
  },
  {
    id: 'conclusion',
    kind: 'slide',
    who: 'A',
    cards: ['F15'],
    plan: 90,
    slide: slide(
      'Conclusion et débat',
      'L’école ne crée pas seule les inégalités, mais elle les transforme en écarts de diplômes.',
      ['La moitié de l’effet de l’origine sur le niveau de vie passe par le diplôme', 'Il vaut mieux agir dès la maternelle, ou corriger après avec des bourses et des quotas ?'],
      '« L’école ne crée pas seule les inégalités, mais elle les transforme en écarts de diplômes. Question pour vous : il vaut mieux agir dès la maternelle, ou corriger après avec des bourses et des quotas ? »\nPas de question : relancer avec F15.',
    ),
  },
];

export function defaultDeck(): DeckStep[] {
  return STEPS.map((s) => ({
    id: s.id,
    kind: s.kind,
    ref: s.ref ?? null,
    enabled: true,
    slide: structuredClone(s.slide),
    who: s.who,
    cards: s.cards ?? [],
    plan: s.plan,
  }));
}

/** Applique les contenus modifiés dans le panneau (textes, étapes masquées) */
export function buildDeck(content: ExposeContent | null): DeckStep[] {
  const deck = defaultDeck();
  if (!content) return deck;
  for (const step of deck) {
    const o = content.steps[step.id];
    if (!o) continue;
    step.slide = { ...step.slide, ...o.slide };
    // Les étapes de jeu restent toujours actives
    if (step.kind === 'slide' || step.kind === 'poll' || step.kind === 'pollCompare' || step.kind === 'stats' || step.kind === 'debrief') step.enabled = o.enabled;
  }
  return deck;
}

// ================================================================= Sondages

export const POLLS: Record<string, { question: string; options: string[] }[]> = {
  entree: [
    { question: 'À l’école, tout le monde a-t-il les mêmes chances ?', options: ['Oui, tout à fait', 'Plutôt oui', 'Plutôt non', 'Non, pas du tout'] },
    { question: 'Qu’est-ce qui compte le plus pour réussir ?', options: ['Le travail', 'Le talent', 'La famille', 'La chance'] },
    { question: 'Un enfant d’ouvrier a-t-il autant de chances de devenir cadre qu’un enfant de cadre ?', options: ['Oui', 'À peu près', 'Un peu moins', 'Beaucoup moins'] },
  ],
  sortie: [
    { question: 'À l’école, tout le monde a-t-il les mêmes chances ?', options: ['Oui, tout à fait', 'Plutôt oui', 'Plutôt non', 'Non, pas du tout'] },
    { question: 'Qu’est-ce qui compte le plus pour réussir ?', options: ['Le travail', 'Le talent', 'La famille', 'La chance'] },
    { question: 'Un enfant d’ouvrier a-t-il autant de chances de devenir cadre qu’un enfant de cadre ?', options: ['Oui', 'À peu près', 'Un peu moins', 'Beaucoup moins'] },
    { question: 'Dans le jeu, ta famille de départ a-t-elle décidé de ton arrivée ?', options: ['Complètement', 'En grande partie', 'Un peu', 'Pas du tout'] },
  ],
};
/** Questions comparées avant / après (indices communs) */
export const COMPARED_QUESTIONS = [0, 1, 2];

// ================================================================= Réformes (J8)

export const REFORMS = [
  { id: 'bourses', emoji: '💶', label: 'Doubler les bourses', description: '11 000 € (populaire) et 4 000 € (moyenne) au lieu de 5 500 € et 2 000 € : moins de jobs imposés' },
  { id: 'quotas', emoji: '🎯', label: 'Quotas de boursiers renforcés', description: 'Bonus de dossier des boursiers : +0,25 au lieu de +0,08 en prépa, Sciences Po et BUT' },
  { id: 'info', emoji: '🧭', label: 'L’orientation pour tous', description: 'Toutes les formations visibles pour tous, informé·e ou non' },
  { id: 'statu_quo', emoji: '⚖️', label: 'Statu quo', description: 'Rien ne change' },
] as const;

// ================================================================= Événements de régie (A3)

export const COLLECTIVE_EVENTS: GameEventInfo[] = [
  { id: 'crise', emoji: '📉', label: 'Crise économique', description: 'Licenciements plus probables cette année' },
  { id: 'heritage', emoji: '🏰', label: 'Héritage', description: 'Un joueur au hasard reçoit 20 000 €' },
  { id: 'merite', emoji: '🏅', label: 'Bourse au mérite', description: 'Le meilleur joueur populaire reçoit 3 000 €' },
  { id: 'greve', emoji: '✊', label: 'Grève générale', description: 'Salariés (hors cadres) : hausse obtenue ou jours de salaire perdus' },
];

// ================================================================= Cartes « Le saviez-vous » (E5)

export const DEFAULT_CARDS: FactCard[] = [
  { id: 'F1', title: 'Dès la maternelle', figure: '+32 pts', text: 'En petite section, les enfants de milieu très favorisé ont 32 points d’avance en langage et 36 en pensée mathématique sur ceux de milieu défavorisé.', source: 'DEPP, L’état de l’École 2025', moment: 'Tirage, Première', link: 'Dans le jeu : un jeton de travail rapporte ×0,8 sans aide à la maison, ×1,2 avec.' },
  { id: 'F2', title: 'PISA 2022', figure: '113 pts', text: 'En maths, l’écart entre le quart des élèves les plus favorisés et le quart des moins favorisés atteint 113 points en France, contre 94 en moyenne dans l’OCDE.', source: 'DEPP, L’état de l’École 2025', moment: 'Bac', link: 'Dans le jeu : regardez la réussite au bac par classe d’origine.' },
  { id: 'F3', title: 'Éducation prioritaire', figure: '70 %', text: 'En collège REP+, 70 % des élèves sont d’origine sociale défavorisée, contre 35 % dans le public hors éducation prioritaire et 17 % dans le privé sous contrat.', source: 'Insee, France, portrait social 2025', moment: 'Seconde', link: 'Dans le jeu : le lycée de secteur dépend du quartier de la famille.' },
  { id: 'F4', title: 'Public / privé', figure: '57 % / 32 %', text: 'Le privé scolarise 57 % d’élèves d’origine favorisée ou très favorisée, contre 32 % dans le public. La part d’élèves très favorisés a augmenté de 12 points dans les collèges privés depuis 2004, contre 3 points dans le public.', source: 'Insee, France, portrait social 2025', moment: 'Seconde', link: 'Dans le jeu : le privé coûte 1 800 €, l’élite 6 000 €… payés ou non par la famille.' },
  { id: 'F5', title: 'Voie générale', figure: '40 %', text: 'En Première et Terminale générales, 40 % des élèves sont d’origine très favorisée, contre 20 % en série technologique des services.', source: 'DEPP, L’état de l’École 2025', moment: 'Terminale', link: 'Dans le jeu : contester l’avis du conseil de classe n’est pas proposé à tout le monde.' },
  { id: 'F6', title: 'Diplôme des parents', figure: '75 % / 44 %', text: 'Chez les 25-34 ans, 75 % sont diplômés du supérieur si au moins un parent l’est, contre 44 % si aucun ne l’est (2023).', source: 'Insee, France, portrait social 2024', moment: 'Parcoursup', link: 'Dans le jeu : la prépa et Sciences Po sont invisibles sans information.' },
  { id: 'F7', title: 'Bac+5', figure: '48 % / 10 %', text: 'La part de jeunes diplômés d’un bac+5 atteint 48 % chez ceux issus de familles cadres (55 % si les deux parents sont cadres), contre environ 10 % pour les ménages les plus modestes.', source: 'France Stratégie (2023)', moment: 'Études, diplômes', link: 'Dans le jeu : l’école de commerce coûte 11 000 € par an.' },
  { id: 'F8', title: 'Le diplôme protège', figure: '42,4 % / 8,7 %', text: 'En 2023, le taux de chômage des jeunes sortis de formation depuis 1 à 4 ans est de 42,4 % sans diplôme (ou avec le seul brevet), contre 8,7 % avec un diplôme du supérieur.', source: 'Insee, France, portrait social 2024', moment: 'Fin d’études', link: 'Dans le jeu : sans diplôme, le chômage guette au premier emploi.' },
  { id: 'F9', title: 'Premiers emplois précaires', figure: '28 %', text: '28 % des jeunes en emploi 1 à 4 ans après leurs études ont un emploi à durée limitée, contre 8 % de ceux sortis depuis 11 ans ou plus.', source: 'Insee, France, portrait social 2024', moment: 'Travail', link: 'Dans le jeu : un licenciement suffit à faire descendre.' },
  { id: 'F10', title: 'Ça bouge… un peu', figure: '65 %', text: '65 % des hommes de 35 à 59 ans appartiennent à un groupe social différent de celui de leur père (2015). La mobilité existe, mais souvent d’un seul cran.', source: 'Insee, France, portrait social 2025', moment: 'Réalité', link: 'Dans le jeu : monter demande deux périodes au même poste.' },
  { id: 'F11', title: 'Devenir cadre', figure: '×3,1', text: 'En 2024, seuls 13 % des fils de père employé ou ouvrier peu qualifié sont devenus cadres. Un homme dont le père est cadre devient 3,1 fois plus souvent cadre qu’un fils d’employé ou d’ouvrier qualifié.', source: 'Insee, France, portrait social 2025', moment: 'Dix ans, réalité', link: 'Dans le jeu : le plafond de verre demande 5 contacts ou un bac+5.' },
  { id: 'F12', title: 'Né sous la même étoile ?', figure: '×20', text: 'Un enfant de cadre a 20 fois plus de chances qu’un enfant d’ouvrier d’appartenir aux 1 % les plus aisés. L’écart moyen de niveau de vie atteint 1 000 € par mois, dont la moitié passe par le diplôme.', source: 'France Stratégie, « Nés sous la même étoile ? »', moment: 'Intro, pyramide', link: 'Dans le jeu : regardez la classe de départ à côté de chaque nom.' },
  { id: 'F13', title: 'En bas de l’échelle', figure: '1 sur 2', text: 'Parmi les 10 % les plus modestes, plus de la moitié sont des enfants d’ouvriers. Parmi les 10 % les plus aisés, seulement un sur six.', source: 'France Stratégie, « Nés sous la même étoile ? »', moment: 'Pyramide', link: 'Dans le jeu : qui occupe l’étage du bas ?' },
  { id: 'F14', title: 'Ça progresse lentement', figure: '15 → 26 %', text: 'Cinq à huit ans après leurs études, 26 % des fils d’ouvrier occupent un emploi de cadre ou de profession intermédiaire en 2019 (15 % en 1983), contre 73 % des fils de cadre (66 % en 1983).', source: 'France Stratégie (2023)', moment: 'Corriger', link: 'Dans le jeu : le concours est la voie la plus égalitaire.' },
  { id: 'F15', title: 'Les inégalités montent', figure: '15,4 %', text: 'En 2024, le taux de pauvreté atteint 15,4 % et l’indice de Gini 0,302 : les plus hauts niveaux depuis 1996.', source: 'Insee Première n° 2117', moment: 'Conclusion', link: 'Et maintenant : agir dès la maternelle, ou corriger après ?' },
  { id: 'F16', title: 'Les filles progressent plus vite', figure: '14 → 34 %', text: 'Chez les filles d’ouvrier, l’accès à un emploi de cadre ou de profession intermédiaire est passé de 14 % (1983) à 34 % (2019), contre 57 % à 77 % chez les filles de cadre.', source: 'France Stratégie (2023)', moment: 'Corriger', link: 'Les écarts se réduisent, mais restent.' },
  { id: 'F17', title: 'Discrimination à l’embauche', figure: '−32 %', text: 'À CV identique, les candidats d’origine supposée maghrébine reçoivent 32 % de rappels en moins (22,8 % contre 33,3 %), d’après un testing de 9 600 candidatures sur 2 400 offres (2019-2021).', source: 'Insee (2023), testing Dares/IPP/ISM Corum', moment: 'Premier emploi', link: 'Dans le jeu : deux dossiers égaux, un seul poste.' },
  { id: 'F18', title: 'L’effet adresse', figure: '21,2 % / 10,9 %', text: 'Pour un poste de serveur, un candidat domicilié dans un quartier favorisé de Paris obtient un entretien dans 21,2 % des cas, contre 10,9 % s’il vient d’un quartier sensible de Seine-Saint-Denis.', source: 'Onzus et CNRS, Maire-info (2013)', moment: 'Premier emploi', link: 'Dans le jeu : malus d’employabilité pour le lycée de quartier (option).' },
  { id: 'F19', title: 'Les Cordées de la réussite', figure: '152 800', text: 'Les Cordées de la réussite ont accompagné 152 800 élèves l’année précédant le livret 2026 du ministère, contre 80 000 en 2019.', source: 'Ministère de l’Enseignement supérieur (2026)', moment: 'Corriger', link: 'Dans le jeu : il faut 12 de moyenne, et 65 % de réussite.' },
  { id: 'F20', title: 'Travailler pendant ses études', figure: '−29 %', text: 'Un étudiant qui travaille au moins à mi-temps, plus de six mois par an, dans un emploi sans lien avec ses études, voit ses chances de réussir ses examens baisser de 29 %.', source: 'OVE, rapport du Sénat n° 436 (2009)', moment: '1ʳᵉ année d’études', link: 'Dans le jeu : jusqu’à 3 jetons de job imposés si le budget manque.' },
];
