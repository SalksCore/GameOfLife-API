import { describe, expect, it } from 'vitest';
import type { GameInput, SocialClass } from '../protocol.js';
import { buildDeck, DEFAULT_CARDS } from './content.js';
import { ExposeGame, type GameMember } from './game.js';

/** Générateur pseudo-aléatoire reproductible */
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

type Bot = 'hasard' | 'stratege';

/** Joue une partie complète ; renvoie les personnages et la classe finale */
function play(n: number, seed: number, bots: (i: number) => Bot) {
  const rnd = seeded(seed);
  const members = new Map<string, GameMember>();
  for (let i = 0; i < n; i++) members.set(`p${i}`, { id: `p${i}`, displayName: `J${i}`, avatar: '🙂', color: 'violet', connected: true });
  const game = new ExposeGame(
    buildDeck(null),
    DEFAULT_CARDS,
    [...members.values()],
    new Map(),
    new Map(),
    { yearSeconds: 60, distribution: 'realiste', addressEffect: true },
    () => members,
    { players: () => {}, live: () => {} },
    rnd,
  );
  game.start();
  const act = (id: string, input: GameInput) => game.input(id, input);
  const lectures: string[] = [];
  let guard = 0;
  while (guard++ < 200) {
    const step = game.step;
    for (const [id] of members) {
      const v = game.playerView(id);
      const bot = bots(Number(id.slice(1)));
      if (v.poll?.open) v.poll.questions.forEach((q, i) => act(id, { type: 'poll', question: i, option: Math.floor(rnd() * q.options.length) }));
      if (v.vote?.open) act(id, { type: 'vote', optionId: v.vote.options[Math.floor(rnd() * 4)]!.id });
      if (v.year?.phase === 'open' && !v.year.submitted) {
        const free = v.year.totalTokens - v.year.forced.reduce((s, f) => s + f.count, 0);
        const cats = v.year.categories.map((c) => c.id);
        const t: Record<string, number> = {};
        if (bot === 'stratege') {
          const plan = v.year.stage === 'travail' ? ['travail', 'travail', 'travail', 'reseau', 'reseau', 'repos'] : ['etudes', 'etudes', 'etudes', 'repos', 'amis', 'engagement'];
          for (const k of plan.slice(0, free)) t[k] = (t[k] ?? 0) + 1;
        } else for (let k = 0; k < free; k++) t[cats[Math.floor(rnd() * cats.length)]!] = (t[cats[Math.floor(rnd() * cats.length)]!] ?? 0) + 1;
        act(id, { type: 'tokens', tokens: t });
        const open = v.year.decision.options.filter((o) => !o.locked);
        const pref = bot === 'stratege' ? ['sciences', 'cordees', 'orientation', 'coaching', 'master', 'piston', 'seul', 'promotion', 'concours-interne', 'chercher', 'entreprise', 'vae'] : [];
        const pick = open.find((o) => pref.includes(o.id)) ?? open[Math.floor(rnd() * open.length)];
        if (pick) act(id, { type: 'decide', optionId: pick.id });
        // Mini-jeu : une option ouverte au hasard pour chaque élément
        for (const it of v.year.mini?.items ?? []) {
          const free = it.options.filter((o) => !o.locked);
          if (free.length) act(id, { type: 'mini', item: it.id, option: free[Math.floor(rnd() * free.length)]!.id });
        }
        act(id, { type: 'submit' });
      }
      if (v.parcoursup?.phase === 'wishes' && v.parcoursup.eligible && !v.parcoursup.submitted) {
        const ok = v.parcoursup.formations.filter((f) => !f.locked).map((f) => f.id);
        const wishes = bot === 'stratege' ? ok.slice(0, 5) : ok.sort(() => rnd() - 0.5).slice(0, 3);
        act(id, { type: 'wishes', wishes, bourse: bot === 'stratege' || rnd() < 0.5, submit: true });
      }
      if (v.parcoursup?.phase === 'results' && v.parcoursup.response === null) {
        const first = v.parcoursup.results.find((r) => r.status === 'admis');
        act(id, { type: 'response', accept: bot === 'stratege' ? null : (first?.formation ?? null) });
      }
      if (v.jobs?.phase === 'aim' && !v.jobs.choice) {
        const open = v.jobs.options.filter((o) => !o.locked).map((o) => o.id);
        act(id, { type: 'job', optionId: bot === 'stratege' ? (open.includes('promesse') ? 'promesse' : open.includes('concours') ? 'concours' : 'haut') : open[Math.floor(rnd() * open.length)]! });
      }
    }
    if (step.kind === 'final') {
      for (let r = 0; r < 4; r++) game.control('reveal');
      if (!game.control('reveal') && game.screenStep().kind === 'debrief') lectures.push(step.id);
      game.control('reveal');
      break;
    }
    game.control('reveal');
    // Résultats déjà affichés : R montre directement la lecture (débrief) ; sinon, c'est le second appui
    if (game.screenStep().kind === 'debrief') lectures.push(step.id);
    else if (!game.control('reveal') && game.screenStep().kind === 'debrief') lectures.push(step.id);
    if (game.control('next')) break;
  }
  const screen = game.screenStep();
  game.dispose();
  return { game, screen, lectures };
}

describe('ExposeGame', () => {
  it('enchaîne les étapes jusqu’à la pyramide', () => {
    const { screen, game, lectures } = play(24, 7, () => 'hasard');
    expect(screen.kind).toBe('final');
    if (screen.kind !== 'final') return;
    const total = Object.values(screen.final.pyramid).reduce((s, l) => s + l.length, 0);
    expect(total).toBe(24);
    expect(game.exportData({ name: 'T', code: 'ABC' }).rows).toHaveLength(24);
    // Les lectures (débrief) s'affichent après les résultats de chaque partie
    expect(lectures.sort()).toEqual(['bac', 'diplomes', 'emploi', 'etudes2', 'ps-affectations', 'pyramide', 'premiere', 'terminale'].sort());
  });

  it('équilibrage : des obstacles, pas une fatalité (J15)', () => {
    const tally: Record<Bot, Record<SocialClass, { n: number; up: number; down: number; top: number; stay: number }>> = {
      hasard: { populaire: { n: 0, up: 0, down: 0, top: 0, stay: 0 }, moyenne: { n: 0, up: 0, down: 0, top: 0, stay: 0 }, superieure: { n: 0, up: 0, down: 0, top: 0, stay: 0 } },
      stratege: { populaire: { n: 0, up: 0, down: 0, top: 0, stay: 0 }, moyenne: { n: 0, up: 0, down: 0, top: 0, stay: 0 }, superieure: { n: 0, up: 0, down: 0, top: 0, stay: 0 } },
    };
    const order = { populaire: 0, moyenne: 1, superieure: 2 };
    {
      for (let seed = 1; seed <= 60; seed++) {
        const kind = (i: number): Bot => (i % 2 ? 'stratege' : 'hasard');
        const { game } = play(30, seed * 97, kind);
        const data = game.exportData({ name: 'T', code: 'X' });
        for (const [k, row] of data.rows.entries()) {
          const bot = kind(Number(String(row.joueur).slice(1)));
          void k;
          const o = (Object.entries({ populaire: 'Classe populaire', moyenne: 'Classe moyenne', superieure: 'Classe supérieure' }).find(([, l]) => l === row.origine)![0]) as SocialClass;
          const f = (Object.entries({ populaire: 'Classe populaire', moyenne: 'Classe moyenne', superieure: 'Classe supérieure' }).find(([, l]) => l === row.classe_finale)![0]) as SocialClass;
          const t = tally[bot][o];
          t.n++;
          if (order[f] > order[o]) t.up++;
          if (order[f] < order[o]) t.down++;
          if (f === 'superieure') t.top++;
          if (f === o) t.stay++;
        }
      }
    }
    const pct = (a: number, b: number) => Math.round((a / Math.max(1, b)) * 100);
    const h = tally.hasard;
    const s = tally.stratege;
    // Affiché pour l'équilibrage (npx vitest run --reporter verbose)
    console.log(
      [
        `Populaire, hasard, restent : ${pct(h.populaire.stay, h.populaire.n)} % (cible 70-80)`,
        `Populaire, stratège, montent : ${pct(s.populaire.up, s.populaire.n)} % (cible 45-60)`,
        `Populaire, stratège, supérieure : ${pct(s.populaire.top, s.populaire.n)} % (cible 5-10)`,
        `Moyenne, stratège, supérieure : ${pct(s.moyenne.top, s.moyenne.n)} % (cible 35-50)`,
        `Moyenne, hasard, descendent : ${pct(h.moyenne.down, h.moyenne.n)} % (cible 25-35)`,
        `Supérieure, hasard, restent : ${pct(h.superieure.stay, h.superieure.n)} % (cible 75-90)`,
      ].join('\n'),
    );
    // Un bon joueur populaire doit pouvoir progresser
    expect(s.populaire.up).toBeGreaterThan(0);
    // Un joueur supérieur au hasard reste le plus souvent en haut
    expect(pct(h.superieure.stay, h.superieure.n)).toBeGreaterThan(50);
  });
});
