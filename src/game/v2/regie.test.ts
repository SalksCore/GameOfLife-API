import { describe, expect, it } from 'vitest';
import { buildDeck, COLLECTIVE_EVENTS, DEFAULT_CARDS } from './content.js';
import { ExposeGame, type GameMember } from './game.js';

function setup() {
  let s = 7;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const members = new Map<string, GameMember>();
  for (let i = 0; i < 6; i++) members.set(`p${i}`, { id: `p${i}`, displayName: `J${i}`, avatar: '🙂', color: 'violet', connected: true });
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
  // Avance jusqu'au tirage des familles
  for (let i = 0; i < 30 && game.controlView().characters.length === 0; i++) game.control('next');
  return game;
}

describe('Régie : événements et édition', () => {
  it('propose au moins dix événements, tous reconnus', () => {
    expect(COLLECTIVE_EVENTS.length).toBeGreaterThanOrEqual(10);
    const game = setup();
    for (const ev of COLLECTIVE_EVENTS) {
      const err = game.event(ev.id);
      // Certains ne valent qu'à une période précise : jamais « inconnu »
      expect(err ?? '').not.toMatch(/inconnu/);
    }
    expect(game.event('nimporte')).toMatch(/inconnu/);
  });

  it('les événements touchent les bonnes familles', () => {
    const game = setup();
    const before = new Map(game.controlView().characters.map((c) => [c.id, c]));
    expect(game.event('reseau')).toBeNull();
    for (const c of game.controlView().characters) {
      const gain = { populaire: 0, moyenne: 1, superieure: 2 }[c.origin];
      expect(c.contacts - before.get(c.id)!.contacts).toBe(gain);
    }
  });

  it('modifie un joueur à la main et refuse un patch vide', () => {
    const game = setup();
    const c = game.controlView().characters[0]!;
    expect(game.edit(c.id, {})).toMatch(/Rien/);
    expect(game.edit(c.id, { budget: 12_345, grade: 15.5, contacts: 7, energy: 2, boursier: true, school: 'elite' })).toBeNull();
    const after = game.controlView().characters.find((x) => x.id === c.id)!;
    expect(after).toMatchObject({ budget: 12_345, grade: 15.5, contacts: 7, energy: 2, boursier: true, schoolId: 'elite' });
    expect(game.edit('inconnu', { budget: 1 })).toMatch(/introuvable/);
  });
});
