import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SocialClass } from '../protocol.js';
import { ALL_SITUATIONS, STAGE_CONTENT } from './content.js';
import { LifeGame, assignClasses, type LifeMember } from './engine.js';

const TIMINGS = { intro: 1_000, reveal: 1_000, milestone: 1_000, minChoose: 1_000, targetRound: 6_000 };

function members(n: number): LifeMember[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    displayName: `Joueur ${i}`,
    avatar: '🙂',
    color: 'violet',
    connected: true,
  }));
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

function setup(n = 6, roles = new Map<string, SocialClass | null>(), rnd = seeded(1)) {
  const list = members(n);
  const map = new Map(list.map((m) => [m.id, m]));
  const out = { players: vi.fn(), board: vi.fn(), finished: vi.fn() };
  const game = new LifeGame(list, roles, { stageMinutes: 1, distribution: 'realiste' }, () => map, out, {
    rnd,
    timings: TIMINGS,
  });
  return { game, out, list };
}

describe('contenu', () => {
  it('chaque situation a un choix par défaut accessible à tous', () => {
    for (const s of ALL_SITUATIONS) {
      expect(s.options.some((o) => o.fallback), s.id).toBe(true);
      const ids = s.options.map((o) => o.id);
      expect(new Set(ids).size, s.id).toBe(ids.length);
    }
  });

  it('chaque étape a assez de situations', () => {
    for (const stage of Object.values(STAGE_CONTENT)) expect(stage.pool.length).toBeGreaterThanOrEqual(10);
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
    expect(res.get('p1')).toBe('riche');
    const count = { basse: 0, moyenne: 0, riche: 0 };
    for (const c of res.values()) count[c]++;
    expect(count).toEqual({ basse: 7, moyenne: 9, riche: 4 });
  });
});

describe('LifeGame', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('déroule les trois étapes jusqu’à la pyramide', () => {
    const { game, out } = setup();
    game.start();
    expect(game.playerView('p0')!.step).toBe('intro');
    vi.advanceTimersByTime(1_000);
    const v = game.playerView('p0')!;
    expect(v.step).toBe('choose');
    expect(v.round!.situation.id).toBe('ly-rentree');
    expect(game.choose('p0', 'serieux')).toBeNull();
    expect(game.playerView('p0')!.round!.choice).toBe('serieux');

    vi.advanceTimersByTime(10 * 60_000);
    expect(game.isFinished).toBe(true);
    expect(out.finished).toHaveBeenCalledOnce();
    const final = game.boardView().final!;
    const total = Object.values(final.pyramid).flat().length;
    expect(total).toBe(6);
    expect(final.climbed + final.fell + final.stayed).toBe(6);
    expect(game.playerView('p0')!.me.titles.length).toBeGreaterThanOrEqual(2);
  });

  it('refuse un choix bloqué et hors du temps de choix', () => {
    const { game } = setup(3, new Map([['p0', 'basse']]));
    game.start();
    expect(game.choose('p0', 'serieux')).toMatch(/pas le moment/);
    vi.advanceTimersByTime(1_000);
    expect(game.choose('p0', 'inexistant')).toMatch(/invalide/);
  });

  it('pause, reprise et passage', () => {
    const { game } = setup();
    game.start();
    expect(game.control('pause')).toBeNull();
    vi.advanceTimersByTime(60_000);
    expect(game.playerView('p0')!.step).toBe('intro');
    expect(game.control('resume')).toBeNull();
    vi.advanceTimersByTime(1_000);
    expect(game.playerView('p0')!.step).toBe('choose');
    expect(game.control('skip')).toBeNull();
    expect(game.playerView('p0')!.step).toBe('reveal');
  });

  it('la régie voit la situation suivante et peut la changer', () => {
    const { game } = setup();
    game.start();
    vi.advanceTimersByTime(1_000); // 1er tour
    const next = game.controlView().upcoming!;
    expect(next.startsAt).not.toBeNull();
    expect(game.control('reroll')).toBeNull();
    expect(game.controlView().upcoming!.situation.id).not.toBe(next.situation.id);
  });

  it('dons d’argent et événements', () => {
    const { game } = setup(4, new Map([['p0', 'basse']]));
    game.start();
    const before = game.playerView('p0')!.me.capitals.money;
    expect(game.give('p0', 5_000)).toBeNull();
    expect(game.playerView('p0')!.me.capitals.money).toBe(before + 5_000);
    expect(game.playerView('p0')!.flash).not.toBeNull();
    expect(game.event('crise')).toBeNull();
    expect(game.event('nope')).toMatch(/inconnu/);
    expect(game.boardView().feed.some((f) => f.tone === 'admin')).toBe(true);
  });

  it('fin anticipée : pyramide immédiate', () => {
    const { game, out } = setup();
    game.start();
    vi.advanceTimersByTime(3_000);
    game.finish();
    expect(game.isFinished).toBe(true);
    expect(out.finished).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(60_000);
    expect(out.finished).toHaveBeenCalledOnce();
  });
});

/**
 * Équilibrage : on simule beaucoup de parties.
 * - Joueurs « au hasard » : la classe d'origine pèse lourd (reproduction sociale).
 * - Joueurs « stratèges » (meilleur choix accessible) : monter est possible, mais pas garanti.
 */
describe('équilibrage', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function simulate(strategy: 'random' | 'smart', origin: SocialClass, games = 60) {
    const outcomes = { basse: 0, moyenne: 0, riche: 0 };
    for (let g = 0; g < games; g++) {
      const rnd = seeded(1000 + g);
      const roles = new Map<string, SocialClass | null>([['p0', origin]]);
      const { game } = setup(1, roles, rnd);
      game.start();
      while (!game.isFinished) {
        const v = game.playerView('p0')!;
        if (v.step === 'choose' && v.round && !v.round.choice) {
          const open = v.round.options.filter((o) => !o.locked);
          const pick =
            strategy === 'random'
              ? open[Math.floor(rnd() * open.length)]
              : smartPick(open.map((o) => o.id), v.round.situation.id);
          if (pick) game.choose('p0', typeof pick === 'string' ? pick : pick.id);
        }
        vi.advanceTimersByTime(500);
      }
      outcomes[game.playerView('p0')!.me.cls]++;
    }
    return outcomes;
  }

  /** Stratégie « raisonnable » : favorise études et réseau, évite les paris */
  function smartPick(open: string[], situation: string): string | undefined {
    const pref: Record<string, string[]> = {
      'ly-rentree': ['serieux'],
      'ly-cours': ['prof', 'cdi'],
      'ly-stage': ['famille', 'spontanee'],
      'ly-voyage': ['partir', 'aide'],
      'ly-fete': ['reviser'],
      'ly-specialites': ['sciences', 'ses'],
      'ly-delegue': ['candidat'],
      'ly-tiktok': ['detox'],
      'ly-ete': ['cabinet', 'fastfood'],
      'ly-eloquence': ['coach', 'go'],
      'ly-harcelement': ['adulte'],
      'ly-ordi': ['cdi'],
      'ly-maison': ['parler'],
      'ly-orientation': ['grande', 'fac'],
      'ly-bac': ['stage', 'seul'],
      'un-parcoursup': ['prepa', 'licence', 'commerce', 'court', 'alternance'],
      'un-logement': ['coloc', 'crous', 'studio'],
      'un-bourse': ['dossier', 'parents'],
      'un-job': ['cours', 'babysit'],
      'un-partiels': ['fiches', 'bachoter'],
      'un-erasmus': ['bourse', 'partir'],
      'un-bde': ['benevole'],
      'un-stage': ['piston', 'candidater'],
      'un-burnout': ['sport'],
      'un-startup': ['aider'],
      'un-pret': ['non'],
      'un-afterwork': ['costume', 'linkedin'],
      'un-concours': ['go'],
      'un-master': ['master', 'concours', 'reviser'],
      'tr-emploi': ['cadre', 'piston', 'technicien', 'employe', 'ouvrier'],
      'tr-augmentation': ['negocier', 'pole'],
      'tr-promotion': ['postuler', 'interim'],
      'tr-licenciement': ['resister', 'postuler'],
      'tr-investir': ['livret'],
      'tr-reseau': ['afterwork'],
      'tr-burnout': ['arret'],
      'tr-famille': ['famille'],
      'tr-chasseur': ['accepter'],
      'tr-side': ['asso'],
      'tr-levee': ['non'],
      'tr-reconversion': ['vae'],
      'tr-greve': ['greve'],
      'tr-bilan': ['immo', 'formation'],
    };
    return (pref[situation] ?? []).find((id) => open.includes(id)) ?? open[0];
  }

  it('reproduction sociale : au hasard, la classe d’origine pèse lourd', () => {
    const basse = simulate('random', 'basse');
    const riche = simulate('random', 'riche');
    // Au hasard, la plupart des enfants de la classe basse y restent, et aucun ou presque n'atteint le sommet
    expect(basse.basse).toBeGreaterThan(basse.moyenne);
    expect(basse.riche).toBeLessThanOrEqual(3);
    // Les enfants de la classe riche restent le plus souvent en haut
    expect(riche.riche).toBeGreaterThanOrEqual(45);
  });

  it('ascension : avec de bons choix, la classe basse peut monter', () => {
    const basse = simulate('smart', 'basse');
    const moyenne = simulate('smart', 'moyenne');
    // Avec de bons choix, monter d'une classe est atteignable…
    expect(basse.moyenne + basse.riche).toBeGreaterThanOrEqual(40);
    // …mais atteindre le sommet depuis le bas reste rare
    expect(basse.riche).toBeLessThan(12);
    // Les enfants de la classe moyenne qui jouent parfaitement peuvent atteindre le sommet
    expect(moyenne.riche).toBeGreaterThan(30);
  });
});
