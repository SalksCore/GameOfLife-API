/**
 * Les mini-jeux : un par année, en plus des 6 jetons et de la décision.
 * Ils changent la manière de jouer (cartes, budget, candidatures, pari) sans changer l'équilibre :
 * les effets sont petits, mais l'inégalité de départ s'y voit (options fermées, aide de la famille, réseau).
 */
import type { MiniGameView, ReportLine, Tone } from '../protocol.js';
import { FAMILY_SAFETY, clamp, familyShare, fmtMoney, round1, type Character } from './model.js';
import type { Ctx, YearDef } from './years.js';

type Effect = (c: Character, ctx: Ctx) => { text: string; tone: Tone };

interface MiniOption {
  id: string;
  label: string;
  hint?: string;
  /** Coût (au lycée et pendant les études, la famille en paie une part) */
  cost?: number;
  show?: (c: Character) => boolean;
  requires?: (c: Character) => string | null;
  /** Probabilité de réussite (candidatures) */
  chance?: (c: Character) => number;
  /** Choix appliqué sans réponse */
  default?: boolean;
  effect: Effect;
  /** Effet en cas d'échec (candidatures) */
  fail?: Effect;
}

interface MiniItem {
  id: string;
  icon: string;
  title: string;
  text: string | ((c: Character) => string);
  options: MiniOption[];
}

interface MiniGame {
  kind: MiniGameView['kind'];
  icon: string;
  title: string;
  intro: string;
  items: MiniItem[];
  /** Candidatures : nombre de choix maximum */
  maxPicks?: number;
}

const up = (v: number) => (v >= 0 ? `+${String(round1(v)).replace('.', ',')}` : `−${String(round1(-v)).replace('.', ',')}`);
const grade = (c: Character, d: number) => (c.grade = round1(clamp(c.grade + d, 0, 20)));
const energy = (c: Character, d: number) => (c.energy = round1(clamp(c.energy + d, 0, 5)));
const contacts = (c: Character, d: number) => (c.contacts = round1(clamp(c.contacts + d, 0, 10)));
const ok = (text: string): { text: string; tone: Tone } => ({ text, tone: 'good' });
const meh = (text: string): { text: string; tone: Tone } => ({ text, tone: 'neutral' });
const ko = (text: string): { text: string; tone: Tone } => ({ text, tone: 'bad' });
const needContacts = (n: number) => (c: Character) => (c.contacts >= n ? null : `Il faut ${n} contacts`);

const MINIGAMES: Record<string, MiniGame> = {
  // ------------------------------------------------------------- Seconde
  seconde: {
    kind: 'cards',
    icon: 'backpack',
    title: 'La rentrée',
    intro: 'Trois situations de début d’année. À toi de trancher.',
    items: [
      {
        id: 'dm',
        icon: 'ruler',
        title: 'Un DM de maths très dur pour lundi',
        text: 'Tu bloques sur le dernier exercice.',
        options: [
          {
            id: 'parents',
            label: 'Demander de l’aide à la maison',
            effect: (c) =>
              c.origin === 'superieure'
                ? (grade(c, 0.3), ok('Tes parents t’expliquent tout : +0,3'))
                : c.origin === 'moyenne'
                  ? (grade(c, 0.15), ok('Tes parents t’aident un peu : +0,15'))
                  : meh('Tes parents ne connaissent pas ce programme : personne pour t’aider'),
          },
          { id: 'seul', label: 'Le finir seul·e tard le soir', default: true, effect: (c) => (grade(c, 0.1), energy(c, -0.4), meh('Fini à minuit : +0,1, −0,4 énergie')) },
          { id: 'ami', label: 'Le faire avec un ami', effect: (c) => (contacts(c, 0.3), meh('À deux, ça va plus vite : +0,3 contact')) },
        ],
      },
      {
        id: 'delegue',
        icon: 'vote',
        title: 'Élections de délégués',
        text: 'Le prof principal te propose de te présenter.',
        options: [
          { id: 'oui', label: 'Se présenter', effect: (c) => ((c.engagement += 1), energy(c, -0.3), ok('Élu·e délégué·e : ton dossier s’étoffe')) },
          { id: 'non', label: 'Laisser la place', default: true, effect: () => meh('Tu restes discret·e cette année') },
        ],
      },
      {
        id: 'theatre',
        icon: 'masks',
        title: 'Sortie au théâtre',
        text: 'La classe va voir une pièce en ville.',
        options: [
          { id: 'go', label: 'Y aller', cost: 40, effect: (c) => (contacts(c, 0.2), ok('Une belle soirée avec la classe : +0,2 contact')) },
          { id: 'non', label: 'Rester à la maison', default: true, effect: () => meh('Tu rates la sortie') },
        ],
      },
    ],
  },

  // ------------------------------------------------------------- Première
  premiere: {
    kind: 'cards',
    icon: 'clipboard',
    title: 'Le conseil de classe',
    intro: 'Le premier trimestre est passé. Comment réagis-tu ?',
    items: [
      {
        id: 'bulletin',
        icon: 'file',
        title: '« Peut mieux faire »',
        text: 'Ton bulletin est moyen.',
        options: [
          {
            id: 'rdv',
            label: 'Tes parents rencontrent le prof',
            effect: (c) =>
              c.origin === 'populaire'
                ? meh('Tes parents ne peuvent pas quitter leur travail pour le rendez-vous')
                : (grade(c, c.origin === 'superieure' ? 0.25 : 0.1), ok(`Tes parents savent quoi demander : ${up(c.origin === 'superieure' ? 0.25 : 0.1)}`)),
          },
          { id: 'planning', label: 'Te faire un planning de révisions', default: true, effect: (c) => (grade(c, 0.1), energy(c, -0.2), meh('Tu t’organises : +0,1')) },
        ],
      },
      {
        id: 'cours',
        icon: 'teacher',
        title: 'Des cours particuliers ?',
        text: 'Un étudiant propose des cours de maths.',
        options: [
          { id: 'payer', label: 'Prendre 10 heures', cost: 300, effect: (c) => (grade(c, 0.4), ok('Les cours paient : +0,4')) },
          { id: 'cdi', label: 'Groupe d’entraide au CDI', default: true, effect: (c) => (grade(c, 0.15), contacts(c, 0.2), ok('Gratuit et utile : +0,15')) },
        ],
      },
      {
        id: 'jpo',
        icon: 'institution',
        title: 'Portes ouvertes d’une grande école',
        text: 'À Paris, un samedi. Le train coûte 80 €.',
        options: [
          { id: 'go', label: 'Y aller', cost: 80, effect: (c) => ((c.info = true), ok('Tu découvres les prépas et les grandes écoles')) },
          { id: 'non', label: 'Pas cette fois', default: true, effect: () => meh('Tu n’y vas pas') },
        ],
      },
    ],
  },

  // ------------------------------------------------------------- Terminale
  terminale: {
    kind: 'cards',
    icon: 'alarm',
    title: 'La semaine du bac blanc',
    intro: 'Trois imprévus tombent pendant la semaine la plus chargée.',
    items: [
      {
        id: 'frere',
        icon: 'sick',
        title: 'Ton petit frère est malade',
        text: 'Personne pour le garder mardi.',
        options: [
          { id: 'garder', label: 'Le garder toi-même', default: true, effect: (c) => (grade(c, -0.2), meh('Une journée de révision perdue : −0,2')) },
          { id: 'voisin', label: 'Demander à un voisin', requires: needContacts(2), effect: () => ok('Le voisin s’en occupe : rien de perdu') },
          { id: 'nounou', label: 'Tes parents prennent une baby-sitter', show: (c) => c.origin === 'superieure', effect: () => ok('Problème réglé en un coup de fil') },
        ],
      },
      {
        id: 'wifi',
        icon: 'signal',
        title: 'Plus d’internet à la maison',
        text: 'La veille de l’épreuve de spécialité.',
        options: [
          { id: 'cdi', label: 'Réviser au CDI jusqu’à la fermeture', default: true, effect: (c) => (energy(c, -0.3), meh('Ça marche, mais tu rentres tard : −0,3 énergie')) },
          { id: 'ami', label: 'Aller chez un ami', requires: needContacts(2), effect: (c) => (contacts(c, 0.2), ok('Révisions à deux : +0,2 contact')) },
          { id: 'cle', label: 'Acheter une clé 4G', cost: 40, effect: () => ok('Connexion rétablie') },
        ],
      },
      {
        id: 'nuit',
        icon: 'moon',
        title: 'La veille de l’épreuve',
        text: 'Il te reste un chapitre entier.',
        options: [
          { id: 'blanche', label: 'Nuit blanche', effect: (c) => (grade(c, 0.3), energy(c, -1), meh('+0,3, mais −1 énergie')) },
          { id: 'dormir', label: 'Dormir', default: true, effect: (c) => (energy(c, 0.5), ok('Bien reposé·e : +0,5 énergie')) },
        ],
      },
    ],
  },

  // ------------------------------------------------------------- Études 1
  etudes1: {
    kind: 'budget',
    icon: 'receipt',
    title: 'Le budget du mois',
    intro: 'Premier mois seul·e. Ta jauge doit rester au-dessus de zéro.',
    items: [
      {
        id: 'courses',
        icon: 'cart',
        title: 'Courses',
        text: 'Pour un mois.',
        options: [
          { id: 'pates', label: 'Pâtes tout le mois', effect: (c) => (energy(c, -0.4), ko('Pâtes tous les soirs : −0,4 énergie')) },
          { id: 'normal', label: 'Normal', cost: 150, default: true, effect: () => meh('Des courses normales') },
          { id: 'frais', label: 'Frais et équilibré', cost: 300, effect: (c) => (energy(c, 0.3), ok('Bien nourri·e : +0,3 énergie')) },
        ],
      },
      {
        id: 'transport',
        icon: 'bike',
        title: 'Transport',
        text: 'Pour aller en cours.',
        options: [
          { id: 'velo', label: 'Vélo', default: true, effect: (c) => (energy(c, -0.2), meh('Vélo sous la pluie : −0,2 énergie')) },
          { id: 'bus', label: 'Abonnement bus', cost: 50, effect: () => meh('Le bus, tranquille') },
          { id: 'voiture', label: 'Voiture', cost: 250, effect: (c) => (energy(c, 0.3), ok('Tu gagnes du temps : +0,3 énergie')) },
        ],
      },
      {
        id: 'loisirs',
        icon: 'party',
        title: 'Sorties',
        text: 'Soirées, week-ends.',
        options: [
          { id: 'rien', label: 'Aucune sortie', default: true, effect: (c) => (contacts(c, -0.2), ko('Tu ne vois personne : −0,2 contact')) },
          { id: 'soirees', label: 'Soirées étudiantes', cost: 100, effect: (c) => (contacts(c, 0.4), ok('+0,4 contact')) },
          { id: 'ski', label: 'Week-end au ski', cost: 400, effect: (c) => (contacts(c, 0.8), ok('Le week-end dont tout le monde parle : +0,8 contact')) },
        ],
      },
    ],
  },

  // ------------------------------------------------------------- Études 2
  etudes2: {
    kind: 'offers',
    icon: 'mail',
    title: 'Le job d’été',
    intro: 'Envoie jusqu’à 3 candidatures. Les meilleures offres ne sont pas affichées pour tout le monde.',
    maxPicks: 3,
    items: [
      {
        id: 'offers',
        icon: 'mail',
        title: 'Les offres',
        text: 'Choisis dans l’ordre de préférence.',
        options: [
          {
            id: 'cabinet',
            label: 'Assistant·e dans un cabinet d’avocats',
            hint: '2 500 € · réseau ++',
            show: (c) => c.contacts >= 5,
            chance: () => 0.85,
            effect: (c) => ((c.budget += 2_500), contacts(c, 1), ok('Pris·e grâce à un ami de tes parents : +2 500 €, +1 contact')),
          },
          {
            id: 'banque',
            label: 'Stage d’été en banque',
            hint: '2 000 € · sur dossier',
            show: (c) => c.contacts >= 3,
            chance: (c) => clamp(0.3 + (c.grade - 10) * 0.08 + c.contacts * 0.04, 0.1, 0.8),
            effect: (c) => ((c.budget += 2_000), contacts(c, 0.6), ok('Pris·e : +2 000 €, +0,6 contact')),
          },
          {
            id: 'colo',
            label: 'Animateur·rice de colonie',
            hint: '1 200 € · BAFA',
            chance: () => 0.6,
            effect: (c) => ((c.budget += 1_200), contacts(c, 0.3), ok('Un été d’animateur : +1 200 €, +0,3 contact')),
          },
          {
            id: 'entrepot',
            label: 'Préparateur·rice en entrepôt',
            hint: '1 800 € · physique',
            chance: () => 0.85,
            effect: (c) => ((c.budget += 1_800), energy(c, -0.5), meh('Un été à porter des cartons : +1 800 €, −0,5 énergie')),
          },
          {
            id: 'caisse',
            label: 'Caissier·ère au supermarché',
            hint: '1 400 €',
            default: true,
            chance: () => 0.9,
            effect: (c) => ((c.budget += 1_400), meh('Un été en caisse : +1 400 €')),
          },
        ],
      },
    ],
  },

  // ------------------------------------------------------------- Travail 1
  travail1: {
    kind: 'cards',
    icon: 'handshake',
    title: 'L’entretien annuel',
    intro: 'Ton manager te reçoit. Trois questions, trois réponses.',
    items: [
      {
        id: 'demande',
        icon: 'chat',
        title: '« Qu’attends-tu de l’année prochaine ? »',
        text: 'C’est le moment de demander quelque chose.',
        options: [
          {
            id: 'augmentation',
            label: 'Négocier une augmentation',
            effect: (c, ctx) =>
              ctx.roll(clamp(0.25 + c.performance * 0.05 + c.contacts * 0.04, 0.1, 0.8))
                ? ((c.budget += 1_500), ok('Augmentation accordée : +1 500 €'))
                : ko('« Pas cette année. »'),
          },
          { id: 'formation', label: 'Demander une formation', effect: (c) => (grade(c, 0.3), ok('Formation acceptée : compétences +0,3')) },
          { id: 'rien', label: 'Ne rien demander', default: true, effect: () => meh('Tu ne demandes rien') },
        ],
      },
      {
        id: 'afterwork',
        icon: 'toast',
        title: 'Afterwork avec la direction',
        text: 'Vendredi soir, dans un bar chic.',
        options: [
          { id: 'go', label: 'Y aller', cost: 60, effect: (c) => (contacts(c, 0.4), ok('Tu te fais remarquer : +0,4 contact')) },
          { id: 'non', label: 'Rentrer chez toi', default: true, effect: (c) => (energy(c, 0.3), meh('Une soirée tranquille : +0,3 énergie')) },
        ],
      },
      {
        id: 'projet',
        icon: 'chart',
        title: 'Un projet risqué',
        text: 'Ton manager cherche un volontaire.',
        options: [
          {
            id: 'oui',
            label: 'Se porter volontaire',
            effect: (c, ctx) => (ctx.roll(0.55) ? ((c.performance += 2), ok('Le projet réussit : +2 performance')) : (energy(c, -1), ko('Le projet échoue : −1 énergie'))),
          },
          { id: 'non', label: 'Laisser passer', default: true, effect: () => meh('Tu restes sur tes dossiers') },
        ],
      },
    ],
  },

  // ------------------------------------------------------------- Travail 2
  travail2: {
    kind: 'wheel',
    icon: 'wheel',
    title: 'Le grand pari',
    intro: 'Tu as un peu d’argent de côté. Que fais-tu de tes économies ?',
    items: [
      {
        id: 'risque',
        icon: 'wheel',
        title: 'Ton placement',
        text: (c) => (c.budget > 0 ? `Tu as ${fmtMoney(c.budget)}.` : 'Tu n’as rien de côté pour l’instant.'),
        options: [
          { id: 'prudent', label: 'Prudent : livret d’épargne', hint: '+3 %, sans risque', default: true, effect: (c) => bet(c, 0.03, 0.03) },
          { id: 'equilibre', label: 'Équilibré : placement en bourse', hint: '+20 % ou −10 %', requires: (c) => (c.budget >= 2_000 ? null : 'Il faut 2 000 € de côté'), effect: (c, ctx) => bet(c, ctx.roll(0.6) ? 0.2 : -0.1, 0.1) },
          { id: 'audacieux', label: 'Audacieux : tout sur un projet', hint: '+60 % ou −50 %', requires: (c) => (c.budget >= 5_000 ? null : 'Il faut 5 000 € de côté'), effect: (c, ctx) => bet(c, ctx.roll(0.5) ? 0.6 : -0.5, 0.6) },
        ],
      },
    ],
  },
};

/** Pari : un gain ou une perte sur les économies (10 000 € au plus) ; la famille absorbe les pertes selon sa classe */
function bet(c: Character, rate: number, shown: number) {
  void shown;
  const base = Math.min(10_000, Math.max(0, c.budget));
  if (!base) return meh('Rien à placer cette année');
  const delta = Math.round(base * rate);
  if (delta < 0) {
    const loss = -delta;
    const covered = Math.round(loss * FAMILY_SAFETY[c.origin]);
    c.budget -= loss - covered;
    return ko(covered ? `Perte de ${fmtMoney(loss)}… ta famille en rembourse ${fmtMoney(covered)}` : `Perte sèche : −${fmtMoney(loss)}`);
  }
  c.budget += delta;
  return ok(`La roue tourne en ta faveur : +${fmtMoney(delta)}`);
}

// ================================================================= Vue et résolution

const payOf = (c: Character, o: MiniOption, year: YearDef) => (!o.cost ? 0 : year.stage === 'travail' ? o.cost : familyShare(c, o.cost));

function lockOf(c: Character, game: MiniGame, o: MiniOption, year: YearDef): string | null {
  const req = o.requires?.(c);
  if (req) return req;
  // Le budget du mois peut finir à découvert : c'est le jeu
  const pay = payOf(c, o, year);
  if (game.kind !== 'budget' && pay > 0 && c.budget < pay) return `Il te manque ${fmtMoney(pay - Math.max(0, c.budget))}`;
  return null;
}

export const hasMiniGame = (yearId: string) => !!MINIGAMES[yearId];

export function miniView(c: Character, year: YearDef): MiniGameView | null {
  const g = MINIGAMES[year.id];
  if (!g) return null;
  const items = g.items.map((it) => ({
    id: it.id,
    icon: it.icon,
    title: it.title,
    text: typeof it.text === 'function' ? it.text(c) : it.text,
    options: it.options
      .filter((o) => !o.show || o.show(c))
      .map((o) => {
        const pay = payOf(c, o, year);
        return { id: o.id, label: o.label, hint: o.hint ?? '', cost: o.cost ? pay : null, locked: lockOf(c, g, o, year) };
      }),
  }));
  const answers = c.mini;
  const spent = g.kind === 'budget' ? g.items.reduce((s, it) => s + (it.options.find((o) => o.id === answers[it.id]) ? payOf(c, it.options.find((o) => o.id === answers[it.id])!, year) : 0), 0) : 0;
  const done = g.kind === 'offers' ? !!answers.offers : g.items.every((it) => !!answers[it.id]);
  return {
    id: year.id,
    kind: g.kind,
    icon: g.icon,
    title: g.title,
    intro: g.intro,
    items,
    maxPicks: g.maxPicks ?? null,
    answers: { ...answers },
    budget: g.kind === 'budget' ? { start: Math.round(c.budget), spent } : null,
    done,
  };
}

/** Saisie : une option pour un élément (offres : ajoute ou retire de la liste) */
export function miniInput(c: Character, year: YearDef, item: string, option: string): string | null {
  const g = MINIGAMES[year.id];
  if (!g) return 'Pas de mini-jeu cette année';
  const it = g.items.find((x) => x.id === item);
  const o = it?.options.find((x) => x.id === option && (!x.show || x.show(c)));
  if (!it || !o) return 'Choix inconnu';
  const lock = lockOf(c, g, o, year);
  if (lock) return lock;
  if (g.kind === 'offers') {
    const list = (c.mini[item] ?? '').split(',').filter(Boolean);
    const i = list.indexOf(option);
    if (i >= 0) list.splice(i, 1);
    else {
      if (list.length >= (g.maxPicks ?? 3)) return `${g.maxPicks ?? 3} candidatures au maximum`;
      list.push(option);
    }
    c.mini[item] = list.join(',');
  } else c.mini[item] = option;
  return null;
}

/** Applique le mini-jeu à la clôture de l'année (choix par défaut si rien n'a été joué) */
export function resolveMini(c: Character, year: YearDef, ctx: Ctx): ReportLine[] {
  const g = MINIGAMES[year.id];
  if (!g) return [];
  const lines: ReportLine[] = [];
  const pay = (o: MiniOption) => {
    const p = payOf(c, o, year);
    if (p) c.budget -= p;
    return p;
  };
  for (const it of g.items) {
    const opts = it.options.filter((o) => !o.show || o.show(c));
    if (g.kind === 'offers') {
      let picks = (c.mini[it.id] ?? '').split(',').filter(Boolean).map((id) => opts.find((o) => o.id === id)).filter(Boolean) as MiniOption[];
      if (!picks.length) picks = opts.filter((o) => o.default);
      let hired = false;
      for (const o of picks) {
        if (ctx.roll(o.chance?.(c) ?? 0.5)) {
          const r = o.effect(c, ctx);
          lines.push({ icon: 'mail', text: `${o.label} : ${r.text}`, tone: r.tone });
          hired = true;
          break;
        }
        lines.push({ icon: 'mail', text: `${o.label} : candidature refusée`, tone: 'bad' });
      }
      if (!hired) lines.push({ icon: 'sun', text: 'Pas de job cet été', tone: 'bad' });
      continue;
    }
    let o = opts.find((x) => x.id === c.mini[it.id] && !lockOf(c, g, x, year));
    if (!o) o = opts.find((x) => x.default && !lockOf(c, g, x, year)) ?? opts.find((x) => !lockOf(c, g, x, year)) ?? opts[0]!;
    const p = pay(o);
    const r = o.effect(c, ctx);
    lines.push({ icon: it.icon, text: `${it.title} · ${r.text}${p ? ` (−${fmtMoney(p)})` : ''}`, tone: r.tone });
  }
  if (g.kind === 'budget' && c.budget < 0) lines.push({ icon: 'receipt', text: `Fin du mois à découvert : ${fmtMoney(c.budget)}`, tone: 'bad' });
  return lines;
}

export const MINI_TITLES: Record<string, { icon: string; title: string }> = Object.fromEntries(Object.entries(MINIGAMES).map(([id, g]) => [id, { icon: g.icon, title: g.title }]));
