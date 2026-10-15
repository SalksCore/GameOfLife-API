import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SCENES, type SocialClass } from '../protocol.js';
import { STAGE_ACTIONS } from './actions.js';
import { ALL_SITUATIONS, STAGE_CONTENT } from './content.js';
import { LifeGame, assignClasses, type LifeMember } from './engine.js';

const FAST = { intro: 1_000, milestone: 1_000, opening: 5_000, event: 4_000, gapMin: 5_000, gapMax: 8_000 };

function members(n: number): LifeMember[] {
  return Array.from({ length: n }, (_, i) => ({ id: `p${i}`, displayName: `Joueur ${i}`, avatar: '🙂', color: 'violet', connected: true }));
}

/** Générateur pseudo-aléatoire déterministe (tests reproductibles) */
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function setup(n = 4, roles = new Map<string, SocialClass | null>(), rnd = seeded(1), stageMinutes = 1, timings: object = FAST) {
  const list = members(n);
  const map = new Map(list.map((m) => [m.id, m]));
  const out = { players: vi.fn(), board: vi.fn(), finished: vi.fn() };
  const game = new LifeGame(list, roles, { stageMinutes, distribution: 'realiste' }, () => map, out, { rnd, timings });
  return { game, out };
}

describe('contenu', () => {
  it('chaque situation a un choix par défaut, chaque activité un lieu existant', () => {
    for (const s of ALL_SITUATIONS) {
      expect(s.options.some((o) => o.fallback), s.id).toBe(true);
      const ids = s.options.map((o) => o.id);
      expect(new Set(ids).size, s.id).toBe(ids.length);
    }
    for (const [stage, actions] of Object.entries(STAGE_ACTIONS)) {
      const places = new Set(SCENES[stage as keyof typeof SCENES].places.map((p) => p.id));
      for (const a of actions) expect(places.has(a.place), a.id).toBe(true);
      // Chaque lieu propose au moins une activité
      for (const place of places) expect(actions.some((a) => a.place === place), `${stage}/${place}`).toBe(true);
    }
  });

  it('chaque étape a un moment clé et assez d’événements', () => {
    for (const s of Object.values(STAGE_CONTENT)) expect(s.events.length).toBeGreaterThanOrEqual(10);
  });
});

describe('assignClasses', () => {
  it('respecte les classes imposées et la répartition', () => {
    const ids = Array.from({ length: 20 }, (_, i) => `p${i}`);
    const roles = new Map<string, SocialClass | null>([
      ['p0', 'riche'],
      ['p1', 'riche'],
    ]);
    const res = assignClasses(ids, roles, { stageMinutes: 5, distribution: 'realiste' }, seeded(3));
    expect(res.get('p0')).toBe('riche');
    const count = { basse: 0, moyenne: 0, riche: 0 };
    for (const c of res.values()) count[c]++;
    expect(count).toEqual({ basse: 7, moyenne: 9, riche: 4 });
  });
});

describe('LifeGame', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('intro, moment clé obligatoire, activités libres, bilans, pyramide', () => {
    const { game, out } = setup();
    game.start();
    expect(game.playerView('p0')!.step).toBe('intro');
    expect(game.act('p0', 'ly-repos')).toMatch(/pas encore commencé/);
    vi.advanceTimersByTime(1_000);

    let v = game.playerView('p0')!;
    expect(v.step).toBe('play');
    expect(v.event?.situation.id).toBe('ly-specialites');
    expect(v.event?.mandatory).toBe(true);
    // Il faut d'abord répondre au moment clé
    expect(game.act('p0', 'ly-repos')).toMatch(/Réponds/);
    expect(game.answer('p0', 'ses')).toBeNull();
    expect(game.playerView('p0')!.results[0]!.text).toMatch(/Choix de la filière/);

    // Une activité prend du temps et déplace le joueur
    expect(game.act('p0', 'ly-reviser')).toBeNull();
    v = game.playerView('p0')!;
    expect(v.me.place).toBe('cdi');
    expect(v.activity?.actionId).toBe('ly-reviser');
    expect(game.act('p0', 'ly-repos')).toMatch(/occupé/);
    const savoir = v.me.capitals.savoir;
    vi.advanceTimersByTime(14_000);
    v = game.playerView('p0')!;
    expect(v.activity).toBeNull();
    expect(v.me.capitals.savoir).toBeGreaterThan(savoir);
    expect(game.boardView().players.find((p) => p.id === 'p0')!.pop).not.toBeNull();

    vi.advanceTimersByTime(10 * 60_000);
    expect(game.isFinished).toBe(true);
    expect(out.finished).toHaveBeenCalledOnce();
    const final = game.boardView().final!;
    expect(Object.values(final.pyramid).flat()).toHaveLength(4);
    expect(game.playerView('p0')!.me.titles.length).toBeGreaterThanOrEqual(2);
  });

  it('sans réponse, le moment clé est tranché par défaut', () => {
    const { game } = setup(1);
    game.start();
    vi.advanceTimersByTime(1_000 + 5_000);
    const v = game.playerView('p0')!;
    expect(v.event).toBeNull();
    expect(v.results[0]!.text).toMatch(/Pas de réponse/);
  });

  it('la pause gèle activités et chronomètre', () => {
    const { game } = setup(1);
    game.start();
    vi.advanceTimersByTime(1_000);
    game.answer('p0', 'ses');
    game.act('p0', 'ly-reviser');
    const endsAt = game.playerView('p0')!.activity!.endsAt;
    expect(game.control('pause')).toBeNull();
    expect(game.act('p0', 'ly-repos')).toMatch(/pause|occupé/);
    vi.advanceTimersByTime(60_000);
    expect(game.playerView('p0')!.activity).not.toBeNull();
    expect(game.control('resume')).toBeNull();
    expect(game.playerView('p0')!.activity!.endsAt).toBe(endsAt + 60_000);
    vi.advanceTimersByTime(14_000);
    expect(game.playerView('p0')!.activity).toBeNull();
  });

  it('la gestion peut passer au bilan, envoyer une situation, donner de l’argent', () => {
    const { game } = setup(2, new Map([['p0', 'basse']]));
    game.start();
    vi.advanceTimersByTime(1_000);
    game.answer('p0', 'ses');
    expect(game.nudge('p0')).toBeNull();
    expect(game.playerView('p0')!.event).not.toBeNull();
    expect(game.nudge('p0')).toMatch(/déjà/);

    const money = game.playerView('p1')!.me.capitals.money;
    expect(game.give('p1', 5_000)).toBeNull();
    expect(game.playerView('p1')!.me.capitals.money).toBe(money + 5_000);
    expect(game.playerView('p1')!.flash).not.toBeNull();
    expect(game.event('crise')).toBeNull();
    expect(game.event('nope')).toMatch(/inconnu/);

    expect(game.control('nextStage')).toBeNull();
    expect(game.playerView('p0')!.step).toBe('milestone');
    expect(game.playerView('p0')!.me.titles[0]).toMatch(/[Bb]ac/);
  });

  it('fin anticipée : pyramide immédiate, plus aucune minuterie', () => {
    const { game, out } = setup();
    game.start();
    vi.advanceTimersByTime(3_000);
    game.finish();
    expect(game.isFinished).toBe(true);
    vi.advanceTimersByTime(60_000);
    expect(out.finished).toHaveBeenCalledOnce();
  });
});

/**
 * Équilibrage : on simule des parties complètes (3 × 5 min) où chacun joue librement.
 * - « au hasard » : activités et réponses au hasard ;
 * - « stratège » : se repose quand le moral baisse, étudie, soigne son réseau, cherche les promotions.
 */
describe('équilibrage', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const SMART: Record<string, string[]> = {
    lycee: ['ly-cordees', 'ly-prof', 'ly-reviser', 'ly-cours', 'ly-diner', 'ly-devoirs', 'ly-potes', 'ly-oral', 'ly-reviser', 'ly-cantine'],
    universite: ['un-prepa', 'un-alternance', 'un-bu', 'un-demarcher', 'un-amphi', 'un-parents', 'un-asso', 'un-groupe', 'un-question'],
    travail: ['tr-chercher', 'tr-promo', 'tr-chef', 'tr-travailler', 'tr-atelier', 'tr-boite', 'tr-immo', 'tr-travailler', 'tr-golf', 'tr-afterwork', 'tr-heures'],
  };
  const SMART_ANSWERS = ['prepa-cordees', 'prepa', 'sciences', 'licence', 'cadre', 'piston', 'technicien', 'employe', 'stage', 'seul', 'serieux', 'reviser', 'fiches', 'bourse', 'dossier', 'adulte', 'master', 'negocier', 'resister', 'postuler', 'accepter', 'objectifs', 'livret', 'afterwork', 'arret', 'famille', 'asso', 'non', 'reseau'];

  function simulate(strategy: 'random' | 'smart', origin: SocialClass, games = 40) {
    const outcomes = { basse: 0, moyenne: 0, riche: 0 };
    for (let g = 0; g < games; g++) {
      const rnd = seeded(1_000 + g);
      const { game } = setup(1, new Map([['p0', origin]]), rnd, 5, {});
      game.start();
      let turn = 0;
      while (!game.isFinished) {
        const v = game.playerView('p0')!;
        if (v.step === 'play') {
          if (v.event) {
            const open = v.event.options.filter((o) => !o.locked);
            const pick = strategy === 'random' ? open[Math.floor(rnd() * open.length)] : (SMART_ANSWERS.map((id) => open.find((o) => o.id === id)).find(Boolean) ?? open[0]);
            if (pick && rnd() < 0.5) game.answer('p0', pick.id);
          } else if (!v.activity) {
            const open = v.actions.filter((a) => !a.locked);
            let pick;
            if (strategy === 'random') pick = open[Math.floor(rnd() * open.length)];
            else if (v.me.capitals.moral < 35) pick = open.find((a) => /repos|dormir/.test(a.id));
            else {
              const list = SMART[v.stage]!;
              for (let k = 0; k < list.length && !pick; k++) pick = open.find((a) => a.id === list[(turn + k) % list.length]);
              turn++;
            }
            if (pick) game.act('p0', pick.id);
          }
        }
        vi.advanceTimersByTime(1_000);
      }
      outcomes[game.playerView('p0')!.me.cls]++;
    }
    return outcomes;
  }

  it('reproduction sociale et ascension possible mais difficile', () => {
    const r = {
      hasardBasse: simulate('random', 'basse'),
      hasardMoyenne: simulate('random', 'moyenne'),
      hasardRiche: simulate('random', 'riche'),
      stratBasse: simulate('smart', 'basse'),
      stratMoyenne: simulate('smart', 'moyenne'),
    };
    // Au hasard, la plupart des enfants de la classe basse y restent, et le sommet est presque inatteignable
    expect(r.hasardBasse.basse).toBeGreaterThan(r.hasardBasse.moyenne);
    expect(r.hasardBasse.riche).toBeLessThanOrEqual(2);
    // Les enfants de la classe riche restent le plus souvent en haut
    expect(r.hasardRiche.riche).toBeGreaterThanOrEqual(25);
    // En jouant bien, monter d'une classe est atteignable depuis le bas…
    expect(r.stratBasse.moyenne + r.stratBasse.riche).toBeGreaterThanOrEqual(24);
    // …mais le sommet reste rare
    expect(r.stratBasse.riche).toBeLessThanOrEqual(8);
  });
});
