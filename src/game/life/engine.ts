import { randomUUID } from 'node:crypto';
import {
  CLASS_LABELS,
  DISTRIBUTIONS,
  SCENES,
  SOCIAL_CLASSES,
  STAGES,
  STAGE_LABELS,
  type ActionView,
  type BoardView,
  type Capitals,
  type ControlView,
  type FeedItem,
  type FinalView,
  type GameConfig,
  type GameControl,
  type GameStep,
  type OptionView,
  type PlayerGameView,
  type ResultView,
  type SituationView,
  type SocialClass,
  type Stage,
  type Tone,
} from '../protocol.js';
import { STAGE_ACTIONS } from './actions.js';
import { GAME_EVENTS, STAGE_CONTENT, STAGE_INTRO, bacMilestone, careerMilestone, diplomaMilestone, type Milestone } from './content.js';
import {
  FAMILY_SUPPORT,
  applyDelta,
  fmtMoney,
  newPlayer,
  sumCapitals,
  zeroCapitals,
  type Action,
  type Ctx,
  type LifePlayer,
  type Option,
  type Outcome,
  type Situation,
} from './model.js';
import { Scheduler } from './scheduler.js';

export interface LifeMember {
  id: string;
  displayName: string;
  avatar: string;
  color: string;
  connected: boolean;
}

export interface LifeOutput {
  /** La vue de ces joueurs a changé (undefined = tous) */
  players(ids?: string[]): void;
  /** L'écran projeté / la gestion doivent être rafraîchis */
  board(): void;
  /** Pyramide affichée : la partie est terminée */
  finished(): void;
}

export interface Timings {
  intro: number;
  milestone: number;
  /** Temps pour répondre au moment clé de l'étape (filière, Parcoursup, premier emploi) */
  opening: number;
  /** Temps pour répondre à un événement de vie */
  event: number;
  /** Écart entre deux événements de vie d'un même joueur */
  gapMin: number;
  gapMax: number;
}

export const DEFAULT_LIFE_TIMINGS: Timings = {
  intro: 9_000,
  milestone: 10_000,
  opening: 30_000,
  event: 20_000,
  gapMin: 25_000,
  gapMax: 45_000,
};

const CLASS_RANK: Record<SocialClass, number> = { basse: 0, moyenne: 1, riche: 2 };
const FEED_MAX = 40;
const RESULTS_MAX = 6;
const FLASH_MS = 8_000;
const POP_MS = 7_000;
/**
 * Poids des gains de savoir et de réseau des activités : on en enchaîne des dizaines par partie,
 * chacune ne doit faire avancer que d'un petit pas (les événements et moments clés restent décisifs).
 */
export const ACTIVITY_GAIN = 0.15;
/** Poids des gains de savoir et de réseau des événements de vie (une vingtaine par partie) */
export const EVENT_GAIN = 0.6;

interface Runtime {
  activity: { action: Action; startedAt: number; endsAt: number; paid: number } | null;
  event: { id: string; situation: Situation; endsAt: number | null; mandatory: boolean } | null;
  /** Événements de vie à venir pour cette étape (ordre propre à chaque joueur) */
  queue: Situation[];
  results: ResultView[];
  pop: { id: string; text: string; tone: Tone; at: number } | null;
  story: { title: string; text: string } | null;
  flash: { text: string; until: number } | null;
}

/**
 * Une partie : lycée -> université -> monde du travail, puis pyramide.
 * Pendant chaque étape, chacun joue librement : activités dans les lieux de la scène et événements de vie.
 * Le moteur ne connaît pas Socket.IO : il signale ses changements via LifeOutput.
 */
export class LifeGame {
  readonly players = new Map<string, LifePlayer>();
  private readonly rt = new Map<string, Runtime>();
  private readonly sched: Scheduler;
  private stageIdx = 0;
  private step: GameStep = 'intro';
  private stepEndsAt: number | null = null;
  private paused = false;
  private boardStory: { title: string; text: string } | null = null;
  private readonly feed: FeedItem[] = [];
  private final: FinalView | null = null;
  /** Noms connus (y compris des joueurs partis en cours de route) */
  private readonly names = new Map<string, LifeMember>();
  private readonly rnd: () => number;
  private readonly now: () => number;
  private readonly t: Timings;
  private readonly ctx: Ctx;

  constructor(
    members: LifeMember[],
    roles: Map<string, SocialClass | null>,
    readonly config: GameConfig,
    private readonly liveMembers: () => Map<string, LifeMember>,
    private readonly out: LifeOutput,
    deps: { rnd?: () => number; now?: () => number; timings?: Partial<Timings> } = {},
  ) {
    this.rnd = deps.rnd ?? Math.random;
    this.now = deps.now ?? Date.now;
    this.t = { ...DEFAULT_LIFE_TIMINGS, ...deps.timings };
    this.sched = new Scheduler(this.now);
    this.ctx = { rnd: this.rnd, roll: (prob) => this.rnd() < prob };

    const classes = assignClasses(
      members.map((m) => m.id),
      roles,
      config,
      this.rnd,
    );
    for (const m of members) {
      this.names.set(m.id, m);
      this.players.set(m.id, newPlayer(m.id, classes.get(m.id)!, this.rnd));
      this.rt.set(m.id, { activity: null, event: null, queue: [], results: [], pop: null, story: null, flash: null });
    }
  }

  get stage(): Stage {
    return STAGES[this.stageIdx]!;
  }
  get isFinished(): boolean {
    return this.step === 'final';
  }
  private get playMs(): number {
    return Math.max(30_000, this.config.stageMinutes * 60_000 - this.t.intro - this.t.milestone);
  }

  start(): void {
    const counts = { basse: 0, moyenne: 0, riche: 0 };
    for (const p of this.players.values()) counts[p.origin]++;
    this.push(
      `🎲 Tirage des classes : ${counts.basse} en classe basse, ${counts.moyenne} en classe moyenne, ${counts.riche} en classe riche`,
      'neutral',
    );
    this.enterStage(0);
  }

  dispose(): void {
    this.sched.clear();
  }

  /** Met à jour l'apparence d'un joueur (nom, avatar) pour l'affichage */
  touchMember(m: LifeMember): void {
    this.names.set(m.id, m);
  }

  // ---------------------------------------------------------------- Déroulé des étapes

  private enterStage(i: number): void {
    this.stageIdx = i;
    this.step = 'intro';
    const intro = STAGE_INTRO[this.stage];
    const home = SCENES[this.stage].places[0]!.id;
    this.boardStory = { title: intro.title, text: intro.board };
    for (const p of this.players.values()) {
      const rt = this.rt.get(p.id)!;
      p.place = home;
      rt.activity = null;
      rt.event = null;
      rt.results = [];
      let text = intro.byClass[p.origin];
      if (this.stage === 'travail' && p.flags.has('pret')) {
        applyDelta(p, { money: -10_000 });
        text += ' Le remboursement de ton prêt étudiant tombe : −10 000 €.';
      }
      rt.story = { title: intro.title, text };
    }
    this.push(`📍 ${STAGE_LABELS[this.stage]}`, 'neutral');
    this.stepEndsAt = this.sched.at('stage', this.t.intro, () => this.startPlay());
    this.emitAll();
  }

  private startPlay(): void {
    this.step = 'play';
    this.boardStory = null;
    const content = STAGE_CONTENT[this.stage];
    for (const p of this.players.values()) {
      const rt = this.rt.get(p.id)!;
      rt.story = null;
      rt.queue = shuffle([...content.events], this.rnd);
      this.giveEvent(p.id, content.opening, true);
    }
    this.stepEndsAt = this.sched.at('stage', this.playMs, () => this.endPlay());
    this.emitAll();
  }

  /** Fin du temps libre : activités terminées, événements en attente tranchés, puis bilan */
  private endPlay(): void {
    for (const p of this.players.values()) {
      const rt = this.rt.get(p.id)!;
      this.sched.cancel(`next:${p.id}`);
      if (rt.activity) this.finishAction(p.id, false);
      if (rt.event) this.resolveEvent(p.id, null, false);
    }
    this.milestone();
  }

  private milestone(): void {
    this.step = 'milestone';
    const fn: (p: LifePlayer) => Milestone =
      this.stage === 'lycee' ? bacMilestone : this.stage === 'universite' ? diplomaMilestone : careerMilestone;
    const tally = new Map<string, number>();
    for (const p of this.players.values()) {
      const rt = this.rt.get(p.id)!;
      p.prevScore = p.score;
      const before = p.cls;
      const m = fn(p);
      applyDelta(p, m.d ?? {});
      rt.story = { title: m.title, text: m.text };
      tally.set(m.title, (tally.get(m.title) ?? 0) + 1);
      if (m.feed) this.push(m.feed.replace('{name}', this.nameOf(p.id)), m.tone);
      this.classChange(p, before);
    }
    const titles: Record<Stage, string> = {
      lycee: 'Résultats du bac',
      universite: 'Remise des diplômes',
      travail: 'Fin de carrière',
    };
    const summary = [...tally.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([title, n]) => `${n} × ${title}`)
      .join(' · ');
    this.boardStory = { title: titles[this.stage], text: summary };
    this.stepEndsAt = this.sched.at('stage', this.t.milestone, () =>
      this.stageIdx < STAGES.length - 1 ? this.enterStage(this.stageIdx + 1) : this.finish(),
    );
    this.emitAll();
  }

  /** Fin de partie : pyramide. Peut être appelé à tout moment (fin anticipée par la régie). */
  finish(): void {
    if (this.step === 'final') return;
    this.sched.clear();
    this.step = 'final';
    this.stepEndsAt = null;
    this.paused = false;
    this.boardStory = null;
    for (const rt of this.rt.values()) {
      rt.activity = null;
      rt.event = null;
    }
    this.final = this.computeFinal();
    const ranked = this.ranking();
    for (const p of this.players.values()) {
      const rank = ranked.indexOf(p.id) + 1;
      const move = CLASS_RANK[p.cls] - CLASS_RANK[p.origin];
      const from = CLASS_LABELS[p.origin].toLowerCase();
      const to = CLASS_LABELS[p.cls].toLowerCase();
      const text =
        move > 0
          ? `Né·e en ${from}, tu termines en ${to} : belle ascension sociale !`
          : move < 0
            ? `Né·e en ${from}, tu termines en ${to} : déclassement…`
            : `Né·e en ${from}, tu y restes : la reproduction sociale a joué.`;
      this.rt.get(p.id)!.story = { title: `${rank}ᵉ sur ${ranked.length}`, text };
    }
    this.push('🏁 Fin de la partie : place à la pyramide sociale', 'neutral');
    this.emitAll();
    this.out.finished();
  }

  // ---------------------------------------------------------------- Activités

  act(playerId: string, actionId: string): string | null {
    const p = this.players.get(playerId);
    const rt = this.rt.get(playerId);
    if (!p || !rt) return 'Tu ne participes pas à cette partie';
    if (this.step !== 'play') return 'Patiente, l’étape n’a pas encore commencé';
    if (this.paused) return 'La partie est en pause';
    if (rt.event) return 'Réponds d’abord à la situation en cours';
    if (rt.activity) return 'Tu es déjà occupé·e';
    const action = STAGE_ACTIONS[this.stage].find((a) => a.id === actionId);
    if (!action || (action.show && !action.show(p))) return 'Activité indisponible';
    const locked = this.lockReason(p, action);
    if (locked) return locked;

    const paid = this.payable(p, action.cost);
    if (paid) applyDelta(p, { money: -paid });
    p.place = action.place;
    const startedAt = this.now();
    const endsAt = this.sched.at(`act:${playerId}`, action.seconds * 1_000, () => this.finishAction(playerId, true));
    rt.activity = { action, startedAt, endsAt, paid };
    this.emit(playerId);
    return null;
  }

  cancel(playerId: string): string | null {
    const rt = this.rt.get(playerId);
    if (!rt?.activity) return 'Aucune activité en cours';
    this.sched.cancel(`act:${playerId}`);
    rt.activity = null;
    this.emit(playerId);
    return null;
  }

  private finishAction(playerId: string, emit: boolean): void {
    const p = this.players.get(playerId)!;
    const rt = this.rt.get(playerId)!;
    const current = rt.activity;
    if (!current) return;
    this.sched.cancel(`act:${playerId}`);
    rt.activity = null;
    const raw = current.action.resolve(p, this.ctx);
    const outcome = { ...raw, d: scaleGains(raw.d, ACTIVITY_GAIN) };
    const text = current.paid === 0 && (current.action.cost ?? 0) > 0 ? `${outcome.text} (Payé par tes parents.)` : outcome.text;
    this.applyOutcome(p, { ...outcome, text }, current.paid);
    if (emit) this.emit(playerId);
  }

  // ---------------------------------------------------------------- Événements de vie

  private giveEvent(playerId: string, situation: Situation, mandatory: boolean): void {
    const rt = this.rt.get(playerId)!;
    const ms = mandatory ? this.t.opening : this.t.event;
    const endsAt = this.sched.at(`ev:${playerId}`, ms, () => this.resolveEvent(playerId, null, true));
    rt.event = { id: randomUUID(), situation, endsAt, mandatory };
    this.flash(playerId, `${situation.emoji} ${situation.title}`);
  }

  answer(playerId: string, optionId: string): string | null {
    const p = this.players.get(playerId);
    const rt = this.rt.get(playerId);
    if (!p || !rt) return 'Tu ne participes pas à cette partie';
    if (!rt.event) return 'Aucune situation en cours';
    if (this.paused) return 'La partie est en pause';
    const option = rt.event.situation.options.find((o) => o.id === optionId);
    if (!option || (option.show && !option.show(p))) return 'Choix invalide';
    const locked = this.lockReason(p, option);
    if (locked) return locked;
    this.resolveEvent(playerId, option, true);
    return null;
  }

  /** Tranche l'événement (option null = pas de réponse : choix par défaut) puis programme le suivant */
  private resolveEvent(playerId: string, option: Option | null, emit: boolean): void {
    const p = this.players.get(playerId)!;
    const rt = this.rt.get(playerId)!;
    const ev = rt.event;
    if (!ev) return;
    this.sched.cancel(`ev:${playerId}`);
    rt.event = null;
    const missed = !option;
    const chosen = option ?? this.fallback(p, ev.situation);
    const paid = this.payable(p, chosen.cost);
    const raw = chosen.resolve(p, this.ctx);
    const outcome = { ...raw, d: scaleGains(raw.d, EVENT_GAIN) };
    let text = (missed ? 'Pas de réponse à temps : ' : '') + outcome.text;
    if (paid === 0 && (chosen.cost ?? 0) > 0) text += ' (Payé par tes parents.)';
    this.applyOutcome(p, { ...outcome, text }, paid, `${ev.situation.emoji} ${ev.situation.title}`);
    if (this.step === 'play') this.scheduleNextEvent(playerId);
    if (emit) this.emit(playerId);
  }

  private scheduleNextEvent(playerId: string): void {
    const gap = this.t.gapMin + this.rnd() * (this.t.gapMax - this.t.gapMin);
    this.sched.at(`next:${playerId}`, gap, () => {
      const rt = this.rt.get(playerId);
      if (!rt || rt.event || this.step !== 'play') return;
      const next = rt.queue.shift();
      if (!next) return;
      this.giveEvent(playerId, next, false);
      this.emit(playerId);
    });
  }

  // ---------------------------------------------------------------- Résolution commune

  private applyOutcome(p: LifePlayer, outcome: Outcome, paid: number, source?: string): void {
    const rt = this.rt.get(p.id)!;
    p.prevScore = p.score;
    const before = p.cls;
    let delta = applyDelta(p, outcome.d ?? {});
    outcome.apply?.(p);
    applyDelta(p, {}); // emploi, diplôme : la position est recalculée
    if (paid) delta = sumCapitals(delta, { ...zeroCapitals(), money: -paid });
    const tone = outcome.tone ?? 'neutral';
    rt.results.unshift({ id: randomUUID(), text: source ? `${source} — ${outcome.text}` : outcome.text, delta, tone });
    if (rt.results.length > RESULTS_MAX) rt.results.length = RESULTS_MAX;
    const pop = popText(delta);
    if (pop) rt.pop = { id: randomUUID(), text: pop, tone, at: this.now() };
    if (outcome.feed) this.push(outcome.feed.replace('{name}', this.nameOf(p.id)), tone);
    this.classChange(p, before);
  }

  private classChange(p: LifePlayer, before: SocialClass): void {
    if (p.cls === before) return;
    const up = CLASS_RANK[p.cls] > CLASS_RANK[before];
    this.push(`${up ? '⬆️' : '⬇️'} ${this.nameOf(p.id)} passe en ${CLASS_LABELS[p.cls].toLowerCase()}`, up ? 'good' : 'bad');
  }

  // ---------------------------------------------------------------- Gestion (régie)

  control(action: GameControl): string | null {
    if (this.step === 'final') return 'La partie est terminée';
    switch (action) {
      case 'pause':
        if (this.paused) return 'Déjà en pause';
        this.sched.pause();
        this.paused = true;
        this.push('⏸️ Pause', 'admin');
        break;
      case 'resume': {
        if (!this.paused) return 'La partie n’est pas en pause';
        const shift = this.sched.resume();
        this.paused = false;
        // Les heures de fin affichées sont décalées de la durée de la pause
        if (this.stepEndsAt !== null) this.stepEndsAt += shift;
        for (const rt of this.rt.values()) {
          if (rt.activity) {
            rt.activity.startedAt += shift;
            rt.activity.endsAt += shift;
          }
          if (rt.event?.endsAt) rt.event.endsAt += shift;
        }
        this.push('▶️ Reprise', 'admin');
        break;
      }
      case 'nextStage':
        if (this.paused) {
          this.sched.resume();
          this.paused = false;
        }
        if (this.step === 'milestone') {
          this.sched.runNow('stage');
          return null;
        }
        this.sched.cancel('stage');
        this.endPlay();
        return null;
    }
    this.emitAll();
    return null;
  }

  /** Envoie tout de suite un événement de vie à un joueur */
  nudge(playerId: string): string | null {
    const rt = this.rt.get(playerId);
    if (!rt) return 'Joueur introuvable';
    if (this.step !== 'play') return 'Possible seulement pendant le temps libre';
    if (rt.event) return 'Ce joueur a déjà une situation en cours';
    this.sched.cancel(`next:${playerId}`);
    const next = rt.queue.shift() ?? STAGE_CONTENT[this.stage].events[Math.floor(this.rnd() * STAGE_CONTENT[this.stage].events.length)]!;
    this.giveEvent(playerId, next, false);
    this.emit(playerId);
    return null;
  }

  /** Donne (ou retire) de l'argent. target : 'all', 'class:<classe>' ou l'id d'un joueur */
  give(target: string, amount: number): string | null {
    if (!Number.isFinite(amount) || amount === 0) return 'Montant invalide';
    let targets: LifePlayer[];
    let label: string;
    if (target === 'all') {
      targets = [...this.players.values()];
      label = 'tout le monde';
    } else if (target.startsWith('class:')) {
      const cls = target.slice(6) as SocialClass;
      if (!SOCIAL_CLASSES.includes(cls)) return 'Classe inconnue';
      targets = [...this.players.values()].filter((p) => p.cls === cls);
      label = `la ${CLASS_LABELS[cls].toLowerCase()}`;
    } else {
      const p = this.players.get(target);
      if (!p) return 'Joueur introuvable';
      targets = [p];
      label = this.nameOf(p.id);
    }
    if (!targets.length) return 'Personne dans cette classe';
    for (const p of targets) {
      this.applyOutcome(
        p,
        { text: amount > 0 ? `L’organisateur te donne ${fmtMoney(amount)}.` : `L’organisateur te retire ${fmtMoney(-amount)}.`, d: { money: amount }, tone: amount > 0 ? 'good' : 'bad' },
        0,
        '💸',
      );
      this.flash(p.id, amount > 0 ? `💸 Tu reçois ${fmtMoney(amount)} !` : `💸 Tu perds ${fmtMoney(-amount)}`);
    }
    this.push(`💸 L’organisateur ${amount > 0 ? 'donne' : 'retire'} ${fmtMoney(Math.abs(amount))} à ${label}`, 'admin');
    this.emitAll();
    return null;
  }

  event(eventId: string): string | null {
    const ev = GAME_EVENTS.find((e) => e.id === eventId);
    if (!ev) return 'Événement inconnu';
    const { feed, affected } = ev.apply([...this.players.values()], this.rnd);
    for (const { p, d } of affected) {
      this.applyOutcome(p, { text: ev.description, d: d ?? {}, tone: 'neutral' }, 0, `${ev.emoji} ${ev.label}`);
      this.flash(p.id, `${ev.emoji} ${ev.label} : ${describeDelta(d ?? {})}`);
    }
    this.push(affected.length === 1 && ev.id === 'loto' ? feed.replace('un joueur', this.nameOf(affected[0]!.p.id)) : feed, 'admin');
    this.emitAll();
    return null;
  }

  // ---------------------------------------------------------------- Vues

  playerView(playerId: string): PlayerGameView | null {
    const p = this.players.get(playerId);
    const rt = this.rt.get(playerId);
    if (!p || !rt) return null;
    const ranked = this.step === 'final' ? this.ranking() : null;
    const ev = rt.event;
    return {
      stage: this.stage,
      stageIndex: this.stageIdx,
      step: this.step,
      stepEndsAt: this.paused ? null : this.stepEndsAt,
      paused: this.paused,
      me: {
        origin: p.origin,
        cls: p.cls,
        score: p.score,
        capitals: { ...p.cap },
        titles: [...p.titles],
        place: p.place,
      },
      story: rt.story,
      actions: this.step === 'play' ? STAGE_ACTIONS[this.stage].filter((a) => !a.show || a.show(p)).map((a) => this.actionView(p, a)) : [],
      activity: rt.activity
        ? {
            actionId: rt.activity.action.id,
            placeId: rt.activity.action.place,
            emoji: rt.activity.action.emoji,
            label: rt.activity.action.label,
            startedAt: rt.activity.startedAt,
            endsAt: rt.activity.endsAt,
          }
        : null,
      event: ev
        ? {
            id: ev.id,
            situation: situationView(ev.situation),
            options: ev.situation.options.filter((o) => !o.show || o.show(p)).map((o) => this.optionView(p, o)),
            endsAt: this.paused ? null : ev.endsAt,
            mandatory: ev.mandatory,
          }
        : null,
      results: rt.results,
      final: ranked ? { rank: ranked.indexOf(playerId) + 1, total: ranked.length, text: rt.story?.text ?? '' } : null,
      flash: rt.flash && rt.flash.until > this.now() ? { text: rt.flash.text } : null,
    };
  }

  boardView(): BoardView {
    const members = this.liveMembers();
    const now = this.now();
    const players = [...this.players.values()].map((p) => {
      const m = members.get(p.id) ?? this.names.get(p.id);
      const rt = this.rt.get(p.id)!;
      const fresh = rt.pop && now - rt.pop.at < POP_MS ? rt.pop : null;
      return {
        id: p.id,
        displayName: m?.displayName ?? '?',
        avatar: m?.avatar ?? '🙂',
        color: m?.color ?? 'violet',
        connected: !!members.get(p.id)?.connected,
        origin: p.origin,
        cls: p.cls,
        score: p.score,
        capitals: { ...p.cap },
        title: p.titles.at(-1) ?? null,
        place: p.place,
        activity: rt.activity ? { emoji: rt.activity.action.emoji, label: rt.activity.action.label, endsAt: rt.activity.endsAt } : null,
        busy: !!rt.event,
        pop: fresh ? { id: fresh.id, text: fresh.text, tone: fresh.tone } : null,
        trend: fresh ? (p.score > p.prevScore + 0.05 ? ('up' as const) : p.score < p.prevScore - 0.05 ? ('down' as const) : null) : null,
      };
    });
    return {
      stage: this.stage,
      stageIndex: this.stageIdx,
      step: this.step,
      stepEndsAt: this.paused ? null : this.stepEndsAt,
      paused: this.paused,
      story: this.boardStory,
      players,
      feed: [...this.feed],
      final: this.final,
    };
  }

  controlView(): Pick<ControlView, 'pending'> {
    const pending: Record<string, string | null> = {};
    for (const [id, rt] of this.rt) pending[id] = rt.event ? `${rt.event.situation.emoji} ${rt.event.situation.title}` : null;
    return { pending };
  }

  // ---------------------------------------------------------------- Interne

  private actionView(p: LifePlayer, a: Action): ActionView {
    return { id: a.id, placeId: a.place, emoji: a.emoji, label: a.label, seconds: a.seconds, hint: this.hint(p, a.cost, a.hint), locked: this.lockReason(p, a) };
  }

  private optionView(p: LifePlayer, o: Option): OptionView {
    return { id: o.id, emoji: o.emoji, label: o.label, hint: this.hint(p, o.cost, o.hint), locked: this.lockReason(p, o) };
  }

  private hint(p: LifePlayer, cost: number | undefined, extra: string | undefined): string {
    const hints: string[] = [];
    if (cost) {
      const pay = this.payable(p, cost);
      if (pay === 0) hints.push('Payé par tes parents');
      else if (pay < cost) hints.push(`−${fmtMoney(pay)} (parents : le reste)`);
      else hints.push(`−${fmtMoney(pay)}`);
    }
    if (extra) hints.push(extra);
    return hints.join(' · ');
  }

  private payable(p: LifePlayer, cost: number | undefined): number {
    if (!cost) return 0;
    const support = this.stage === 'travail' ? 0 : FAMILY_SUPPORT[p.origin];
    return Math.round(cost * (1 - support));
  }

  private lockReason(p: LifePlayer, o: { cost?: number; requires?: (p: LifePlayer) => string | null }): string | null {
    const req = o.requires?.(p);
    if (req) return req;
    const pay = this.payable(p, o.cost);
    if (pay > 0 && p.cap.money < pay) return `Il te manque ${fmtMoney(pay - Math.max(0, p.cap.money))}`;
    return null;
  }

  private fallback(p: LifePlayer, s: Situation): Option {
    const visible = s.options.filter((o) => !o.show || o.show(p));
    return (
      visible.find((o) => o.fallback && !this.lockReason(p, o)) ??
      visible.filter((o) => !this.lockReason(p, o)).at(-1) ??
      s.options.at(-1)!
    );
  }

  private ranking(): string[] {
    return [...this.players.values()].sort((a, b) => b.score - a.score).map((p) => p.id);
  }

  private computeFinal(): FinalView {
    const pyramid: FinalView['pyramid'] = { basse: [], moyenne: [], riche: [] };
    const matrix = {
      basse: { basse: 0, moyenne: 0, riche: 0 },
      moyenne: { basse: 0, moyenne: 0, riche: 0 },
      riche: { basse: 0, moyenne: 0, riche: 0 },
    };
    let climbed = 0;
    let fell = 0;
    let stayed = 0;
    for (const id of this.ranking()) {
      const p = this.players.get(id)!;
      pyramid[p.cls].push(id);
      matrix[p.origin][p.cls]++;
      const move = CLASS_RANK[p.cls] - CLASS_RANK[p.origin];
      if (move > 0) climbed++;
      else if (move < 0) fell++;
      else stayed++;
    }
    const takeaways: string[] = [];
    for (const origin of SOCIAL_CLASSES) {
      const row = matrix[origin];
      const n = row.basse + row.moyenne + row.riche;
      if (!n) continue;
      const parts = SOCIAL_CLASSES.filter((c) => row[c] > 0).map((c) => `${row[c]} en ${CLASS_LABELS[c].toLowerCase()}`);
      takeaways.push(`Né·e·s en ${CLASS_LABELS[origin].toLowerCase()} (${n}) : ${parts.join(', ')}.`);
    }
    const total = this.players.size;
    if (total)
      takeaways.push(
        `${Math.round((stayed / total) * 100)} % des joueurs terminent dans leur classe d’origine : la reproduction sociale reste forte.`,
      );
    return { pyramid, matrix, podium: this.ranking().slice(0, 3), climbed, fell, stayed, takeaways };
  }

  private nameOf(id: string): string {
    return this.liveMembers().get(id)?.displayName ?? this.names.get(id)?.displayName ?? 'Un joueur';
  }

  private push(text: string, tone: Tone | 'admin'): void {
    this.feed.unshift({ id: randomUUID(), at: this.now(), text, tone });
    if (this.feed.length > FEED_MAX) this.feed.length = FEED_MAX;
  }

  private flash(id: string, text: string): void {
    const rt = this.rt.get(id);
    if (rt) rt.flash = { text, until: this.now() + FLASH_MS };
  }

  private emit(playerId: string): void {
    this.out.players([playerId]);
    this.out.board();
  }

  private emitAll(): void {
    this.out.players();
    this.out.board();
  }
}

// ---------------------------------------------------------------- Utilitaires

export function situationView(s: Situation): SituationView {
  return { id: s.id, stage: s.stage, emoji: s.emoji, title: s.title, text: s.text };
}

function shuffle<T>(arr: T[], rnd: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

/** Pondère les gains (pas les pertes) de savoir et de réseau */
function scaleGains(d: Outcome['d'], factor: number): Outcome['d'] {
  if (!d) return d;
  const scaled = { ...d };
  for (const k of ['savoir', 'reseau'] as const) {
    const v = scaled[k];
    if (v && v > 0) scaled[k] = Math.round(v * factor * 10) / 10;
  }
  return scaled;
}

/** Résumé court d'un gain pour l'affichage au-dessus de l'avatar (« +130 € », « +3 savoir ») */
function popText(d: Capitals): string | null {
  const parts: string[] = [];
  if (Math.round(d.money)) parts.push(`${d.money > 0 ? '+' : '−'}${fmtMoney(Math.abs(d.money))}`);
  for (const [k, label] of [['savoir', 'savoir'], ['reseau', 'réseau'], ['moral', 'moral']] as const) {
    const v = Math.round(d[k]);
    if (v) parts.push(`${v > 0 ? '+' : ''}${v} ${label}`);
  }
  return parts.slice(0, 2).join(' · ') || null;
}

function describeDelta(d: Partial<Capitals>): string {
  const parts: string[] = [];
  if (d.money) parts.push(`${d.money > 0 ? '+' : ''}${fmtMoney(d.money)}`);
  if (d.savoir) parts.push(`${d.savoir > 0 ? '+' : ''}${Math.round(d.savoir)} savoir`);
  if (d.reseau) parts.push(`${d.reseau > 0 ? '+' : ''}${Math.round(d.reseau)} réseau`);
  if (d.moral) parts.push(`${d.moral > 0 ? '+' : ''}${Math.round(d.moral)} moral`);
  return parts.join(', ') || 'aucun effet';
}

/**
 * Tirage des classes : les classes imposées par la régie d'abord, puis le reste selon la répartition
 * choisie (méthode du plus fort reste, pour coller au plus près des proportions).
 */
export function assignClasses(
  ids: string[],
  roles: Map<string, SocialClass | null>,
  config: GameConfig,
  rnd: () => number,
): Map<string, SocialClass> {
  const result = new Map<string, SocialClass>();
  const weights = DISTRIBUTIONS[config.distribution].weights;
  const totalW = SOCIAL_CLASSES.reduce((s, c) => s + weights[c], 0);
  const n = ids.length;
  const exact = SOCIAL_CLASSES.map((c) => ({ c, v: (weights[c] / totalW) * n }));
  const target = Object.fromEntries(exact.map(({ c, v }) => [c, Math.floor(v)])) as Record<SocialClass, number>;
  let left = n - SOCIAL_CLASSES.reduce((s, c) => s + target[c], 0);
  for (const { c } of [...exact].sort((a, b) => (b.v % 1) - (a.v % 1))) {
    if (left-- <= 0) break;
    target[c]++;
  }

  const free: string[] = [];
  for (const id of ids) {
    const forced = roles.get(id);
    if (forced) {
      result.set(id, forced);
      target[forced] = Math.max(0, target[forced] - 1);
    } else free.push(id);
  }
  const slots: SocialClass[] = [];
  for (const c of SOCIAL_CLASSES) for (let i = 0; i < target[c]; i++) slots.push(c);
  shuffle(slots, rnd);
  shuffle(free, rnd);
  for (const id of free) {
    // Plus de places (trop de classes imposées) : tirage selon les poids
    const cls = slots.pop() ?? weighted(weights, totalW, rnd);
    result.set(id, cls);
  }
  return result;
}

function weighted(weights: Record<SocialClass, number>, total: number, rnd: () => number): SocialClass {
  let r = rnd() * total;
  for (const c of SOCIAL_CLASSES) {
    r -= weights[c];
    if (r <= 0) return c;
  }
  return 'moyenne';
}
