/**
 * Activités libres de chaque lieu, étape par étape.
 * Chacun joue à son rythme : une activité prend quelques secondes, puis ses effets s'appliquent.
 * Les inégalités sont dans les activités elles-mêmes (famille qui aide aux devoirs, appel aux parents…).
 */
import type { Stage } from '../protocol.js';
import { promote, setJob } from './content.js';
import { DIPLOMA_LABEL, chance, fmtMoney, type Action, type Diploma, type Job, type LifePlayer, type Outcome } from './model.js';

const good = (text: string, d: Outcome['d'], extra: Partial<Outcome> = {}): Outcome => ({ text, d, tone: 'good', ...extra });
const bad = (text: string, d: Outcome['d'], extra: Partial<Outcome> = {}): Outcome => ({ text, d, tone: 'bad', ...extra });
const meh = (text: string, d: Outcome['d'], extra: Partial<Outcome> = {}): Outcome => ({ text, d, tone: 'neutral', ...extra });

const working = (p: LifePlayer) => !!p.job && p.job !== 'chomage' && p.job !== 'ouvrier' && p.job !== 'entrepreneur';
const needMoney = (n: number) => (p: LifePlayer) => (p.cap.money >= n ? null : `Il faut ${fmtMoney(n)} d’épargne`);

/** Gain d'une séance de travail selon le poste (avant augmentations) */
const PAY: Record<Job, number> = {
  chomage: 0,
  ouvrier: 220,
  employe: 320,
  technicien: 480,
  cadre: 900,
  cadre_sup: 1_800,
  dirigeant: 4_500,
  entrepreneur: 0,
};
const pay = (p: LifePlayer, factor = 1) => Math.round(PAY[p.job ?? 'chomage'] * (1 + p.raise) * factor);

/** Meilleur poste accessible avec le diplôme (Pôle emploi) */
function jobFor(p: LifePlayer): Job {
  const d: Diploma = p.diploma ?? 'aucun';
  if (d === 'grande_ecole' || d === 'master' || d === 'ecole_commerce') return 'cadre';
  if (d === 'licence' || d === 'bts') return 'technicien';
  if (p.bac && p.bac !== 'aucun') return 'employe';
  return 'ouvrier';
}

// ================================================================= LYCÉE

const LYCEE: Action[] = [
  // Maison
  { id: 'ly-repos', place: 'maison', emoji: '😴', label: 'Se reposer', seconds: 8, hint: '+ moral', resolve: () => good('Tu recharges les batteries.', { moral: 7 }) },
  {
    id: 'ly-devoirs', place: 'maison', emoji: '✏️', label: 'Faire ses devoirs', seconds: 12, hint: '+ savoir',
    resolve: (p) =>
      p.origin === 'riche'
        ? good('Tes parents t’aident et t’expliquent tout.', { savoir: 4 })
        : p.origin === 'moyenne'
          ? good('Devoirs faits, au calme.', { savoir: 3 })
          : meh('Difficile de se concentrer : la chambre est partagée et personne ne peut t’aider.', { savoir: 2, moral: -1 }),
  },
  { id: 'ly-aider', place: 'maison', emoji: '🧺', label: 'Aider à la maison', seconds: 10, show: (p) => p.origin === 'basse', resolve: () => meh('Tu gardes tes petits frères pour aider tes parents.', { money: 40, moral: -1, savoir: -1 }) },
  { id: 'ly-diner', place: 'maison', emoji: '🍷', label: 'Dîner avec les amis de tes parents', seconds: 10, show: (p) => p.origin === 'riche', resolve: () => good('Un avocat et une directrice d’école de commerce : de bons contacts.', { reseau: 4 }) },

  // Salle de classe
  { id: 'ly-cours', place: 'classe', emoji: '📚', label: 'Suivre le cours attentivement', seconds: 12, hint: '+ savoir', resolve: () => good('Tu as tout compris.', { savoir: 3, moral: -1 }) },
  {
    id: 'ly-oral', place: 'classe', emoji: '🙋', label: 'Participer à l’oral', seconds: 9, hint: 'Risqué',
    resolve: (p, c) => (c.roll(chance(p, 50, { savoir: 0.3, moral: 0.3 })) ? good('Belle intervention, le prof te remarque.', { savoir: 2, reseau: 2 }) : bad('Tu bafouilles devant tout le monde.', { moral: -3 })),
  },
  { id: 'ly-bavarder', place: 'classe', emoji: '💬', label: 'Bavarder au fond', seconds: 8, resolve: () => meh('Fou rire avec ton voisin… et une remarque du prof.', { reseau: 2, moral: 2, savoir: -1 }) },

  // CDI
  { id: 'ly-reviser', place: 'cdi', emoji: '📖', label: 'Réviser au CDI', seconds: 14, hint: '+ + savoir', resolve: () => good('Une heure de révisions efficaces.', { savoir: 4, moral: -2 }) },
  { id: 'ly-prof', place: 'cdi', emoji: '👩‍🏫', label: 'Cours particulier', seconds: 12, cost: 120, hint: '+ + savoir', resolve: () => good('Ton prof particulier t’éclaire sur tout.', { savoir: 5 }) },
  {
    id: 'ly-cordees', place: 'cdi', emoji: '🪢', label: 'Candidater aux Cordées de la réussite', seconds: 12,
    show: (p) => p.origin !== 'riche' && !p.flags.has('cordees'),
    requires: (p) => (p.cap.savoir >= 46 ? null : 'Il faut 46 en savoir (bon dossier scolaire)'),
    hint: 'Égalité des chances',
    resolve: (p, c) =>
      c.roll(chance(p, 55, { savoir: 0.5 }))
        ? good('Retenu·e ! Un tuteur d’une grande école t’accompagne : la prépa te sera financée.', { reseau: 6, savoir: 2 }, { apply: (q) => q.flags.add('cordees'), feed: '🪢 {name} rejoint les Cordées de la réussite' })
        : bad('Dossier non retenu cette année.', { moral: -3 }),
  },
  { id: 'ly-orientation', place: 'cdi', emoji: '🧭', label: 'Se renseigner sur l’orientation', seconds: 10, resolve: () => good('Tu sais mieux ce qui t’attend après le bac.', { savoir: 1, reseau: 1 }, { apply: (p) => p.flags.add('ambition') }) },

  // Cour
  { id: 'ly-potes', place: 'cour', emoji: '🤝', label: 'Traîner avec les potes', seconds: 10, hint: '+ réseau', resolve: () => good('Tu es de toutes les conversations.', { reseau: 3, moral: 3, savoir: -1 }) },
  {
    id: 'ly-evenement', place: 'cour', emoji: '🎤', label: 'Organiser un événement', seconds: 14, hint: 'Risqué',
    resolve: (p, c) => (c.roll(chance(p, 40, { reseau: 0.5 })) ? good('Ton tournoi rassemble tout le lycée !', { reseau: 6, moral: 3 }, { feed: '🎤 {name} organise un événement qui rassemble tout le lycée' }) : bad('Personne n’est venu.', { moral: -4 })),
  },

  // Gymnase
  { id: 'ly-sport', place: 'gymnase', emoji: '🏃', label: 'Faire du sport', seconds: 10, hint: '+ moral', resolve: () => good('Ça défoule !', { moral: 6 }) },
  {
    id: 'ly-equipe', place: 'gymnase', emoji: '🏆', label: 'Match avec l’équipe du lycée', seconds: 14, hint: 'Risqué',
    resolve: (p, c) => (c.roll(chance(p, 45, { moral: 0.4 })) ? good('Victoire ! Tout le lycée en parle.', { reseau: 4, moral: 5 }) : meh('Défaite, mais une bonne ambiance d’équipe.', { reseau: 2, moral: -1 })),
  },

  // Cantine
  { id: 'ly-cantine', place: 'cantine', emoji: '🍽️', label: 'Déjeuner avec la classe', seconds: 8, resolve: () => good('Un repas animé.', { reseau: 2, moral: 2 }) },

  // Fast-food
  { id: 'ly-service', place: 'boulot', emoji: '🍔', label: 'Faire un service', seconds: 14, hint: '+ argent', resolve: () => meh('Quatre heures debout, mais de l’argent de poche.', { money: 130, savoir: -1, moral: -2 }) },
  { id: 'ly-babysit', place: 'boulot', emoji: '🧸', label: 'Baby-sitting', seconds: 12, resolve: () => good('Une soirée tranquille et payée.', { money: 80, reseau: 1 }) },
];

// ================================================================= UNIVERSITÉ

const UNIVERSITE: Action[] = [
  // Logement
  { id: 'un-dormir', place: 'residence', emoji: '😴', label: 'Dormir, se reposer', seconds: 8, hint: '+ moral', resolve: () => good('Une vraie nuit de sommeil.', { moral: 7 }) },
  {
    id: 'un-parents', place: 'residence', emoji: '📞', label: 'Appeler tes parents', seconds: 6,
    resolve: (p) =>
      p.origin === 'riche'
        ? good('Ils te font un virement « pour les petites dépenses ».', { money: 700, moral: 2 })
        : p.origin === 'moyenne'
          ? good('Un petit virement et beaucoup d’encouragements.', { money: 150, moral: 3 })
          : meh('Ils sont fiers de toi, mais ne peuvent pas t’aider financièrement.', { moral: 4 }),
  },

  // Amphi
  { id: 'un-amphi', place: 'amphi', emoji: '🏛️', label: 'Assister au cours magistral', seconds: 12, hint: '+ savoir', resolve: () => good('Des notes complètes.', { savoir: 3, moral: -1 }) },
  { id: 'un-question', place: 'amphi', emoji: '🙋', label: 'Échanger avec le professeur', seconds: 9, resolve: (p, c) => (c.roll(chance(p, 45, { savoir: 0.4 })) ? good('Il te propose de l’aider sur une recherche.', { savoir: 2, reseau: 3 }) : meh('Échange poli, sans suite.', { savoir: 1 })) },

  // BU
  { id: 'un-bu', place: 'bu', emoji: '📚', label: 'Réviser à la bibliothèque', seconds: 14, hint: '+ + savoir', resolve: () => good('Une séance de travail très efficace.', { savoir: 4, moral: -2 }) },
  { id: 'un-groupe', place: 'bu', emoji: '👥', label: 'Exposé en groupe', seconds: 12, resolve: () => good('Bon travail d’équipe.', { savoir: 2, reseau: 2 }) },
  { id: 'un-prepa', place: 'bu', emoji: '🔥', label: 'Bachoter les concours', seconds: 14, show: (p) => p.cursus === 'prepa', resolve: () => good('Khôlles, devoirs sur table : tu progresses vite.', { savoir: 5, moral: -3 }) },

  // BDE
  { id: 'un-soiree', place: 'bde', emoji: '🎉', label: 'Soirée étudiante', seconds: 10, cost: 20, resolve: () => good('Mémorable.', { reseau: 3, moral: 4, savoir: -1 }) },
  { id: 'un-asso', place: 'bde', emoji: '📣', label: 'S’investir dans une asso', seconds: 14, hint: '+ réseau', resolve: () => good('Tu organises le gala avec le bureau.', { reseau: 4, moral: -1 }) },

  // Supermarché
  { id: 'un-job', place: 'job', emoji: '🛒', label: 'Job étudiant (4 heures)', seconds: 14, hint: '+ argent', resolve: () => meh('Mise en rayon et caisse : fatigant mais nécessaire.', { money: 190, savoir: -2, moral: -2 }) },

  // Entreprises
  { id: 'un-alternance', place: 'entreprise', emoji: '🔁', label: 'Journée en alternance', seconds: 14, show: (p) => p.cursus === 'alternance', resolve: () => good('Ton tuteur te confie un vrai projet.', { money: 320, reseau: 2, savoir: 1 }) },
  {
    id: 'un-demarcher', place: 'entreprise', emoji: '✉️', label: 'Démarcher pour un stage', seconds: 12, hint: 'Risqué',
    resolve: (p, c) =>
      c.roll(chance(p, 30, { reseau: 0.5, savoir: 0.2 }))
        ? good('Une entreprise te promet un poste à la sortie !', { reseau: 5 }, { apply: (q) => q.flags.add('promesse'), feed: '🤝 {name} décroche une promesse d’embauche' })
        : bad('Pas de réponse.', { moral: -2, reseau: 1 }),
  },
  { id: 'un-linkedin', place: 'entreprise', emoji: '💼', label: 'Soigner son profil pro', seconds: 8, resolve: () => meh('Quelques nouveaux contacts.', { reseau: 2 }) },
];

// ================================================================= TRAVAIL

const TRAVAIL: Action[] = [
  // Maison
  { id: 'tr-repos', place: 'maison', emoji: '🛋️', label: 'Se reposer', seconds: 8, hint: '+ moral', resolve: () => good('Une soirée au calme.', { moral: 7 }) },
  { id: 'tr-famille', place: 'maison', emoji: '👨‍👩‍👧', label: 'Passer du temps en famille', seconds: 10, resolve: (p) => good('Un bon moment.', { moral: 5, money: p.origin === 'riche' ? 1_000 : 0 }) },

  // Pôle emploi
  {
    id: 'tr-chercher', place: 'agence', emoji: '🔍', label: 'Chercher un emploi', seconds: 12, show: (p) => !p.job || p.job === 'chomage', hint: 'Selon ton diplôme',
    resolve: (p, c) => {
      const job = jobFor(p);
      return c.roll(chance(p, 45, { savoir: 0.3, reseau: 0.4 }))
        ? good(`Embauché·e : ${job === 'cadre' ? 'poste de cadre' : job === 'technicien' ? 'technicien·ne' : job === 'employe' ? 'employé·e' : 'ouvrier·e'} !`, { moral: 6 }, { apply: (q) => setJob(q, job), feed: '💼 {name} trouve un emploi' })
        : bad('Pas de réponse cette fois.', { moral: -3 });
    },
  },
  { id: 'tr-alloc', place: 'agence', emoji: '📋', label: 'Toucher tes allocations', seconds: 8, show: (p) => !p.job || p.job === 'chomage', resolve: () => meh('Juste de quoi tenir.', { money: 150 }) },
  { id: 'tr-formation', place: 'agence', emoji: '🧰', label: 'Formation de reconversion', seconds: 14, resolve: () => good('Tu apprends un nouveau métier.', { savoir: 4 }) },

  // Atelier
  { id: 'tr-atelier', place: 'usine', emoji: '🏭', label: 'Travailler à l’atelier', seconds: 12, show: (p) => p.job === 'ouvrier', resolve: (p) => meh(`Journée physique : +${fmtMoney(pay(p))}.`, { money: pay(p), moral: -3 }) },
  { id: 'tr-interim', place: 'usine', emoji: '🦺', label: 'Mission d’intérim', seconds: 12, show: (p) => !p.job || p.job === 'chomage', resolve: () => meh('Une mission ponctuelle.', { money: 180, moral: -2 }) },
  {
    id: 'tr-chef', place: 'usine', emoji: '👷', label: 'Devenir chef d’équipe', seconds: 12, show: (p) => p.job === 'ouvrier', hint: 'Risqué',
    resolve: (p, c) => (c.roll(chance(p, 30, { savoir: 0.3, reseau: 0.3 })) ? good('Promu·e chef d’équipe !', { moral: 5 }, { apply: (q) => void promote(q), feed: '👷 {name} devient chef d’équipe' }) : bad('Le poste revient à un autre.', { moral: -3 })),
  },

  // Bureaux
  { id: 'tr-travailler', place: 'bureau', emoji: '💻', label: 'Travailler', seconds: 12, show: working, resolve: (p) => meh(`Journée de travail : +${fmtMoney(pay(p))}.`, { money: pay(p), moral: -2 }) },
  { id: 'tr-heures', place: 'bureau', emoji: '🌙', label: 'Faire des heures sup’', seconds: 14, show: working, resolve: (p) => meh(`Heures sup’ : +${fmtMoney(pay(p, 1.4))}, mais tu es épuisé·e.`, { money: pay(p, 1.4), moral: -6 }) },
  {
    id: 'tr-promo', place: 'bureau', emoji: '📈', label: 'Demander une promotion', seconds: 10, show: (p) => working(p) && p.job !== 'dirigeant', hint: 'Risqué',
    resolve: (p, c) => (c.roll(chance(p, 25, { savoir: 0.35, reseau: 0.45 })) ? good('Promotion obtenue !', { moral: 6 }, { apply: (q) => void promote(q), feed: '📈 {name} obtient une promotion' }) : bad('« Ce n’est pas le moment. »', { moral: -4 })),
  },
  {
    id: 'tr-boite', place: 'bureau', emoji: '🚀', label: 'Développer ton entreprise', seconds: 14, show: (p) => p.job === 'entrepreneur', hint: 'Risqué',
    resolve: (p, c) => (c.roll(chance(p, 45, { reseau: 0.3, savoir: 0.2 })) ? good('Un gros client signe !', { money: 2_600, reseau: 2 }) : bad('Mois difficile.', { money: -600, moral: -3 })),
  },

  // Banque
  {
    id: 'tr-placer', place: 'banque', emoji: '📊', label: 'Placer ton épargne', seconds: 8, requires: needMoney(1_000), hint: 'Risqué',
    resolve: (p, c) => {
      const stake = Math.round(p.cap.money / 2);
      return c.roll(0.55) ? good(`Bon placement : +${fmtMoney(stake * 0.15)}.`, { money: stake * 0.15 }) : bad(`Les marchés baissent : −${fmtMoney(stake * 0.12)}.`, { money: -stake * 0.12 });
    },
  },
  {
    id: 'tr-creer', place: 'banque', emoji: '🏦', label: 'Emprunter pour créer ta boîte', seconds: 12, show: (p) => p.job !== 'entrepreneur' && p.job !== 'dirigeant', requires: (p) => (p.cap.reseau >= 40 || p.cap.money >= 5_000 ? null : 'La banque veut 5 000 € d’apport ou un bon réseau (40)'),
    resolve: () => meh('Prêt accordé : te voilà entrepreneur·e.', { money: 3_000, moral: 4 }, { apply: (q) => setJob(q, 'entrepreneur'), feed: '🚀 {name} crée son entreprise' }),
  },
  {
    id: 'tr-immo', place: 'banque', emoji: '🏡', label: 'Acheter un logement', seconds: 12, show: (p) => !p.flags.has('proprio'), requires: needMoney(20_000),
    resolve: () => good('Propriétaire ! Ton bien prend de la valeur.', { money: 6_000, moral: 6 }, { apply: (q) => q.flags.add('proprio'), feed: '🏡 {name} devient propriétaire' }),
  },

  // Cours du soir
  { id: 'tr-soir', place: 'ecole', emoji: '🌙', label: 'Cours du soir', seconds: 14, cost: 250, hint: '+ savoir', resolve: () => good('Tu progresses dans ton métier.', { savoir: 4, moral: -2 }) },
  {
    id: 'tr-vae', place: 'ecole', emoji: '🎓', label: 'Valider un diplôme (VAE)', seconds: 14, cost: 1_500, show: (p) => !p.flags.has('vae'),
    resolve: (p) => {
      const rank: Diploma[] = ['aucun', 'cap', 'bts', 'licence', 'ecole_commerce', 'master', 'grande_ecole'];
      const i = rank.indexOf(p.diploma ?? 'aucun');
      if (i >= rank.indexOf('master')) return meh('Une formation de plus sur ton CV.', { savoir: 4 }, { apply: (q) => q.flags.add('vae') });
      const next = rank[i < 2 ? 2 : i === 4 ? 5 : i + 1]!;
      return good(`Nouveau diplôme : ${DIPLOMA_LABEL[next]} !`, { savoir: 4 }, { apply: (q) => { q.diploma = next; q.titles.push(DIPLOMA_LABEL[next]); q.flags.add('vae'); } });
    },
  },

  // Club & afterwork
  { id: 'tr-afterwork', place: 'club', emoji: '🍻', label: 'Afterwork', seconds: 10, cost: 40, resolve: () => good('Bonne ambiance avec les collègues.', { reseau: 3, moral: 3 }) },
  { id: 'tr-golf', place: 'club', emoji: '⛳', label: 'Partie de golf avec des dirigeants', seconds: 12, cost: 500, hint: '+ + réseau', resolve: () => good('Tu joues avec le gratin de la région.', { reseau: 5 }) },
];

export const STAGE_ACTIONS: Record<Stage, Action[]> = { lycee: LYCEE, universite: UNIVERSITE, travail: TRAVAIL };
