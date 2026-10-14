import { randomUUID } from 'node:crypto';
import {
  CLASS_LABELS,
  DISTRIBUTIONS,
  SOCIAL_CLASSES,
  STAGES,
  STAGE_LABELS,
  type BoardView,
  type ControlView,
  type FeedItem,
  type FinalView,
  type GameConfig,
  type GameControl,
  type GameStep,
  type OptionView,
  type PlayerGameView,
  type RoundResult,
  type SituationView,
  type SocialClass,
  type Stage,
  type Tone,
} from '../protocol.js';
import {
  GAME_EVENTS,
  STAGE_CONTENT,
  STAGE_INTRO,
  bacMilestone,
  careerMilestone,
  diplomaMilestone,
  type Milestone,
} from './content.js';
import {
  FAMILY_SUPPORT,
  SALARY,
  applyDelta,
  fmtMoney,
  newPlayer,
  sumCapitals,
  zeroCapitals,
  type Ctx,
  type LifePlayer,
  type Option,
  type Situation,
} from './model.js';

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
  /** L'écran projeté / la régie doivent être rafraîchis */
  board(): void;
  /** Pyramide affichée : la partie est terminée */
  finished(): void;
}

export interface Timings {
  intro: number;
  reveal: number;
  milestone: number;
  minChoose: number;
  /** Durée visée d'un tour (choix + résultat) pour calculer le nombre de tours */
  targetRound: number;
}

export const DEFAULT_LIFE_TIMINGS: Timings = {
  intro: 9_000,
  reveal: 6_000,
  milestone: 9_000,
  minChoose: 8_000,
  targetRound: 30_000,
};

const CLASS_RANK: Record<SocialClass, number> = { basse: 0, moyenne: 1, riche: 2 };
const FEED_MAX = 40;
const FLASH_MS = 8_000;

type Pending = () => void;

/**
 * Une partie : lycée -> université -> monde du travail, puis pyramide.
 * Le moteur ne connaît pas Socket.IO : il signale ses changements via LifeOutput.
 */
export class LifeGame {
  readonly players = new Map<string, LifePlayer>();
  private readonly plan: Record<Stage, Situation[]>;
  private readonly unused: Record<Stage, Situation[]>;
  private readonly chooseMs: number;
  private stageIdx = 0;
  private roundIdx = -1;
  private step: GameStep = 'intro';
  private stepEndsAt: number | null = null;
  private timer: NodeJS.Timeout | null = null;
  private pending: Pending | null = null;
  private paused = false;
  private remaining = 0;
  private current: Situation | null = null;
  private readonly choices = new Map<string, string>();
  private readonly results = new Map<string, RoundResult>();
  private readonly stories = new Map<string, { title: string; text: string }>();
  private readonly flashes = new Map<string, { text: string; until: number }>();
  private boardStory: { title: string; text: string } | null = null;
  private readonly feed: FeedItem[] = [];
  private final: FinalView | null = null;
  /** Noms connus (y compris des joueurs partis en cours de route) */
  private readonly names = new Map<string, LifeMember>();
  private readonly rnd: () => number;
  private readonly now: () => number;
  private readonly t: Timings;

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

    const classes = assignClasses(
      members.map((m) => m.id),
      roles,
      config,
      this.rnd,
    );
    for (const m of members) {
      this.names.set(m.id, m);
      this.players.set(m.id, newPlayer(m.id, classes.get(m.id)!, this.rnd));
    }

    // Programme des tours, connu à l'avance (la régie voit la situation suivante)
    const stageMs = config.stageMinutes * 60_000;
    const available = stageMs - this.t.intro - this.t.milestone;
    const plan = {} as Record<Stage, Situation[]>;
    const unused = {} as Record<Stage, Situation[]>;
    let rounds = Infinity;
    for (const stage of STAGES) {
      const c = STAGE_CONTENT[stage];
      rounds = Math.min(rounds, c.pool.length + 2);
    }
    rounds = Math.max(3, Math.min(rounds, Math.floor(available / this.t.targetRound)));
    for (const stage of STAGES) {
      const c = STAGE_CONTENT[stage];
      const pool = shuffle([...c.pool], this.rnd);
      plan[stage] = [c.first, ...pool.slice(0, rounds - 2), c.last];
      unused[stage] = pool.slice(rounds - 2);
    }
    this.plan = plan;
    this.unused = unused;
    this.chooseMs = Math.max(this.t.minChoose, Math.floor(available / rounds) - this.t.reveal);
  }

  get stage(): Stage {
    return STAGES[this.stageIdx]!;
  }
  get isFinished(): boolean {
    return this.step === 'final';
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
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
  }

  /** Met à jour l'apparence d'un joueur (nom, avatar) pour l'affichage */
  touchMember(m: LifeMember): void {
    this.names.set(m.id, m);
  }

  // ---------------------------------------------------------------- Déroulé

  private schedule(ms: number, next: Pending): void {
    if (this.timer) clearTimeout(this.timer);
    this.pending = next;
    this.stepEndsAt = this.now() + ms;
    if (this.paused) {
      this.remaining = ms;
      this.stepEndsAt = null;
      this.timer = null;
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.pending = null;
      next();
    }, ms);
  }

  private enterStage(i: number): void {
    this.stageIdx = i;
    this.roundIdx = -1;
    this.current = null;
    this.step = 'intro';
    const intro = STAGE_INTRO[this.stage];
    this.boardStory = { title: intro.title, text: intro.board };
    for (const p of this.players.values()) {
      let text = intro.byClass[p.origin];
      if (this.stage === 'travail' && p.flags.has('pret')) {
        applyDelta(p, { money: -10_000 });
        text += ' Le remboursement de ton prêt étudiant tombe : −10 000 €.';
      }
      this.stories.set(p.id, { title: intro.title, text });
    }
    this.push(`📍 ${STAGE_LABELS[this.stage]}`, 'neutral');
    this.schedule(this.t.intro, () => this.nextRound());
    this.emitAll();
  }

  private nextRound(): void {
    this.roundIdx++;
    const list = this.plan[this.stage];
    if (this.roundIdx >= list.length) return this.milestone();
    this.current = list[this.roundIdx]!;
    this.step = 'choose';
    this.choices.clear();
    this.results.clear();
    this.stories.clear();
    this.boardStory = null;
    this.schedule(this.chooseMs, () => this.reveal());
    this.emitAll();
  }

  private reveal(): void {
    const situation = this.current;
    if (!situation) return this.nextRound();
    this.step = 'reveal';
    const ctx: Ctx = { rnd: this.rnd, roll: (prob) => this.rnd() < prob };
    let feeds = 0;
    for (const p of this.players.values()) {
      p.prevScore = p.score;
      const before = p.cls;
      const chosen = this.choices.get(p.id);
      let option = chosen ? situation.options.find((o) => o.id === chosen) : undefined;
      // Choix devenu impossible (argent dépensé entre-temps) ou absence de réponse : option par défaut
      if (option && this.lockReason(p, option)) option = undefined;
      const missed = !option;
      option ??= this.fallback(p, situation);

      const cost = this.payable(p, option);
      const outcome = option.resolve(p, ctx);
      let delta = applyDelta(p, sumCapitals(zeroCapitals(), { ...zeroCapitals(), ...outcome.d, money: (outcome.d?.money ?? 0) - cost }));
      outcome.apply?.(p);
      let text = (missed ? 'Pas de réponse à temps : ' : '') + outcome.text;
      if (cost === 0 && (option.cost ?? 0) > 0) text += ' (Payé par tes parents.)';

      if (this.stage === 'travail') {
        const income = this.income(p, ctx);
        if (income.amount) {
          delta = sumCapitals(delta, applyDelta(p, { money: income.amount }));
          text += `\n${income.text}`;
        }
      }
      // Les choix peuvent changer emploi ou diplôme : la position est recalculée
      applyDelta(p, {});
      this.results.set(p.id, { text, delta, tone: outcome.tone ?? 'neutral' });

      if (outcome.feed && feeds < 6) {
        feeds++;
        this.push(outcome.feed.replace('{name}', this.nameOf(p.id)), outcome.tone ?? 'neutral');
      }
      if (p.cls !== before) {
        const up = CLASS_RANK[p.cls] > CLASS_RANK[before];
        this.push(`${up ? '⬆️' : '⬇️'} ${this.nameOf(p.id)} passe en ${CLASS_LABELS[p.cls].toLowerCase()}`, up ? 'good' : 'bad');
      }
    }
    this.schedule(this.t.reveal, () => this.nextRound());
    this.emitAll();
  }

  private milestone(): void {
    this.step = 'milestone';
    this.current = null;
    this.choices.clear();
    this.results.clear();
    const fn: (p: LifePlayer) => Milestone =
      this.stage === 'lycee' ? bacMilestone : this.stage === 'universite' ? diplomaMilestone : careerMilestone;
    const tally = new Map<string, number>();
    for (const p of this.players.values()) {
      p.prevScore = p.score;
      const before = p.cls;
      const m = fn(p);
      applyDelta(p, m.d ?? {});
      this.stories.set(p.id, { title: m.title, text: m.text });
      tally.set(m.title, (tally.get(m.title) ?? 0) + 1);
      if (m.feed) this.push(m.feed.replace('{name}', this.nameOf(p.id)), m.tone);
      if (p.cls !== before) {
        const up = CLASS_RANK[p.cls] > CLASS_RANK[before];
        this.push(`${up ? '⬆️' : '⬇️'} ${this.nameOf(p.id)} passe en ${CLASS_LABELS[p.cls].toLowerCase()}`, up ? 'good' : 'bad');
      }
    }
    const summary = [...tally.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([title, n]) => `${n} × ${title}`)
      .join(' · ');
    const titles: Record<Stage, string> = {
      lycee: 'Résultats du bac',
      universite: 'Remise des diplômes',
      travail: 'Fin de carrière',
    };
    this.boardStory = { title: titles[this.stage], text: summary };
    this.schedule(this.t.milestone, () => (this.stageIdx < STAGES.length - 1 ? this.enterStage(this.stageIdx + 1) : this.finish()));
    this.emitAll();
  }

  /** Fin de partie : pyramide. Peut être appelé à tout moment (fin anticipée par la régie). */
  finish(): void {
    if (this.step === 'final') return;
    this.dispose();
    this.step = 'final';
    this.stepEndsAt = null;
    this.paused = false;
    this.current = null;
    this.boardStory = null;
    this.final = this.computeFinal();
    const ranked = this.ranking();
    for (const p of this.players.values()) {
      const rank = ranked.indexOf(p.id) + 1;
      const move = CLASS_RANK[p.cls] - CLASS_RANK[p.origin];
      const text =
        move > 0
          ? `Né·e en ${CLASS_LABELS[p.origin].toLowerCase()}, tu termines en ${CLASS_LABELS[p.cls].toLowerCase()} : belle ascension sociale !`
          : move < 0
            ? `Né·e en ${CLASS_LABELS[p.origin].toLowerCase()}, tu termines en ${CLASS_LABELS[p.cls].toLowerCase()} : déclassement…`
            : `Né·e en ${CLASS_LABELS[p.origin].toLowerCase()}, tu y restes : la reproduction sociale a joué.`;
      this.stories.set(p.id, { title: `${rank}ᵉ sur ${ranked.length}`, text });
    }
    this.push('🏁 Fin de la partie : place à la pyramide sociale', 'neutral');
    this.emitAll();
    this.out.finished();
  }

  // ---------------------------------------------------------------- Joueurs

  choose(playerId: string, optionId: string): string | null {
    const p = this.players.get(playerId);
    if (!p) return 'Tu ne participes pas à cette partie';
    if (this.step !== 'choose' || !this.current) return 'Ce n’est pas le moment de choisir';
    if (this.paused) return 'La partie est en pause';
    const option = this.current.options.find((o) => o.id === optionId);
    if (!option || (option.show && !option.show(p))) return 'Choix invalide';
    const locked = this.lockReason(p, option);
    if (locked) return locked;
    this.choices.set(playerId, optionId);
    this.out.players([playerId]);
    this.out.board();
    return null;
  }

  // ---------------------------------------------------------------- Régie

  control(action: GameControl): string | null {
    if (this.step === 'final') return 'La partie est terminée';
    switch (action) {
      case 'pause':
        if (this.paused) return 'Déjà en pause';
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        this.remaining = Math.max(0, (this.stepEndsAt ?? this.now()) - this.now());
        this.paused = true;
        this.stepEndsAt = null;
        this.push('⏸️ Pause', 'admin');
        break;
      case 'resume': {
        if (!this.paused) return 'La partie n’est pas en pause';
        this.paused = false;
        const next = this.pending;
        if (next) this.schedule(this.remaining, next);
        this.push('▶️ Reprise', 'admin');
        break;
      }
      case 'skip': {
        const next = this.pending;
        if (!next) return 'Rien à passer';
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        this.pending = null;
        this.paused = false;
        next();
        return null;
      }
      case 'nextStage':
        if (this.step === 'milestone') return this.control('skip');
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        this.paused = false;
        this.milestone();
        return null;
      case 'reroll': {
        const up = this.upcomingRef();
        if (!up) return 'Aucune situation à venir';
        const content = STAGE_CONTENT[up.stage];
        if (up.situation === content.first || up.situation === content.last)
          return 'Cette situation est une étape clé, elle ne peut pas être changée';
        const pool = this.unused[up.stage];
        if (!pool.length) return 'Plus d’autre situation disponible pour cette étape';
        const replacement = pool.splice(Math.floor(this.rnd() * pool.length), 1)[0]!;
        pool.push(up.situation);
        this.plan[up.stage][up.index] = replacement;
        break;
      }
    }
    this.emitAll();
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
    const verb = amount > 0 ? 'donne' : 'retire';
    const text = `💸 L’organisateur ${verb} ${fmtMoney(Math.abs(amount))} à ${label}`;
    for (const p of targets) {
      applyDelta(p, { money: amount });
      this.flash(p.id, amount > 0 ? `💸 Tu reçois ${fmtMoney(amount)} !` : `💸 Tu perds ${fmtMoney(-amount)}`);
    }
    this.push(text, 'admin');
    this.emitAll();
    return null;
  }

  event(eventId: string): string | null {
    const ev = GAME_EVENTS.find((e) => e.id === eventId);
    if (!ev) return 'Événement inconnu';
    const { feed, affected } = ev.apply([...this.players.values()], this.rnd);
    for (const { p, d } of affected) {
      applyDelta(p, d ?? {});
      this.flash(p.id, `${ev.emoji} ${ev.label} : ${describeDelta(d ?? {})}`);
    }
    this.push(affected.length === 1 && ev.id === 'loto' ? `${feed.replace('un joueur', this.nameOf(affected[0]!.p.id))}` : feed, 'admin');
    this.emitAll();
    return null;
  }

  // ---------------------------------------------------------------- Vues

  playerView(playerId: string): PlayerGameView | null {
    const p = this.players.get(playerId);
    if (!p) return null;
    const situation = this.current;
    const result = this.results.get(playerId) ?? null;
    const flash = this.flashes.get(playerId);
    const ranked = this.step === 'final' ? this.ranking() : null;
    return {
      stage: this.stage,
      stageIndex: this.stageIdx,
      step: this.step,
      stepEndsAt: this.stepEndsAt,
      paused: this.paused,
      roundIndex: Math.max(0, this.roundIdx),
      roundCount: this.plan[this.stage].length,
      me: {
        origin: p.origin,
        cls: p.cls,
        score: p.score,
        capitals: { ...p.cap },
        titles: [...p.titles],
      },
      story: this.stories.get(playerId) ?? null,
      round:
        situation && (this.step === 'choose' || this.step === 'reveal')
          ? {
              situation: situationView(situation),
              options: situation.options.filter((o) => !o.show || o.show(p)).map((o) => this.optionView(p, o)),
              choice: this.choices.get(playerId) ?? null,
              result: this.step === 'reveal' ? result : null,
            }
          : null,
      final: ranked
        ? { rank: ranked.indexOf(playerId) + 1, total: ranked.length, text: this.stories.get(playerId)?.text ?? '' }
        : null,
      flash: flash && flash.until > this.now() ? { text: flash.text } : null,
    };
  }

  boardView(): BoardView {
    const members = this.liveMembers();
    const situation = this.current;
    const counts = new Map<string, number>();
    for (const id of this.choices.values()) counts.set(id, (counts.get(id) ?? 0) + 1);
    const players = [...this.players.values()].map((p) => {
      const m = members.get(p.id) ?? this.names.get(p.id);
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
        answered: this.choices.has(p.id),
        trend: p.score > p.prevScore + 0.05 ? ('up' as const) : p.score < p.prevScore - 0.05 ? ('down' as const) : null,
      };
    });
    return {
      stage: this.stage,
      stageIndex: this.stageIdx,
      step: this.step,
      stepEndsAt: this.stepEndsAt,
      paused: this.paused,
      roundIndex: Math.max(0, this.roundIdx),
      roundCount: this.plan[this.stage].length,
      story: this.boardStory,
      situation: situation ? situationView(situation) : null,
      options: situation
        ? situation.options.map((o) => ({
            id: o.id,
            emoji: o.emoji,
            label: o.label,
            count: this.step === 'reveal' ? (counts.get(o.id) ?? 0) : 0,
          }))
        : [],
      answered: this.choices.size,
      total: this.players.size,
      players,
      feed: [...this.feed],
      final: this.final,
    };
  }

  controlView(): Pick<ControlView, 'upcoming' | 'choices'> {
    const up = this.upcomingRef();
    const choices: Record<string, string | null> = {};
    for (const p of this.players.values()) {
      const id = this.choices.get(p.id);
      choices[p.id] = id ? (this.current?.options.find((o) => o.id === id)?.label ?? id) : null;
    }
    return {
      upcoming: up
        ? { situation: situationView(up.situation), options: up.situation.options.map((o) => `${o.emoji} ${o.label}`), startsAt: up.startsAt }
        : null,
      choices,
    };
  }

  // ---------------------------------------------------------------- Interne

  private optionView(p: LifePlayer, o: Option): OptionView {
    const cost = o.cost ?? 0;
    const pay = this.payable(p, o);
    const hints: string[] = [];
    if (cost > 0) {
      if (pay === 0) hints.push('Payé par tes parents');
      else if (pay < cost) hints.push(`−${fmtMoney(pay)} (parents : le reste)`);
      else hints.push(`−${fmtMoney(pay)}`);
    }
    if (o.hint) hints.push(o.hint);
    return { id: o.id, emoji: o.emoji, label: o.label, hint: hints.join(' · '), locked: this.lockReason(p, o) };
  }

  private payable(p: LifePlayer, o: Option): number {
    const cost = o.cost ?? 0;
    if (!cost) return 0;
    const support = this.stage === 'travail' ? 0 : FAMILY_SUPPORT[p.origin];
    return Math.round(cost * (1 - support));
  }

  private lockReason(p: LifePlayer, o: Option): string | null {
    const req = o.requires?.(p);
    if (req) return req;
    const pay = this.payable(p, o);
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

  private income(p: LifePlayer, ctx: Ctx): { amount: number; text: string } {
    const job = p.job ?? 'chomage';
    if (job === 'entrepreneur') {
      return ctx.roll(0.45 + (p.cap.reseau - 50) / 200)
        ? { amount: 3_500, text: 'Ton entreprise tourne bien : +3 500 €.' }
        : { amount: -1_200, text: 'Mois difficile pour ton entreprise : −1 200 €.' };
    }
    const amount = Math.round(SALARY[job] * (1 + p.raise));
    return {
      amount,
      text: job === 'chomage' ? `Allocations − dépenses : ${fmtMoney(amount)}.` : `Salaire (épargne du mois) : +${fmtMoney(amount)}.`,
    };
  }

  /** Situation suivante et heure prévue d'affichage */
  private upcomingRef(): { stage: Stage; index: number; situation: Situation; startsAt: number | null } | null {
    let stageIdx = this.stageIdx;
    let index = this.roundIdx + 1;
    // Délai avant l'affichage : fin de l'étape en cours + étapes intermédiaires
    let extra = 0;
    if (this.step === 'choose') extra += this.t.reveal;
    if (this.step === 'milestone') {
      stageIdx++;
      index = 0;
      extra += this.t.intro;
    } else if (index >= this.plan[STAGES[stageIdx]!].length) {
      stageIdx++;
      index = 0;
      extra += (this.step === 'choose' ? 0 : 0) + this.t.milestone + this.t.intro;
    }
    if (this.step === 'intro') index = 0;
    const stage = STAGES[stageIdx];
    if (!stage || this.step === 'final') return null;
    const situation = this.plan[stage][index];
    if (!situation) return null;
    return { stage, index, situation, startsAt: this.stepEndsAt === null ? null : this.stepEndsAt + extra };
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
      const parts = SOCIAL_CLASSES.filter((c) => row[c] > 0).map(
        (c) => `${row[c]} en ${CLASS_LABELS[c].toLowerCase()}`,
      );
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
    this.flashes.set(id, { text, until: this.now() + FLASH_MS });
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

function describeDelta(d: Partial<Record<'money' | 'savoir' | 'reseau' | 'moral', number>>): string {
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
