/**
 * L'exposé joué : une suite d'étapes (diapositives, sondages, années de jeu, résultats…)
 * pilotée par la régie. Le moteur ne connaît pas Socket.IO : il est testable seul.
 */
import { randomUUID } from 'node:crypto';
import {
  CLASS_LABELS,
  DISTRIBUTIONS,
  LIMITS,
  SOCIAL_CLASSES,
  type CharacterView,
  type ControlView,
  type DeckAction,
  type DeckStep,
  type FactCard,
  type GameConfig,
  type GameExport,
  type GameInput,
  type PlayerGameView,
  type PlayerPatch,
  type ScreenPlayer,
  type ScreenStep,
  type SocialClass,
  type Tone,
  type YearView,
} from '../protocol.js';
import { COLLECTIVE_EVENTS, COMPARED_QUESTIONS, POLLS, REFORMS } from './content.js';
import { buildDebrief } from './debrief.js';
import { decode, encode } from './snapshot.js';
import { MINI_TITLES, miniInput, miniView, resolveMini } from './minigames.js';
import {
  DIPLOMA_LABEL,
  DIPLOMA_LEVEL,
  FAMILY_GIFT,
  FAMILY_LABEL,
  FAMILY_SUPPORT,
  FORMATIONS,
  FORMATION_IDS,
  HOME_HELP,
  JOB_LABEL,
  SCHOOLS,
  clamp,
  familyShare,
  fmtGrade,
  fmtMoney,
  newCharacter,
  round1,
  statusOf,
  trendOf,
  type Character,
  type FormationId,
  type Job,
} from './model.js';
import { capacities, dossier, eligibility, finalAssignment, phaseOne, visible, type PhaseOneResult } from './parcoursup.js';
import {
  STRATEGIES,
  TIERS,
  compareFinal,
  computeBac,
  computeDiploma,
  defaultStrategy,
  employability,
  finalClass,
  giveFamilyGift,
  jobMarket,
  moveOf,
  statLines,
  strategyLock,
  type FinalOutcome,
  type PersonalOutcome,
  type Strategy,
} from './results.js';
import {
  TOTAL_TOKENS,
  YEARS,
  applyTokens,
  bourseAmount,
  categoriesFor,
  costHint,
  forcedTokens,
  lockReason,
  rollShock,
  studyCost,
  yearById,
  type Ctx,
  type ReformId,
  type YearDef,
} from './years.js';

const EDIT_LABELS = { boursier: 'boursier', info: 'informé·e des filières sélectives', cordees: 'Cordées de la réussite', homeOwner: 'propriétaire' } as const;

export interface GameMember {
  id: string;
  displayName: string;
  avatar: string;
  color: string;
  connected: boolean;
}

export interface GameHooks {
  /** Rafraîchir les téléphones (tous si ids absent) */
  players(ids?: string[]): void;
  /** Rafraîchir l'écran projeté et la régie */
  live(): void;
}

export interface GameTimings {
  /** Durée des étapes à chrono hors années (s) */
  wishesSeconds: number;
  responseSeconds: number;
  jobsSeconds: number;
}
const DEFAULT_TIMINGS: GameTimings = { wishesSeconds: 75, responseSeconds: 60, jobsSeconds: 60 };

type Flash = { id: string; text: string; until: number };
type Pop = { id: string; text: string; tone: Tone; until: number };

/** Champs de l'état sauvegardés (tout sauf les dépendances, le chrono et les animations) */
const SNAPSHOT_FIELDS = [
  'cursor', 'furthest', 'startedAt', 'chars', 'charOf', 'pending', 'drawn', 'closed', 'lecture', 'revealed',
  'polls', 'pollOpen', 'votes', 'reform', 'yearChoices', 'crisis', 'wishes', 'wishesDone', 'ps', 'accepted',
  'responded', 'psFinal', 'psFinalText', 'bacOutcome', 'diplomaOutcome', 'strategies', 'jobsDone', 'jobOutcome',
  'finals', 'finalRevealed', 'card', 'feed',
] as const;

/** Lecture (débrief) affichée au second appui sur R, étape par étape */
const LECTURES: Record<string, string> = {
  premiere: 'lycee',
  terminale: 'depart',
  bac: 'bac',
  parcoursupFinal: 'information',
  etudes2: 'etudes',
  diploma: 'diplomes',
  jobs: 'travail',
  final: 'mobilite',
  stats: 'reforme',
};

const ORDER: Record<SocialClass, number> = { populaire: 0, moyenne: 1, superieure: 2 };
const GAME_KINDS = new Set(['draw', 'year', 'bac', 'vote', 'parcoursup', 'parcoursupResults', 'parcoursupFinal', 'diploma', 'jobs', 'final']);

export class ExposeGame {
  cursor = 0;
  furthest = 0;
  startedAt = Date.now();

  private readonly chars = new Map<string, Character>();
  /** joueur -> personnage (binôme : deux joueurs, un personnage) */
  private readonly charOf = new Map<string, string>();
  private drawn = false;

  // Chrono de l'étape en cours
  private endsAt: number | null = null;
  private remaining: number | null = null;
  private paused = false;
  private handle: NodeJS.Timeout | null = null;

  /** Étapes terminées (année clôturée, vœux clos…) et révélées */
  private readonly closed = new Set<string>();
  /** Étapes dont la lecture (débrief) est affichée à l'écran */
  private readonly lecture = new Set<string>();
  private readonly revealed = new Set<string>();

  // Sondages (anonymes : par joueur)
  private readonly polls = new Map<string, Map<string, (number | null)[]>>();
  private readonly pollOpen = new Set<string>();
  // Vote
  private readonly votes = new Map<string, string>();
  private reform: ReformId | null = null;
  // Années
  private readonly yearChoices = new Map<string, Map<string, number>>();
  private crisis = false;
  // Parcoursup
  private readonly wishes = new Map<string, FormationId[]>();
  private readonly wishesDone = new Set<string>();
  private ps: PhaseOneResult | null = null;
  private readonly accepted = new Map<string, FormationId>();
  private readonly responded = new Set<string>();
  private psFinal: Map<string, FormationId | 'vie_active'> | null = null;
  private readonly psFinalText = new Map<string, string>();
  // Résultats
  private readonly bacOutcome = new Map<string, PersonalOutcome>();
  private readonly diplomaOutcome = new Map<string, PersonalOutcome>();
  private readonly strategies = new Map<string, Strategy>();
  private readonly jobsDone = new Set<string>();
  private jobOutcome: Map<string, PersonalOutcome> | null = null;
  private readonly finals = new Map<string, FinalOutcome>();
  private finalRevealed = 0;

  private card: FactCard | null = null;
  private readonly feed: { id: string; text: string; tone: Tone | 'admin' }[] = [];
  private readonly flashes = new Map<string, Flash>();
  private readonly pops = new Map<string, Pop>();

  constructor(
    private readonly deck: DeckStep[],
    private readonly cards: FactCard[],
    members: GameMember[],
    private readonly roles: Map<string, SocialClass>,
    pairs: Map<string, string>,
    private readonly config: GameConfig,
    private readonly getMembers: () => Map<string, GameMember>,
    private readonly hooks: GameHooks,
    private readonly rnd: () => number = Math.random,
    private readonly timings: GameTimings = DEFAULT_TIMINGS,
  ) {
    // Les personnages sont créés au tirage ; les binômes sont fixés dès maintenant
    const seen = new Set<string>();
    for (const m of members) {
      if (seen.has(m.id)) continue;
      const partner = pairs.get(m.id);
      const ids = partner && members.some((x) => x.id === partner) ? [m.id, partner] : [m.id];
      for (const id of ids) {
        seen.add(id);
        this.charOf.set(id, m.id);
      }
      this.pending.set(m.id, ids);
    }
  }
  /** Personnages à créer au tirage : id -> membres */
  private readonly pending = new Map<string, string[]>();

  // ================================================================= Sauvegarde (reprise après un crash)

  /** État complet de la partie, en JSON, pour la sauvegarde en base */
  snapshot(): Record<string, unknown> {
    const data: Record<string, unknown> = { v: 1, savedAt: Date.now() };
    for (const f of SNAPSHOT_FIELDS) data[f] = encode((this as unknown as Record<string, unknown>)[f]);
    // Chrono : on garde le temps restant ; la partie reprendra en pause
    data.remaining = this.paused ? this.remaining : this.endsAt !== null ? Math.max(0, this.endsAt - Date.now()) : null;
    return data;
  }

  /** Recrée une partie à partir d'une sauvegarde : elle reprend en pause, à la même étape */
  static restore(
    data: Record<string, unknown>,
    deps: {
      deck: DeckStep[];
      cards: FactCard[];
      roles: Map<string, SocialClass>;
      config: GameConfig;
      getMembers: () => Map<string, GameMember>;
      hooks: GameHooks;
      rnd?: () => number;
      timings?: GameTimings;
    },
  ): ExposeGame {
    const g = new ExposeGame(deps.deck, deps.cards, [], deps.roles, new Map(), deps.config, deps.getMembers, deps.hooks, deps.rnd, deps.timings);
    const target = g as unknown as Record<string, unknown>;
    for (const f of SNAPSHOT_FIELDS) if (f in data) target[f] = decode(data[f]);
    g.paused = true;
    g.endsAt = null;
    g.remaining = typeof data.remaining === 'number' ? data.remaining : null;
    g.push('♻️ Partie reprise après un redémarrage du serveur : relancez avec Reprendre (P)', 'admin');
    return g;
  }

  // ================================================================= Navigation

  get step(): DeckStep {
    return this.deck[this.cursor]!;
  }
  get hasDrawn(): boolean {
    return this.drawn;
  }
  get replay(): boolean {
    return this.cursor < this.furthest;
  }
  private get list(): Character[] {
    return [...this.chars.values()];
  }

  start() {
    this.enter(0);
  }

  dispose() {
    this.clearTimer();
  }

  control(action: DeckAction, index?: number): string | null {
    switch (action) {
      case 'next':
        return this.next();
      case 'prev': {
        let i = this.cursor - 1;
        while (i >= 0 && !this.deck[i]!.enabled) i--;
        if (i < 0) return 'Déjà à la première étape';
        this.cursor = i;
        this.card = null;
        this.changed();
        return null;
      }
      case 'goto': {
        if (index === undefined || index < 0 || index >= this.deck.length) return 'Étape inconnue';
        if (index > this.furthest) return 'On ne saute pas une étape de jeu : utilise « Suivant »';
        this.cursor = index;
        this.card = null;
        this.changed();
        return null;
      }
      case 'close':
        return this.close();
      case 'reveal':
        return this.reveal();
      case 'extend':
        if (this.replay) return 'Étape déjà jouée';
        if (this.paused && this.remaining !== null) this.remaining += 15_000;
        else if (this.endsAt !== null) this.setTimer(this.endsAt - Date.now() + 15_000);
        else return 'Pas de chrono en cours';
        this.changed();
        return null;
      case 'pause':
        if (this.paused) return null;
        this.paused = true;
        if (this.endsAt !== null) {
          this.remaining = Math.max(0, this.endsAt - Date.now());
          this.clearTimer();
          this.endsAt = null;
        }
        this.changed();
        return null;
      case 'resume':
        if (!this.paused) return null;
        this.paused = false;
        if (this.remaining !== null) this.setTimer(this.remaining);
        this.remaining = null;
        this.changed();
        return null;
    }
  }

  private next(): string | null {
    // Une étape ouverte se clôt d'abord (année, vœux, réponses, stratégie)
    if (!this.replay && this.canClose()) return this.close();
    let i = this.cursor + 1;
    while (i < this.deck.length && !this.deck[i]!.enabled) i++;
    if (i >= this.deck.length) return 'C’est la dernière étape';
    this.card = null;
    if (i > this.furthest) {
      this.leave(this.step);
      this.enter(i);
    } else {
      this.cursor = i;
      this.changed();
    }
    return null;
  }

  /** Quitter une étape jouée : ce qui doit être figé l'est */
  private leave(step: DeckStep) {
    if (step.kind === 'poll') this.pollOpen.delete(step.ref!);
    if (step.kind === 'vote' && !this.reform) this.applyVote();
    if (step.kind === 'bac' || step.kind === 'diploma') this.revealed.add(step.id);
  }

  private enter(i: number) {
    this.cursor = i;
    this.furthest = Math.max(this.furthest, i);
    this.clearTimer();
    this.endsAt = null;
    this.remaining = null;
    this.paused = false;
    const step = this.step;
    switch (step.kind) {
      case 'poll':
        if (!this.polls.has(step.ref!)) this.polls.set(step.ref!, new Map());
        this.pollOpen.add(step.ref!);
        break;
      case 'draw':
        this.draw();
        break;
      case 'year':
        this.ensureDrawn();
        this.startYear(yearById(step.ref!)!);
        break;
      case 'bac':
        this.ensureDrawn();
        for (const c of this.list) if (!this.bacOutcome.has(c.id)) this.bacOutcome.set(c.id, computeBac(c, (p) => this.roll(p)));
        this.feedBac();
        break;
      case 'parcoursup':
        this.ensureDrawn();
        for (const c of this.list) {
          if (!c.bac) this.bacOutcome.set(c.id, computeBac(c, (p) => this.roll(p)));
          c.stats.hiddenSelective = !visible(c, 'prepa', this.reform);
          if (!this.eligiblePs(c)) this.wishesDone.add(c.id);
        }
        this.startTimer(this.timings.wishesSeconds * 1000);
        this.autoCloseCheck();
        break;
      case 'parcoursupResults':
        this.closeWishes();
        this.startTimer(this.timings.responseSeconds * 1000);
        this.autoCloseCheck();
        break;
      case 'parcoursupFinal':
        this.finalizeParcoursup();
        break;
      case 'diploma':
        this.ensurePs();
        for (const c of this.list) if (!this.diplomaOutcome.has(c.id)) this.diplomaOutcome.set(c.id, computeDiploma(c));
        break;
      case 'jobs':
        this.ensurePs();
        for (const c of this.list) {
          if (!c.diploma) this.diplomaOutcome.set(c.id, computeDiploma(c));
          const gift = giveFamilyGift(c);
          if (gift) c.path.push({ year: 'Vie active', kind: 'event', text: `Tes parents te donnent ${fmtMoney(gift)}` });
        }
        this.startTimer(this.timings.jobsSeconds * 1000);
        break;
      case 'final':
        this.ensureJobs();
        this.computeFinals();
        break;
    }
    this.changed();
  }

  // ---- Garde-fous : une étape de jeu masquée ou sautée est quand même calculée
  private ensureDrawn() {
    if (!this.drawn) this.draw();
  }
  private ensurePs() {
    this.ensureDrawn();
    if (!this.psFinal) {
      for (const c of this.list) if (!c.bac) computeBac(c, (p) => this.roll(p));
      if (!this.ps) this.closeWishes();
      this.finalizeParcoursup();
    }
  }
  private ensureJobs() {
    this.ensurePs();
    if (!this.jobOutcome) this.closeJobs();
  }

  private canClose(): boolean {
    if (this.replay) return false;
    const s = this.step;
    if (s.kind === 'year') return !this.closed.has(s.id);
    if (s.kind === 'parcoursup' || s.kind === 'parcoursupResults') return !this.closed.has(s.id);
    if (s.kind === 'jobs') return !this.jobOutcome;
    if (s.kind === 'poll') return this.pollOpen.has(s.ref!);
    return false;
  }

  /** Révélation classique (résultats, sondage, étages de la pyramide) encore possible ? */
  private canRevealResults(): boolean {
    const s = this.step;
    if (s.kind === 'poll' || s.kind === 'vote' || s.kind === 'bac' || s.kind === 'diploma' || s.kind === 'parcoursupResults') return !this.revealed.has(s.id);
    if (s.kind === 'jobs') return !this.revealed.has(s.id);
    if (s.kind === 'final') return this.finalRevealed < 4;
    return false;
  }

  /** Lecture (débrief) de l'étape : disponible une fois les résultats affichés */
  private lectureReady(): string | null {
    const s = this.step;
    const id = s.kind === 'year' ? LECTURES[s.ref!] : LECTURES[s.kind];
    if (!id || !this.drawn) return null;
    if (s.kind === 'year') return this.closed.has(s.id) ? id : null;
    if (s.kind === 'bac' || s.kind === 'diploma' || s.kind === 'jobs') return this.revealed.has(s.id) ? id : null;
    if (s.kind === 'final') return this.finalRevealed >= 4 ? id : null;
    return id;
  }

  private canReveal(): boolean {
    if (this.replay) return !!this.lectureReady();
    return this.canRevealResults() || !!this.lectureReady();
  }

  /** Ce que fera la prochaine révélation (libellé de la touche) */
  private revealLabel(): string {
    if (!this.replay && this.canRevealResults()) return this.step.kind === 'final' ? 'Étage suivant' : 'Révéler';
    if (this.lectureReady()) return this.lecture.has(this.step.id) ? 'Résultats' : 'Lecture';
    return 'Révéler';
  }

  close(): string | null {
    if (!this.canClose()) return 'Rien à clore à cette étape';
    const s = this.step;
    this.clearTimer();
    this.endsAt = null;
    this.remaining = null;
    if (s.kind === 'year') this.closeYear(yearById(s.ref!)!);
    else if (s.kind === 'parcoursup') this.closed.add(s.id);
    else if (s.kind === 'parcoursupResults') this.closed.add(s.id);
    else if (s.kind === 'jobs') this.closeJobs();
    else if (s.kind === 'poll') this.pollOpen.delete(s.ref!);
    this.changed();
    return null;
  }

  reveal(): string | null {
    if (!this.canReveal()) return 'Rien à révéler à cette étape';
    const s = this.step;
    // Une fois les résultats affichés, R bascule entre les résultats et leur lecture (débrief)
    if (this.replay || !this.canRevealResults()) {
      if (this.lecture.has(s.id)) this.lecture.delete(s.id);
      else this.lecture.add(s.id);
      this.changed();
      return null;
    }
    if (s.kind === 'final') {
      this.finalRevealed++;
    } else if (s.kind === 'jobs') {
      if (!this.jobOutcome) this.closeJobs();
      this.revealed.add(s.id);
    } else if (s.kind === 'vote') {
      this.applyVote();
      this.revealed.add(s.id);
    } else {
      if (s.kind === 'poll') this.pollOpen.delete(s.ref!);
      if (s.kind === 'parcoursupResults' && !this.closed.has(s.id)) {
        // La révélation laisse les joueurs répondre
      }
      this.revealed.add(s.id);
    }
    this.changed();
    return null;
  }

  // ================================================================= Chrono

  private startTimer(ms: number) {
    if (this.paused) {
      this.remaining = ms;
      return;
    }
    this.setTimer(ms);
  }
  private setTimer(ms: number) {
    this.clearTimer();
    this.endsAt = Date.now() + ms;
    const stepIndex = this.cursor;
    this.handle = setTimeout(() => {
      this.handle = null;
      this.endsAt = null;
      // Fin du temps : l'étape se clôt d'elle-même (si l'on est toujours dessus)
      if (this.furthest === stepIndex && this.canCloseAt(stepIndex)) {
        const saved = this.cursor;
        this.cursor = stepIndex;
        this.close();
        this.cursor = saved;
        this.changed();
      } else this.changed();
    }, Math.max(0, ms));
  }
  private canCloseAt(i: number) {
    const saved = this.cursor;
    this.cursor = i;
    const ok = this.canClose();
    this.cursor = saved;
    return ok;
  }
  private clearTimer() {
    if (this.handle) clearTimeout(this.handle);
    this.handle = null;
  }

  /** Clôture automatique dès que tout le monde a validé (personnages sans joueur connecté exclus) */
  private autoCloseCheck() {
    if (this.replay) return;
    const s = this.step;
    const active = this.list.filter((c) => c.members.some((m) => this.getMembers().get(m)?.connected));
    if (!active.length) return;
    const isDone = (c: Character) =>
      s.kind === 'year'
        ? c.done
        : s.kind === 'parcoursup'
          ? this.wishesDone.has(c.id)
          : s.kind === 'parcoursupResults'
            ? this.responded.has(c.id)
            : s.kind === 'jobs'
              ? this.jobsDone.has(c.id)
              : false;
    if (this.canClose() && s.kind !== 'poll' && active.every(isDone)) this.close();
  }

  // ================================================================= Tirage des familles

  private draw() {
    if (this.drawn) return;
    this.drawn = true;
    const ids = [...this.pending.keys()];
    const n = ids.length;
    const w = DISTRIBUTIONS[this.config.distribution].weights;
    const total = SOCIAL_CLASSES.reduce((s, c) => s + w[c], 0);
    const quota: Record<SocialClass, number> = { populaire: 0, moyenne: 0, superieure: 0 };
    for (const c of SOCIAL_CLASSES) quota[c] = Math.round((w[c] / total) * n);
    let diff = n - SOCIAL_CLASSES.reduce((s, c) => s + quota[c], 0);
    while (diff !== 0) {
      const c = diff > 0 ? 'moyenne' : (SOCIAL_CLASSES.slice().sort((a, b) => quota[b] - quota[a])[0] as SocialClass);
      quota[c] += diff > 0 ? 1 : -1;
      diff += diff > 0 ? -1 : 1;
    }
    // Au moins 2 joueurs par classe (si possible)
    if (n >= 6) {
      for (const c of SOCIAL_CLASSES) {
        while (quota[c] < 2) {
          const donor = SOCIAL_CLASSES.slice().sort((a, b) => quota[b] - quota[a])[0]!;
          quota[donor]--;
          quota[c]++;
        }
      }
    }
    const assigned = new Map<string, SocialClass>();
    for (const id of ids) {
      const role = this.pending.get(id)!.map((m) => this.roles.get(m)).find(Boolean);
      if (role) {
        assigned.set(id, role);
        quota[role] = Math.max(0, quota[role] - 1);
      }
    }
    const pool: SocialClass[] = SOCIAL_CLASSES.flatMap((c) => Array<SocialClass>(quota[c]).fill(c));
    const free = ids.filter((id) => !assigned.has(id));
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(this.rnd() * (i + 1));
      [pool[i], pool[j]] = [pool[j]!, pool[i]!];
    }
    free.forEach((id, k) => assigned.set(id, pool[k] ?? 'moyenne'));
    for (const id of ids) {
      const c = newCharacter(id, this.pending.get(id)!, assigned.get(id)!, this.rnd);
      this.chars.set(id, c);
    }
    this.push('🎲 Les familles sont tirées au sort', 'admin');
  }

  // ================================================================= Années

  private ctx(year: YearDef): Ctx {
    return { rnd: this.rnd, roll: (p) => this.roll(p), reform: this.reform, year };
  }
  private roll(p: number) {
    return this.rnd() < p;
  }

  private startYear(year: YearDef) {
    this.crisis = false;
    for (const c of this.list) {
      c.tokens = {};
      c.choice = null;
      c.mini = {};
      c.done = false;
      c.report = null;
      (c as Character & { forced?: ReturnType<typeof forcedTokens> }).forced = forcedTokens(c, year, this.reform);
    }
    this.startTimer(this.config.yearSeconds * 1000);
  }

  private forcedOf(c: Character) {
    return (c as Character & { forced?: ReturnType<typeof forcedTokens> }).forced ?? [];
  }
  private freeTokens(c: Character) {
    return TOTAL_TOKENS - this.forcedOf(c).reduce((s, f) => s + f.count, 0);
  }

  private optionsFor(c: Character, year: YearDef) {
    const ctx = this.ctx(year);
    return year.decision.options.filter((o) => !o.show || o.show(c, ctx));
  }

  private closeYear(year: YearDef) {
    const step = this.step;
    this.closed.add(step.id);
    const ctx = this.ctx(year);
    const counts = new Map<string, number>();
    for (const c of this.list) {
      const before = c.grade;
      const jobAtStart = c.job;
      const forced = this.forcedOf(c);
      const free = this.freeTokens(c);
      // Jetons non placés : la voie la plus probable (jamais la pire)
      const placed = Object.values(c.tokens).reduce((s, v) => s + v, 0);
      if (placed === 0) c.tokens = defaultTokens(year, free);
      else if (placed < free) c.tokens.repos = (c.tokens.repos ?? 0) + (free - placed);
      const jobForced = forced.find((f) => f.category === 'job');
      if (jobForced) c.stats.forcedJobs += jobForced.count;

      // Décision : choix du joueur, sinon la voie la plus probable
      const opts = this.optionsFor(c, year);
      let opt = opts.find((o) => o.id === c.choice && !lockReason(c, o, ctx));
      if (!opt) {
        const fb = year.decision.fallback(c, ctx);
        opt = opts.find((o) => o.id === fb && !lockReason(c, o, ctx)) ?? opts.find((o) => !lockReason(c, o, ctx)) ?? opts[0]!;
      }
      counts.set(opt.id, (counts.get(opt.id) ?? 0) + 1);
      const lines: { emoji: string; text: string; tone: Tone }[] = [];
      if (opt.cost) {
        const pay = year.stage === 'travail' ? opt.cost : familyShare(c, opt.cost);
        c.budget -= pay;
        if (opt.cost > pay) lines.push({ emoji: '👪', text: pay ? `Tes parents paient ${fmtMoney(opt.cost - pay)}, toi ${fmtMoney(pay)}` : `Tes parents paient ${fmtMoney(opt.cost)}`, tone: 'neutral' });
        else lines.push({ emoji: '💸', text: `Tu paies ${fmtMoney(pay)}`, tone: 'neutral' });
      }
      const out = opt.resolve(c, ctx);
      lines.unshift({ emoji: opt.emoji, text: out.text, tone: out.tone });
      c.path.push({ year: year.label, kind: 'choice', text: opt.label, action: opt.id });
      if (out.path) {
        c.path.push({ year: year.label, action: opt.id, ...out.path });
        this.highlight(c, out.path.text, out.path.kind === 'close' || out.path.kind === 'event' ? 'bad' : 'good');
      }
      if (forced.some((f) => f.category === 'famille')) lines.push({ emoji: '🏠', text: 'Un jeton est parti pour aider à la maison', tone: 'neutral' });

      lines.push(...applyTokens(c, year, forced, ctx));
      // Mini-jeu de l'année
      lines.push(...resolveMini(c, year, ctx));

      // Études : coût de la formation et du logement
      if (year.stage === 'etudes' && c.formation && c.formation !== 'vie_active') {
        const cost = studyCost(c);
        const share = cost > 0 ? familyShare(c, cost) : cost;
        const bourse = bourseAmount(c, this.reform);
        const toPay = share - bourse;
        c.budget -= toPay;
        if (cost < 0) lines.push({ emoji: '🔁', text: `Salaire d’alternant : +${fmtMoney(-cost)}`, tone: 'good' });
        else
          lines.push({
            emoji: '🎒',
            text: `Études et logement : ${fmtMoney(cost)}${cost > share ? `, dont ${fmtMoney(cost - share)} payés par tes parents` : ''}${bourse ? `, bourse ${fmtMoney(bourse)}` : ''} → ${toPay > 0 ? `−${fmtMoney(toPay)} pour toi` : 'rien à payer'}`,
            tone: toPay > 0 ? 'bad' : 'good',
          });
      }

      // Coup du sort (35 %) — crise : licenciements plus probables
      const shock = this.crisis && year.stage === 'travail' ? this.crisisShock(c) : rollShock(c, year, ctx);
      if (shock) {
        lines.push(shock);
        if (shock.tone !== 'neutral') this.pop(c, `${shock.emoji} ${shock.text.split(':')[0]}`, shock.tone);
        if (shock.text.startsWith('Licenciement')) {
          c.path.push({ year: year.label, kind: 'event', text: 'Licenciement' });
          this.highlight(c, 'licenciement économique', 'bad');
        }
      }
      // Consolidation (J12) : un poste obtenu cette année ne compte pas encore comme « tenu »
      if (year.stage === 'travail' && c.job !== jobAtStart) c.jobYears = 0;
      if (c.budget < 0 && year.stage !== 'travail') lines.push({ emoji: '🧾', text: `Tu es à découvert : ${fmtMoney(c.budget)}`, tone: 'bad' });
      if (year.stage !== 'travail' || c.grades.length < 7) c.grades.push(c.grade);
      c.report = { title: year.label, grade: c.grade, before, appreciation: appreciation(c, before, year), lines };
      c.done = true;
    }
    this.yearChoices.set(year.id, counts);
    this.crisis = false;
  }

  private crisisShock(c: Character) {
    if (c.job && c.job !== 'chef' && c.job !== 'chomage' && !c.job.startsWith('fonction') && this.roll(c.origin === 'populaire' ? 0.5 : 0.35)) {
      if (c.contacts >= 6) return { emoji: '📉', text: 'Crise : plan social… mais ton réseau te retrouve un poste', tone: 'neutral' as Tone };
      const before = c.job;
      c.job = 'chomage';
      c.jobYears = 0;
      return { emoji: '📉', text: `Licenciement économique (crise) : tu perds ton poste (${JOB_LABEL[before]})`, tone: 'bad' as Tone };
    }
    return null;
  }

  // ================================================================= Vote

  private applyVote() {
    if (this.reform) return;
    const counts = REFORMS.map((r) => [...this.votes.values()].filter((v) => v === r.id).length);
    const max = Math.max(...counts);
    const winners = REFORMS.filter((_, i) => counts[i] === max);
    this.reform = max === 0 || winners.length > 1 ? 'statu_quo' : (winners[0]!.id as ReformId);
    const r = REFORMS.find((x) => x.id === this.reform)!;
    this.push(`🗳️ Réforme adoptée : ${r.label}`, 'admin');
  }

  // ================================================================= Parcoursup

  private eligiblePs(c: Character) {
    return !!c.bac && c.bac !== 'aucun';
  }

  private closeWishes() {
    if (this.ps) return;
    this.closed.add(this.deck.find((s) => s.kind === 'parcoursup')?.id ?? 'voeux');
    const eligible = this.list.filter((c) => this.eligiblePs(c));
    for (const c of eligible) {
      const w = this.wishes.get(c.id);
      if (!w?.length) {
        // Sans réponse : la voie la plus probable
        const auto = (c.bac === 'general' ? ['licence', 'but', 'bts'] : ['bts', 'but', 'alternance']) as FormationId[];
        this.wishes.set(c.id, auto.filter((f) => !eligibility(c, f)));
      }
    }
    this.ps = phaseOne(eligible, this.wishes, this.reform);
    for (const c of this.list) if (!this.eligiblePs(c)) this.responded.add(c.id);
    // Personne sans aucune offre : pas besoin de répondre
    for (const c of eligible) {
      const res = this.ps.results.get(c.id) ?? [];
      if (!res.some((r) => r.status !== 'refuse')) this.responded.add(c.id);
      if (res.length && res.every((r) => r.status === 'refuse')) this.highlight(c, 'refusé·e sur tous ses vœux', 'bad');
    }
  }

  private finalizeParcoursup() {
    if (this.psFinal) return;
    if (!this.ps) this.closeWishes();
    const eligible = this.list.filter((c) => this.eligiblePs(c));
    const res = finalAssignment(eligible, this.wishes, this.accepted, this.reform);
    this.psFinal = new Map();
    for (const c of this.list) {
      const f = res.get(c.id) ?? 'vie_active';
      this.psFinal.set(c.id, f);
      c.formation = f;
      c.housing = 'parents';
      const wish = this.wishes.get(c.id) ?? [];
      if (f === 'vie_active') {
        c.path.push({ year: 'Parcoursup', kind: 'close', text: this.eligiblePs(c) ? 'Aucune formation : vie active' : 'Sans bac : vie active directe' });
        this.psFinalText.set(c.id, this.eligiblePs(c) ? 'Plus aucune place pour toi : tu entres dans la vie active.' : 'Sans le bac, pas de Parcoursup : tu entres directement dans la vie active.');
      } else {
        const rank = wish.indexOf(f);
        const text = rank === 0 ? 'Ton premier vœu !' : rank > 0 ? `Ton vœu n° ${rank + 1}.` : 'Phase complémentaire : une place qui restait.';
        this.psFinalText.set(c.id, text);
        c.path.push({ year: 'Parcoursup', kind: 'title', text: FORMATIONS[f].label });
        if (f === 'prepa' || f === 'prepa_privee' || f === 'iep') this.highlight(c, `entre en ${FORMATIONS[f].label.toLowerCase()}`, 'good');
      }
    }
  }

  // ================================================================= Premier emploi

  private closeJobs() {
    if (this.jobOutcome) return;
    for (const c of this.list) {
      if (!this.strategies.has(c.id)) this.strategies.set(c.id, defaultStrategy(c));
      const s = this.strategies.get(c.id)!;
      if (strategyLock(c, s)) this.strategies.set(c.id, defaultStrategy(c));
    }
    this.jobOutcome = jobMarket(this.list, this.strategies, { addressEffect: this.config.addressEffect, roll: (p) => this.roll(p), rnd: this.rnd });
    for (const c of this.list) {
      if (c.job === 'chomage') this.highlight(c, 'au chômage', 'bad');
      else if (c.job === 'cadre' || c.job === 'chef' || c.job === 'fonction_a') this.highlight(c, JOB_LABEL[c.job].toLowerCase(), 'good');
    }
    const s = this.deck.find((d) => d.kind === 'jobs');
    if (s) this.closed.add(s.id);
  }

  // ================================================================= Pyramide

  private computeFinals() {
    if (this.finals.size) return;
    for (const c of this.list) this.finals.set(c.id, finalClass(c));
  }

  private ranking() {
    return this.list
      .map((c) => ({ c, f: this.finals.get(c.id) ?? finalClass(c) }))
      .sort(compareFinal);
  }

  // ================================================================= Saisies des joueurs

  input(playerId: string, input: GameInput): string | null {
    if (this.replay) return 'Regarde l’écran : cette étape est déjà jouée';
    const step = this.step;
    // Sondages : anonymes, un vote par joueur (pas par personnage)
    if (input.type === 'poll') {
      if (step.kind !== 'poll' || !this.pollOpen.has(step.ref!)) return 'Le sondage est fermé';
      const qs = POLLS[step.ref!]!;
      if (!Number.isInteger(input.question) || input.question < 0 || input.question >= qs.length) return 'Question inconnue';
      if (!Number.isInteger(input.option) || input.option < 0 || input.option >= qs[input.question]!.options.length) return 'Réponse inconnue';
      const map = this.polls.get(step.ref!)!;
      const answers = map.get(playerId) ?? qs.map(() => null);
      answers[input.question] = input.option;
      map.set(playerId, answers);
      this.changed([playerId]);
      return null;
    }
    if (input.type === 'vote') {
      if (step.kind !== 'vote' || this.reform) return 'Le vote est fermé';
      if (!REFORMS.some((r) => r.id === input.optionId)) return 'Réforme inconnue';
      this.votes.set(playerId, input.optionId);
      this.changed([playerId]);
      return null;
    }
    const cid = this.charOf.get(playerId);
    const c = cid ? this.chars.get(cid) : undefined;
    if (!c) return 'Attends le tirage des familles';
    const mates = c.members;

    switch (input.type) {
      case 'tokens':
      case 'decide':
      case 'mini':
      case 'submit': {
        if (step.kind !== 'year' || this.closed.has(step.id)) return 'L’année est terminée';
        const year = yearById(step.ref!)!;
        if (input.type === 'tokens') {
          const cats = new Set(categoriesFor(year.stage).map((x) => x.id));
          let sum = 0;
          const clean: Record<string, number> = {};
          for (const [k, v] of Object.entries(input.tokens)) {
            if (!cats.has(k) || !Number.isInteger(v) || v < 0) return 'Répartition invalide';
            if (v) clean[k] = v;
            sum += v;
          }
          if (sum > this.freeTokens(c)) return `Tu n’as que ${this.freeTokens(c)} jetons`;
          c.tokens = clean;
        } else if (input.type === 'decide') {
          const opt = this.optionsFor(c, year).find((o) => o.id === input.optionId);
          if (!opt) return 'Choix impossible';
          const lock = lockReason(c, opt, this.ctx(year));
          if (lock) return lock;
          c.choice = opt.id;
        } else if (input.type === 'mini') {
          const err = miniInput(c, year, input.item, input.option);
          if (err) return err;
        } else {
          c.done = true;
        }
        this.changed(mates);
        if (input.type === 'submit') this.autoCloseCheck();
        return null;
      }
      case 'wishes': {
        if (step.kind !== 'parcoursup' || this.closed.has(step.id)) return 'Les vœux sont fermés';
        if (!this.eligiblePs(c)) return 'Sans le bac, pas de Parcoursup';
        const list = [...new Set(input.wishes)];
        if (list.length > LIMITS.wishesMax) return `${LIMITS.wishesMax} vœux au maximum`;
        for (const f of list) {
          if (!FORMATION_IDS.includes(f as FormationId) || !visible(c, f as FormationId, this.reform)) return 'Formation inconnue';
          const lock = eligibility(c, f as FormationId);
          if (lock) return lock;
        }
        if (input.submit && !list.length) return 'Choisis au moins un vœu';
        this.wishes.set(c.id, list as FormationId[]);
        const ask = input.bourse && c.origin !== 'superieure';
        c.boursier = ask;
        c.stats.askedBourse = input.bourse;
        if (input.submit) this.wishesDone.add(c.id);
        else this.wishesDone.delete(c.id);
        this.changed(mates);
        if (input.submit) this.autoCloseCheck();
        return null;
      }
      case 'response': {
        if (step.kind !== 'parcoursupResults' || this.closed.has(step.id) || !this.ps) return 'Les réponses sont closes';
        const res = this.ps.results.get(c.id) ?? [];
        if (input.accept === null) {
          this.accepted.delete(c.id);
        } else {
          const r = res.find((x) => x.formation === input.accept);
          if (!r || r.status !== 'admis') return 'Tu n’es pas admis·e dans cette formation';
          this.accepted.set(c.id, r.formation);
        }
        this.responded.add(c.id);
        this.changed(mates);
        this.autoCloseCheck();
        return null;
      }
      case 'job': {
        if (step.kind !== 'jobs' || this.jobOutcome) return 'Le recrutement est terminé';
        const s = STRATEGIES.find((x) => x.id === input.optionId);
        if (!s) return 'Stratégie inconnue';
        const lock = strategyLock(c, s.id);
        if (lock) return lock;
        this.strategies.set(c.id, s.id);
        this.jobsDone.add(c.id);
        this.changed(mates);
        this.autoCloseCheck();
        return null;
      }
    }
    return 'Action inconnue';
  }

  // ================================================================= Régie : argent, événements, cartes

  give(target: string, amount: number): string | null {
    if (!this.drawn) return 'Les familles ne sont pas encore tirées';
    const list = target === 'all' ? this.list : target.startsWith('class:') ? this.list.filter((c) => c.origin === target.slice(6)) : this.list.filter((c) => c.id === target || c.members.includes(target));
    if (!list.length) return 'Personne à qui donner';
    for (const c of list) {
      c.budget += amount;
      this.flash(c, `${amount > 0 ? '💶 Tu reçois' : '💸 On te retire'} ${fmtMoney(Math.abs(amount))}`);
    }
    const who = target === 'all' ? 'tout le monde' : target.startsWith('class:') ? CLASS_LABELS[target.slice(6) as SocialClass].toLowerCase() : this.nameOf(list[0]!);
    this.push(`${amount > 0 ? '💶' : '💸'} ${who} : ${amount > 0 ? '+' : '−'}${fmtMoney(Math.abs(amount))}`, 'admin');
    this.changed();
    return null;
  }

  event(eventId: string): string | null {
    if (!this.drawn) return 'Les familles ne sont pas encore tirées';
    if (eventId === 'crise') {
      const s = this.step;
      if (s.kind !== 'year' || yearById(s.ref!)!.stage !== 'travail' || this.closed.has(s.id)) return 'La crise se déclenche pendant une période de travail (année ouverte)';
      this.crisis = true;
      for (const c of this.list) this.flash(c, '📉 Crise économique : les entreprises licencient cette année');
      this.push('📉 Crise économique : licenciements plus probables', 'admin');
    } else if (eventId === 'heritage') {
      const c = this.list[Math.floor(this.rnd() * this.list.length)]!;
      c.budget += 20_000;
      c.path.push({ year: this.step.slide.title, kind: 'event', text: 'Héritage de 20 000 €' });
      this.flash(c, '🏰 Héritage : tu reçois 20 000 €');
      this.pop(c, '🏰 +20 000 €', 'good');
      this.push(`🏰 Héritage : ${this.nameOf(c)} reçoit 20 000 € (${CLASS_LABELS[c.origin].toLowerCase()})`, 'admin');
    } else if (eventId === 'merite') {
      const best = this.list.filter((c) => c.origin === 'populaire').sort((a, b) => b.grade - a.grade)[0];
      if (!best) return 'Aucun joueur de classe populaire';
      best.budget += 3_000;
      best.path.push({ year: this.step.slide.title, kind: 'event', text: 'Bourse au mérite' });
      this.flash(best, '🏅 Bourse au mérite : tu reçois 3 000 €');
      this.pop(best, '🏅 +3 000 €', 'good');
      this.push(`🏅 Bourse au mérite : ${this.nameOf(best)} (${fmtGrade(best.grade)}/20) reçoit 3 000 €`, 'admin');
    } else if (eventId === 'greve') {
      // Grève générale pour les salaires : salariés et fonctionnaires, hors cadres et chefs d'entreprise
      const workers = this.list.filter((c) => c.job && !['cadre', 'chef', 'chomage', 'fonction_a'].includes(c.job));
      if (!workers.length) return 'Personne n’est salarié pour l’instant (à déclencher dans la vie active)';
      const won = this.roll(0.5);
      for (const c of workers) {
        c.budget += won ? 1_000 : -400;
        c.path.push({ year: this.step.slide.title, kind: 'event', text: won ? 'Grève générale : hausse obtenue' : 'Grève générale : salaire perdu' });
        this.flash(c, won ? '✊ Grève générale : hausse de salaire obtenue (+1 000 €)' : '✊ Grève générale : 4 jours sans salaire, rien d’obtenu (−400 €)');
      }
      this.push(`✊ Grève générale : ${workers.length} salarié·e·s, ${won ? 'hausse de salaire obtenue (+1 000 €)' : 'rien d’obtenu (−400 €)'}`, 'admin');
    } else if (eventId === 'distance') {
      const hit: Record<SocialClass, number> = { populaire: -0.5, moyenne: -0.2, superieure: -0.1 };
      for (const c of this.list) {
        c.grade = clamp(Math.round((c.grade + hit[c.origin]) * 10) / 10, 0, 20);
        this.flash(c, `😷 Cours à distance : ${fmtGrade(Math.abs(hit[c.origin]))} point${Math.abs(hit[c.origin]) >= 1 ? 's' : ''} de moyenne en moins`);
      }
      this.push('😷 Cours à distance : populaire −0,5, moyenne −0,2, supérieure −0,1', 'admin');
    } else if (eventId === 'prof') {
      const hit = (c: Character) => (c.school === 'quartier' ? -0.4 : c.school === 'centre' ? -0.1 : 0);
      const touched = this.list.filter((c) => hit(c) < 0);
      if (!touched.length) return 'Personne en lycée public pour l’instant';
      for (const c of touched) {
        c.grade = clamp(Math.round((c.grade + hit(c)) * 10) / 10, 0, 20);
        this.flash(c, `🏫 Prof non remplacé : ${fmtGrade(-hit(c))} de moyenne en moins`);
      }
      this.push(`🏫 Prof non remplacé : ${touched.length} élève(s) du public touché(s), le privé épargné`, 'admin');
    } else if (eventId === 'soutien') {
      const pop = this.list.filter((c) => c.origin === 'populaire');
      if (!pop.length) return 'Aucun joueur de classe populaire';
      for (const c of pop) {
        c.grade = clamp(Math.round((c.grade + 0.3) * 10) / 10, 0, 20);
        c.energy = clamp(Math.round((c.energy + 0.3) * 10) / 10, 0, 5);
        this.flash(c, '📚 Soutien scolaire gratuit : +0,3 de moyenne');
      }
      this.push(`📚 Soutien scolaire gratuit : ${pop.length} joueur(s) de classe populaire +0,3`, 'admin');
    } else if (eventId === 'bourses') {
      const b = this.list.filter((c) => c.boursier);
      if (!b.length) return 'Aucun boursier pour l’instant (après Parcoursup)';
      for (const c of b) {
        c.budget += 1_500;
        this.flash(c, '🎓 Bourses revalorisées : +1 500 €');
      }
      this.push(`🎓 Bourses revalorisées : ${b.length} boursier(s) +1 500 €`, 'admin');
    } else if (eventId === 'reseau') {
      const add: Record<SocialClass, number> = { populaire: 0, moyenne: 1, superieure: 2 };
      for (const c of this.list) {
        c.contacts += add[c.origin];
        if (add[c.origin]) this.flash(c, `🥂 Soirée chez des amis de tes parents : +${add[c.origin]} contact${add[c.origin] > 1 ? 's' : ''}`);
      }
      this.push('🥂 Soirée réseau : supérieure +2 contacts, moyenne +1, populaire pas invitée', 'admin');
    } else if (eventId === 'loyers') {
      const t = this.list.filter((c) => !c.homeOwner && c.housing !== 'parents');
      if (!t.length) return 'Personne ne loue de logement pour l’instant';
      for (const c of t) {
        c.budget -= 800;
        this.flash(c, '🏠 Hausse des loyers : −800 €');
      }
      this.push(`🏠 Hausse des loyers : ${t.length} locataire(s) −800 €`, 'admin');
    } else if (eventId === 'inflation') {
      for (const c of this.list) {
        const loss = Math.max(300, Math.round(Math.max(0, c.budget) * 0.08));
        c.budget -= loss;
        this.flash(c, `🛒 Inflation : −${fmtMoney(loss)}`);
      }
      this.push('🛒 Inflation : −8 % de l’épargne (au moins −300 €)', 'admin');
    } else if (eventId === 'accident') {
      const c = this.list[Math.floor(this.rnd() * this.list.length)]!;
      const cushioned = c.budget >= 10_000;
      c.budget -= 3_000;
      c.energy = clamp(Math.round((c.energy - (cushioned ? 0.3 : 1)) * 10) / 10, 0, 5);
      c.path.push({ year: this.step.slide.title, kind: 'event', text: 'Accident de la vie' });
      this.flash(c, cushioned ? '🚑 Accident : −3 000 €, mais l’épargne amortit le choc' : '🚑 Accident : −3 000 € et −1 énergie');
      this.pop(c, '🚑 −3 000 €', 'bad');
      this.push(`🚑 Accident de la vie : ${this.nameOf(c)} (${CLASS_LABELS[c.origin].toLowerCase()})${cushioned ? ', amorti par l’épargne' : ''}`, 'admin');
    } else if (eventId === 'prime') {
      const workers = this.list.filter((c) => c.job && c.job !== 'chomage');
      if (!workers.length) return 'Personne ne travaille pour l’instant (à déclencher dans la vie active)';
      for (const c of workers) {
        const amount = c.job === 'cadre' || c.job === 'chef' ? 2_500 : 800;
        c.budget += amount;
        this.flash(c, `🎁 Prime de fin d’année : +${fmtMoney(amount)}`);
      }
      this.push(`🎁 Prime de fin d’année : ${workers.length} salarié·e·s (cadres +2 500 €, autres +800 €)`, 'admin');
    } else if (eventId === 'loto') {
      const c = this.list[Math.floor(this.rnd() * this.list.length)]!;
      c.budget += 10_000;
      c.path.push({ year: this.step.slide.title, kind: 'event', text: 'Coup de chance : 10 000 €' });
      this.flash(c, '🍀 Coup de chance : tu gagnes 10 000 €');
      this.pop(c, '🍀 +10 000 €', 'good');
      this.push(`🍀 Coup de chance : ${this.nameOf(c)} (${CLASS_LABELS[c.origin].toLowerCase()}) gagne 10 000 €`, 'admin');
    } else return 'Événement inconnu';
    this.changed();
    return null;
  }

  /** Régie : modifie à la main un paramètre d'un personnage (démonstration en direct) */
  edit(characterId: string, patch: PlayerPatch): string | null {
    if (!this.drawn) return 'Les familles ne sont pas encore tirées';
    const c = this.list.find((x) => x.id === characterId || x.members.includes(characterId));
    if (!c) return 'Joueur introuvable';
    const changes: string[] = [];
    if (patch.budget !== undefined) {
      changes.push(`argent ${fmtMoney(Math.round(c.budget))} → ${fmtMoney(patch.budget)}`);
      c.budget = patch.budget;
    }
    if (patch.grade !== undefined) {
      changes.push(`moyenne ${fmtGrade(c.grade)} → ${fmtGrade(patch.grade)}`);
      c.grade = patch.grade;
      c.bacGrade = c.bac ? c.bacGrade : patch.grade;
    }
    if (patch.contacts !== undefined) {
      changes.push(`contacts ${c.contacts} → ${patch.contacts}`);
      c.contacts = patch.contacts;
    }
    if (patch.energy !== undefined) {
      changes.push(`énergie ${fmtGrade(c.energy)} → ${fmtGrade(patch.energy)}`);
      c.energy = patch.energy;
    }
    if (patch.engagement !== undefined) {
      changes.push(`engagement ${c.engagement} → ${patch.engagement}`);
      c.engagement = patch.engagement;
    }
    for (const key of ['boursier', 'info', 'cordees', 'homeOwner'] as const) {
      if (patch[key] !== undefined && patch[key] !== c[key]) {
        changes.push(`${EDIT_LABELS[key]} : ${patch[key] ? 'oui' : 'non'}`);
        c[key] = patch[key]!;
      }
    }
    if (patch.school !== undefined && patch.school !== c.school) {
      changes.push(`lycée : ${SCHOOLS[patch.school].name}`);
      c.school = patch.school;
    }
    if (!changes.length) return 'Rien à modifier';
    this.flash(c, '✏️ La régie a modifié ta situation');
    this.push(`✏️ ${this.nameOf(c)} : ${changes.join(', ')}`, 'admin');
    this.changed();
    return null;
  }

  showCard(cardId: string | null): string | null {
    if (cardId === null) this.card = null;
    else {
      const card = this.cards.find((c) => c.id === cardId);
      if (!card) return 'Carte inconnue';
      this.card = this.card?.id === cardId ? null : card;
    }
    this.hooks.live();
    return null;
  }

  // ================================================================= Vues

  playerView(playerId: string): PlayerGameView {
    const step = this.step;
    const cid = this.charOf.get(playerId);
    const c = cid ? this.chars.get(cid) : undefined;
    const now = Date.now();
    const flash = c ? this.flashes.get(c.id) : undefined;
    const view: PlayerGameView = {
      step: { id: step.id, kind: step.kind, index: this.cursor, total: this.deck.length, title: step.slide.title, replay: this.replay },
      timer: this.timerView(),
      poll: null,
      vote: null,
      character: c && this.drawn ? this.characterView(c, playerId) : null,
      year: null,
      parcoursup: null,
      jobs: null,
      outcome: null,
      final: null,
      flash: flash && flash.until > now ? { id: flash.id, text: flash.text } : null,
    };
    if (this.replay) return view;

    if (step.kind === 'poll') {
      const qs = POLLS[step.ref!]!;
      view.poll = { id: step.ref!, questions: qs, answers: this.polls.get(step.ref!)?.get(playerId) ?? qs.map(() => null), open: this.pollOpen.has(step.ref!) };
    }
    if (step.kind === 'vote') {
      view.vote = { options: REFORMS.map((r) => ({ ...r })), myVote: this.votes.get(playerId) ?? null, open: !this.reform, winner: this.revealed.has(step.id) ? this.reform : null };
    }
    if (!c) return view;

    if (step.kind === 'year') view.year = this.yearView(c, yearById(step.ref!)!);
    if (step.kind === 'bac' && this.revealed.has(step.id)) view.outcome = this.bacOutcome.get(c.id) ?? null;
    if (step.kind === 'diploma' && this.revealed.has(step.id)) view.outcome = this.diplomaOutcome.get(c.id) ?? null;
    if (step.kind === 'parcoursup' || step.kind === 'parcoursupResults' || step.kind === 'parcoursupFinal') view.parcoursup = this.psView(c, step.kind);
    if (step.kind === 'jobs') view.jobs = this.jobsView(c);
    if (step.kind === 'final' && this.finalRevealed >= 3) {
      const ranking = this.ranking();
      const rank = ranking.findIndex((r) => r.c.id === c.id) + 1;
      const f = this.finals.get(c.id)!;
      const move = moveOf(c.origin, f.cls);
      view.final = {
        rank,
        total: ranking.length,
        origin: c.origin,
        cls: f.cls,
        ascending: f.ascending,
        job: JOB_LABEL[c.job ?? 'chomage'],
        diploma: DIPLOMA_LABEL[c.diploma ?? 'aucun'],
        budget: Math.round(c.budget),
        text:
          move > 0
            ? `Tu es parti·e de la ${CLASS_LABELS[c.origin].toLowerCase()} et tu as monté. C’est possible, mais c’était plus dur pour toi.`
            : move < 0
              ? `Né·e en ${CLASS_LABELS[c.origin].toLowerCase()}, tu as descendu : un coup dur suffit.`
              : f.ascending
                ? 'Tu es en train de monter ⭐ : encore quelques années à ce poste pour changer de classe.'
                : `Tu restes dans la ${CLASS_LABELS[c.origin].toLowerCase()}, comme la plupart des joueurs.`,
      };
    }
    return view;
  }

  private timerView() {
    return { endsAt: this.replay ? null : this.endsAt, paused: this.paused, remaining: this.replay ? null : this.remaining };
  }

  private characterView(c: Character, playerId: string): CharacterView {
    const partnerId = c.members.find((m) => m !== playerId);
    const yearLabel = this.step.kind === 'year' ? yearById(this.step.ref!)!.label : null;
    const forced = c.origin === 'populaire' ? '1 jeton par an au lycée pour aider à la maison' : null;
    return {
      origin: c.origin,
      partner: partnerId ? (this.getMembers().get(partnerId)?.displayName ?? null) : null,
      school: { name: SCHOOLS[c.school].name, reputation: SCHOOLS[c.school].reputation },
      status: statusOf(c, yearLabel),
      stats: { grade: c.grade, contacts: c.contacts, energy: c.energy, budget: Math.round(c.budget), engagement: c.engagement },
      family: {
        parents: FAMILY_LABEL[c.origin],
        grade: c.grades[0] !== undefined ? round1(c.grade) : c.grade,
        contacts: c.contacts,
        budget: Math.round(c.budget),
        school: SCHOOLS[c.school].name,
        informed: c.info,
        help: HOME_HELP[c.origin],
        support: FAMILY_SUPPORT[c.origin],
        gift: FAMILY_GIFT[c.origin],
        forced,
      },
      boursier: c.boursier,
      diploma: c.diploma ? DIPLOMA_LABEL[c.diploma] : null,
      job: c.job ? JOB_LABEL[c.job] : null,
      trend: trendOf(c),
      path: c.path,
    };
  }

  private yearView(c: Character, year: YearDef): YearView {
    const ctx = this.ctx(year);
    const open = !this.closed.has(this.step.id);
    return {
      id: year.id,
      label: year.label,
      stage: year.stage,
      number: YEARS.indexOf(year) + 1,
      totalTokens: TOTAL_TOKENS,
      forced: this.forcedOf(c),
      categories: categoriesFor(year.stage),
      tokens: c.tokens,
      decision: {
        id: year.decision.id,
        emoji: year.decision.emoji,
        title: year.decision.title,
        text: year.decision.text,
        choice: c.choice,
        options: this.optionsFor(c, year).map((o) => ({ id: o.id, emoji: o.emoji, label: o.label, hint: costHint(c, o, year.stage), locked: lockReason(c, o, ctx) })),
      },
      mini: miniView(c, year),
      phase: open ? 'open' : 'report',
      submitted: c.done,
      report: open ? null : c.report,
    };
  }

  private psView(c: Character, kind: 'parcoursup' | 'parcoursupResults' | 'parcoursupFinal') {
    const cap = capacities(this.list.length);
    const vis = FORMATION_IDS.filter((f) => visible(c, f, this.reform));
    const results = (this.ps?.results.get(c.id) ?? []).map((r) => ({ formation: r.formation, label: FORMATIONS[r.formation].label, emoji: FORMATIONS[r.formation].emoji, status: r.status, rank: r.rank }));
    const f = this.psFinal?.get(c.id);
    return {
      phase: kind === 'parcoursup' ? ('wishes' as const) : kind === 'parcoursupResults' ? ('results' as const) : ('final' as const),
      eligible: this.eligiblePs(c),
      formations: vis.map((id) => {
        const fo = FORMATIONS[id];
        return { id, label: fo.label, emoji: fo.emoji, hint: fo.hint, selective: fo.selective, capacity: cap[id], cost: fo.cost > 0 ? familyShare(c, fo.cost) : fo.cost, locked: eligibility(c, id) };
      }),
      hidden: FORMATION_IDS.length - vis.length,
      canAskBourse: c.origin !== 'superieure',
      wishes: this.wishes.get(c.id) ?? [],
      bourse: c.stats.askedBourse,
      submitted: this.wishesDone.has(c.id),
      results,
      response: this.accepted.get(c.id) ?? (this.responded.has(c.id) ? 'wait' : null),
      final:
        kind === 'parcoursupFinal' && f
          ? { formation: f === 'vie_active' ? null : f, label: f === 'vie_active' ? 'Vie active' : FORMATIONS[f].label, emoji: f === 'vie_active' ? '🧰' : FORMATIONS[f].emoji, text: this.psFinalText.get(c.id) ?? '' }
          : null,
    };
  }

  private jobsView(c: Character) {
    const out = this.jobOutcome?.get(c.id);
    return {
      phase: this.jobOutcome ? ('result' as const) : ('aim' as const),
      options: STRATEGIES.map((s) => ({ id: s.id, emoji: s.emoji, label: s.label, hint: s.hint, locked: strategyLock(c, s.id) })),
      choice: this.strategies.get(c.id) ?? null,
      employability: Math.round(clamp(employability(c, this.config.addressEffect), 0, 1) * 100),
      result: out && c.job ? { job: c.job, label: JOB_LABEL[c.job], text: out.text, tone: out.tone } : null,
    };
  }

  // ---------------------------------------------------------------- Écran projeté

  screenPlayers(): ScreenPlayer[] {
    const members = this.getMembers();
    const now = Date.now();
    const step = this.step;
    return this.list.map((c) => {
      const m = c.members.map((id) => members.get(id)).filter(Boolean) as GameMember[];
      const pop = this.pops.get(c.id);
      return {
        id: c.id,
        displayName: m.map((x) => x.displayName).join(' & ') || '?',
        avatar: m[0]?.avatar ?? '🙂',
        color: m[0]?.color ?? 'violet',
        connected: m.some((x) => x.connected),
        origin: c.origin,
        done:
          step.kind === 'year'
            ? c.done
            : step.kind === 'parcoursup'
              ? this.wishesDone.has(c.id)
              : step.kind === 'parcoursupResults'
                ? this.responded.has(c.id)
                : step.kind === 'jobs'
                  ? this.jobsDone.has(c.id) || !!this.jobOutcome
                  : false,
        grade: c.grade,
        status: statusOf(c, step.kind === 'year' ? yearById(step.ref!)!.label : null),
        trend: trendOf(c),
        pop: pop && pop.until > now ? { id: pop.id, text: pop.text, tone: pop.tone } : null,
      };
    });
  }

  screenStep(): ScreenStep {
    const step = this.step;
    const list = this.list;
    const lectureId = this.lecture.has(step.id) ? this.lectureReady() : null;
    if (lectureId) {
      const d = this.debrief(lectureId);
      if (d) return { kind: 'debrief', debrief: d };
    }
    const byOrigin = (f: (c: Character) => number, mode: 'pct' | 'avg' = 'pct') =>
      Object.fromEntries(
        SOCIAL_CLASSES.map((s) => {
          const l = list.filter((c) => c.origin === s);
          const v = l.length ? l.reduce((sum, c) => sum + f(c), 0) / l.length : 0;
          return [s, mode === 'pct' ? Math.round(v * 100) : round1(v)];
        }),
      ) as Record<SocialClass, number>;

    switch (step.kind) {
      case 'slide':
        return { kind: 'slide', slide: step.slide };
      case 'poll': {
        const qs = POLLS[step.ref!]!;
        const answers = [...(this.polls.get(step.ref!)?.values() ?? [])];
        const show = this.revealed.has(step.id) || this.replay;
        return {
          kind: 'poll',
          open: this.pollOpen.has(step.ref!),
          answered: answers.filter((a) => a.some((x) => x !== null)).length,
          total: this.getMembers().size,
          questions: qs.map((q, i) => ({ question: q.question, options: q.options, counts: show ? q.options.map((_, k) => answers.filter((a) => a[i] === k).length) : null })),
        };
      }
      case 'pollCompare': {
        const count = (ref: string, i: number, n: number) => {
          const answers = [...(this.polls.get(ref)?.values() ?? [])];
          return Array.from({ length: n }, (_, k) => answers.filter((a) => a[i] === k).length);
        };
        return {
          kind: 'pollCompare',
          items: COMPARED_QUESTIONS.map((i) => {
            const q = POLLS.entree![i]!;
            return { question: q.question, options: q.options, before: count('entree', i, q.options.length), after: count('sortie', i, q.options.length) };
          }),
        };
      }
      case 'draw': {
        const counts = { populaire: 0, moyenne: 0, superieure: 0 };
        for (const c of list) counts[c.origin]++;
        return {
          kind: 'draw',
          counts,
          families: SOCIAL_CLASSES.map((s) => ({
            cls: s,
            parents: FAMILY_LABEL[s].split(' : ')[0]!,
            grade: s === 'populaire' ? '10,6' : s === 'moyenne' ? '11,4' : '12,2',
            budget: fmtMoney(s === 'populaire' ? 100 : s === 'moyenne' ? 400 : 1_500),
            contacts: s === 'populaire' ? 1 : s === 'moyenne' ? 3 : 5,
          })),
        };
      }
      case 'year': {
        const year = yearById(step.ref!)!;
        const open = !this.closed.has(step.id);
        const counts = this.yearChoices.get(year.id);
        return {
          kind: 'year',
          label: year.label,
          stage: year.stage,
          number: YEARS.indexOf(year) + 1,
          phase: open ? 'open' : 'report',
          done: list.filter((c) => c.done).length,
          total: list.length,
          mini: MINI_TITLES[year.id] ?? null,
          informed: year.id === 'terminale' || year.id === 'premiere' ? list.filter((c) => c.info).length : null,
          choices: counts
            ? year.decision.options.filter((o) => counts.get(o.id)).map((o) => ({ label: o.label, emoji: o.emoji, count: counts.get(o.id)! }))
            : null,
          averages: byOrigin((c) => c.grade, 'avg'),
        };
      }
      case 'bac': {
        const revealed = this.revealed.has(step.id) || this.replay;
        const tally = new Map<string, number>();
        for (const c of list) {
          const label = !c.bac || c.bac === 'aucun' ? 'Recalé·e' : c.bac === 'pro' ? 'Bac pro' : c.mention ? `Mention ${c.mention}` : 'Admis·e';
          tally.set(label, (tally.get(label) ?? 0) + 1);
        }
        const order = ['Mention Très bien', 'Mention Bien', 'Mention Assez bien', 'Admis·e', 'Bac pro', 'Recalé·e'];
        return {
          kind: 'bac',
          revealed,
          results: order.filter((l) => tally.get(l)).map((label) => ({ label, count: tally.get(label)! })),
          successByOrigin: byOrigin((c) => (c.bac && c.bac !== 'aucun' ? 1 : 0)),
          mentionByOrigin: byOrigin((c) => (c.mention ? 1 : 0)),
          averageByOrigin: byOrigin((c) => c.bacGrade, 'avg'),
        };
      }
      case 'vote': {
        const show = this.revealed.has(step.id) || this.replay;
        const votes = [...this.votes.values()];
        return {
          kind: 'vote',
          options: REFORMS.map((r) => ({ ...r })),
          counts: show ? REFORMS.map((r) => votes.filter((v) => v === r.id).length) : null,
          winner: show ? this.reform : null,
          answered: votes.length,
          total: this.getMembers().size,
        };
      }
      case 'parcoursup': {
        const cap = capacities(list.length);
        return {
          kind: 'parcoursup',
          done: list.filter((c) => this.wishesDone.has(c.id)).length,
          total: list.length,
          bourses: list.filter((c) => c.stats.askedBourse).length,
          hiddenPrepa: list.filter((c) => c.stats.hiddenSelective).length,
          formations: FORMATION_IDS.map((id) => ({ id, label: FORMATIONS[id].label, emoji: FORMATIONS[id].emoji, capacity: cap[id], demand: list.filter((c) => this.wishes.get(c.id)?.includes(id)).length })),
        };
      }
      case 'parcoursupResults': {
        const cap = capacities(list.length);
        const all = [...(this.ps?.results.values() ?? [])].flat();
        return {
          kind: 'parcoursupResults',
          revealed: this.revealed.has(step.id) || this.replay,
          done: list.filter((c) => this.responded.has(c.id)).length,
          total: list.length,
          formations: FORMATION_IDS.map((id) => ({
            id,
            label: FORMATIONS[id].label,
            emoji: FORMATIONS[id].emoji,
            capacity: cap[id],
            admis: all.filter((r) => r.formation === id && r.status === 'admis').length,
            attente: all.filter((r) => r.formation === id && r.status === 'attente').length,
            refuse: all.filter((r) => r.formation === id && r.status === 'refuse').length,
          })),
        };
      }
      case 'parcoursupFinal': {
        const cap = capacities(list.length);
        const fin = this.psFinal ?? new Map();
        return {
          kind: 'parcoursupFinal',
          formations: FORMATION_IDS.map((id) => ({ id, label: FORMATIONS[id].label, emoji: FORMATIONS[id].emoji, capacity: cap[id], selective: id === 'prepa' || id === 'prepa_privee' || id === 'iep' || id === 'ecole', players: list.filter((c) => fin.get(c.id) === id).map((c) => c.id) })),
          vieActive: list.filter((c) => fin.get(c.id) === 'vie_active').map((c) => c.id),
          selectiveByOrigin: byOrigin((c) => (c.formation === 'prepa' || c.formation === 'prepa_privee' || c.formation === 'iep' || c.formation === 'ecole' ? 1 : 0)),
        };
      }
      case 'diploma': {
        const tally = new Map<string, number>();
        for (const c of list) tally.set(DIPLOMA_LABEL[c.diploma ?? 'aucun'], (tally.get(DIPLOMA_LABEL[c.diploma ?? 'aucun']) ?? 0) + 1);
        const order = ['grande_ecole', 'master', 'ecole', 'licence', 'but', 'bts', 'bac', 'aucun'] as const;
        return {
          kind: 'diploma',
          revealed: this.revealed.has(step.id) || this.replay,
          results: order.map((d) => DIPLOMA_LABEL[d]).filter((l) => tally.get(l)).map((label) => ({ label, count: tally.get(label)! })),
          bac5ByOrigin: byOrigin((c) => (DIPLOMA_LEVEL[c.diploma ?? 'aucun'] >= 5 ? 1 : 0)),
          levelByOrigin: byOrigin((c) => DIPLOMA_LEVEL[c.diploma ?? 'aucun'], 'avg'),
        };
      }
      case 'jobs': {
        const n = list.length;
        return {
          kind: 'jobs',
          phase: this.jobOutcome ? 'result' : 'aim',
          revealed: this.revealed.has(step.id) || this.replay,
          done: list.filter((c) => this.jobsDone.has(c.id)).length,
          total: n,
          tiers: TIERS.map((t) => ({
            id: t.id,
            label: t.label,
            cls: t.id === 'chomage' || t.id === 'ouvrier' || t.id === 'employe' || t.id === 'fonction_c' ? ('populaire' as const) : t.id === 'intermediaire' || t.id === 'fonction_b' ? ('moyenne' as const) : ('superieure' as const),
            seats: t.share === null ? null : Math.max(1, Math.round(t.share * n)),
            players: this.jobOutcome ? list.filter((c) => c.job === t.id).map((c) => c.id) : [],
          })),
        };
      }
      case 'final': {
        const ranking = this.ranking();
        const pyramid: Record<SocialClass, string[]> = { populaire: [], moyenne: [], superieure: [] };
        const matrix = Object.fromEntries(SOCIAL_CLASSES.map((o) => [o, { populaire: 0, moyenne: 0, superieure: 0 }])) as Record<SocialClass, Record<SocialClass, number>>;
        let climbed = 0;
        let fell = 0;
        for (const { c, f } of ranking) {
          pyramid[f.cls].push(c.id);
          matrix[c.origin][f.cls]++;
          const m = moveOf(c.origin, f.cls);
          if (m > 0) climbed++;
          else if (m < 0) fell++;
        }
        const stayed = ranking.length - climbed - fell;
        const popUp = ranking.filter((r) => r.c.origin === 'populaire' && moveOf('populaire', r.f.cls) > 0).length;
        const popTotal = ranking.filter((r) => r.c.origin === 'populaire').length;
        const supStay = ranking.filter((r) => r.c.origin === 'superieure' && r.f.cls === 'superieure').length;
        const supTotal = ranking.filter((r) => r.c.origin === 'superieure').length;
        return {
          kind: 'final',
          final: {
            pyramid,
            matrix,
            podium: ranking.slice(0, 3).map((r) => r.c.id),
            ascending: ranking.filter((r) => r.f.ascending).map((r) => r.c.id),
            climbed,
            fell,
            stayed,
            revealed: this.replay ? 4 : this.finalRevealed,
            takeaways: [
              `${stayed} joueur${stayed > 1 ? 's' : ''} sur ${ranking.length} ${stayed > 1 ? 'sont restés' : 'est resté'} dans leur classe de départ.`,
              popTotal ? `${popUp} joueur${popUp > 1 ? 's' : ''} populaire${popUp > 1 ? 's' : ''} sur ${popTotal} ${popUp > 1 ? 'ont' : 'a'} monté.` : '',
              supTotal ? `${supStay} joueur${supStay > 1 ? 's' : ''} supérieur${supStay > 1 ? 's' : ''} sur ${supTotal} ${supStay > 1 ? 'sont restés' : 'est resté'} en haut.` : '',
            ].filter(Boolean),
          },
        };
      }
      case 'stats':
        return { kind: 'stats', lines: statLines(list, this.finals.size ? this.finals : new Map(list.map((c) => [c.id, finalClass(c)]))) };
      case 'debrief': {
        const debrief = this.debrief(step.ref!);
        return debrief ? { kind: 'debrief', debrief } : { kind: 'slide', slide: step.slide };
      }
    }
  }

  screenFeed() {
    return this.feed.slice(0, 8);
  }

  screenCard() {
    return this.card;
  }

  timer() {
    return this.timerView();
  }

  controlView(): Omit<ControlView, 'config' | 'roles' | 'pairs'> {
    const step = this.step;
    const members = this.getMembers();
    return {
      deck: this.deck.map((s, i) => ({ id: s.id, kind: s.kind, title: s.slide.title, enabled: s.enabled, who: s.who, plan: s.plan, played: i <= this.furthest })),
      cursor: this.cursor,
      furthest: this.furthest,
      startedAt: this.startedAt,
      notes: step.kind === 'debrief' ? this.debriefNotes(step.ref!) : this.lecture.has(step.id) && this.lectureReady() ? this.debriefNotes(this.lectureReady()!) : step.slide.notes,
      revealLabel: this.revealLabel(),
      lecture: !!this.lectureReady(),
      canClose: this.canClose(),
      canReveal: this.canReveal(),
      cards: this.cards,
      stepCards: step.cards,
      shownCard: this.card?.id ?? null,
      characters: this.list.map((c) => ({
        id: c.id,
        members: c.members.map((m) => members.get(m)?.displayName ?? '?'),
        origin: c.origin,
        grade: c.grade,
        contacts: c.contacts,
        energy: c.energy,
        budget: Math.round(c.budget),
        status: statusOf(c, step.kind === 'year' ? yearById(step.ref!)!.label : null),
        done: this.screenPlayers().find((p) => p.id === c.id)?.done ?? false,
        school: SCHOOLS[c.school].name,
        schoolId: c.school,
        boursier: c.boursier,
        diploma: c.diploma ? DIPLOMA_LABEL[c.diploma] : null,
        info: c.info,
        cordees: c.cordees,
        homeOwner: c.homeOwner,
        engagement: c.engagement,
        formation: c.formation ? (c.formation === 'vie_active' ? 'Vie active' : FORMATIONS[c.formation].label) : null,
        job: c.job ? JOB_LABEL[c.job] : null,
        bac: c.bac ? (c.mention ? `${c.bac} · ${c.mention}` : c.bac) : null,
      })),
      events: COLLECTIVE_EVENTS,
      reform: this.reform ? (REFORMS.find((r) => r.id === this.reform)?.label ?? null) : null,
    };
  }

  private debrief(id: string) {
    const list = this.list;
    const finals = this.finals.size ? this.finals : new Map(list.map((c) => [c.id, finalClass(c)]));
    const reform = this.reform ? (REFORMS.find((r) => r.id === this.reform)?.label ?? null) : null;
    return buildDebrief(id, { chars: list, finals, reform });
  }

  /** Notes de l'orateur d'une lecture : conseils + interprétation calculée */
  private debriefNotes(id: string): string {
    const d = this.debrief(id);
    if (!d) return '';
    return [d.notes, ...d.interpretation.map((t) => `• ${t}`), `Conclusion : « ${d.verdict} »`].join('\n');
  }

  /** Chiffres de la partie, pour le dossier écrit */
  exportData(info: { name: string; code: string }): GameExport {
    const members = this.getMembers();
    const finals = this.finals.size ? this.finals : new Map(this.list.map((c) => [c.id, finalClass(c)]));
    return {
      name: info.name,
      code: info.code,
      date: new Date(this.startedAt).toISOString(),
      players: this.list.length,
      reform: this.reform ? (REFORMS.find((r) => r.id === this.reform)?.label ?? null) : null,
      stats: statLines(this.list, finals),
      rows: this.list.map((c) => ({
        joueur: c.members.map((m) => members.get(m)?.displayName ?? '?').join(' & '),
        origine: CLASS_LABELS[c.origin],
        lycee: SCHOOLS[c.school].name,
        specialites: c.specialty ?? '',
        bac: c.bac ?? '',
        mention: c.mention ?? '',
        boursier: c.boursier ? 'oui' : 'non',
        formation: c.formation ? (c.formation === 'vie_active' ? 'Vie active' : FORMATIONS[c.formation].label) : '',
        diplome: c.diploma ? DIPLOMA_LABEL[c.diploma] : '',
        emploi: c.job ? JOB_LABEL[c.job] : '',
        classe_finale: CLASS_LABELS[finals.get(c.id)?.cls ?? c.origin],
        patrimoine: Math.round(c.budget),
        moyenne: c.grade,
        contacts: c.contacts,
        jetons_job_imposes: c.stats.forcedJobs,
        a_vu_la_prepa: c.stats.hiddenSelective ? 'non' : 'oui',
      })),
    };
  }

  // ================================================================= Utilitaires

  private nameOf(c: Character) {
    const members = this.getMembers();
    return c.members.map((m) => members.get(m)?.displayName ?? '?').join(' & ');
  }

  private push(text: string, tone: Tone | 'admin') {
    this.feed.unshift({ id: randomUUID(), text, tone });
    if (this.feed.length > 40) this.feed.length = 40;
  }

  private highlight(c: Character, text: string, tone: Tone) {
    this.push(`${this.nameOf(c)} (${CLASS_LABELS[c.origin].replace('Classe ', '').toLowerCase()}) · ${text}`, tone);
    this.pop(c, text, tone);
  }

  private pop(c: Character, text: string, tone: Tone) {
    this.pops.set(c.id, { id: randomUUID(), text, tone, until: Date.now() + 9_000 });
  }

  private flash(c: Character, text: string) {
    this.flashes.set(c.id, { id: randomUUID(), text, until: Date.now() + 8_000 });
  }

  private feedBac() {
    for (const c of this.list) {
      if (c.origin === 'populaire' && c.mention) this.highlight(c, `bac mention ${c.mention}`, 'good');
      if (c.bac === 'aucun') this.highlight(c, 'recalé·e au bac', 'bad');
    }
  }

  private changed(ids?: string[]) {
    this.hooks.players(ids);
    this.hooks.live();
  }

  /** Reconnexion / changement d'apparence : rafraîchir tout le monde */
  touch() {
    this.changed();
  }

  isGameStep(i: number) {
    return GAME_KINDS.has(this.deck[i]!.kind);
  }

  /** Le joueur a-t-il un personnage ? (dossier) */
  dossierOf(playerId: string) {
    const c = this.chars.get(this.charOf.get(playerId) ?? '');
    return c ? Object.fromEntries(FORMATION_IDS.map((f) => [f, round1(dossier(c, f, this.reform) * 20)])) : null;
  }
}

// ================================================================= Aides

function defaultTokens(year: YearDef, free: number): Record<string, number> {
  const t: Record<string, number> =
    year.stage === 'travail' ? { travail: 3, reseau: 1, repos: 1 } : { etudes: 3, amis: 1, repos: 1 };
  let sum = Object.values(t).reduce((s, v) => s + v, 0);
  // Ajuste au nombre de jetons libres
  const order = year.stage === 'travail' ? ['travail', 'reseau', 'repos'] : ['etudes', 'amis', 'repos'];
  while (sum > free) {
    const k = [...order].reverse().find((x) => (t[x] ?? 0) > 0)!;
    t[k]!--;
    sum--;
  }
  t.repos = (t.repos ?? 0) + (free - sum);
  for (const k of Object.keys(t)) if (!t[k]) delete t[k];
  return t;
}

function appreciation(c: Character, before: number, year: YearDef): string {
  const d = c.grade - before;
  if (year.stage === 'travail') {
    if (c.job === 'chomage') return 'Une année difficile, à chercher du travail.';
    if (c.energy < 1.5) return 'Tu as tout donné, mais tu es épuisé·e.';
    return c.budget >= 20_000 ? 'Ta situation se consolide.' : 'Tu tiens ta place.';
  }
  if (d >= 0.4) return 'Excellents progrès, continue ainsi.';
  if (d >= 0.1) return 'Des progrès réguliers.';
  if (d > -0.2) return 'Résultats stables. Peut mieux faire.';
  if (c.energy < 1.5) return 'La fatigue se ressent dans les résultats.';
  return 'Des difficultés cette année. Attention.';
}

export { ORDER };
