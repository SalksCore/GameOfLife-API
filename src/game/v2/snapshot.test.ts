import { describe, expect, it } from 'vitest';
import { buildDeck, DEFAULT_CARDS } from './content.js';
import { ExposeGame, type GameMember } from './game.js';

describe('Sauvegarde et reprise d’une partie', () => {
  it('une partie coupée en pleine Terminale reprend à l’identique, en pause', () => {
    const members = new Map<string, GameMember>();
    for (let i = 0; i < 8; i++) members.set(`p${i}`, { id: `p${i}`, displayName: `J${i}`, avatar: '🙂', color: 'violet', connected: true });
    const deck = buildDeck(null);
    const config = { yearSeconds: 60, distribution: 'realiste' as const, addressEffect: true };
    const hooks = { players: () => {}, live: () => {} };
    const game = new ExposeGame(deck, DEFAULT_CARDS, [...members.values()], new Map(), new Map(), config, () => members, hooks);
    game.start();
    // Avance jusqu'à la Terminale, joueurs ayant placé des jetons
    while (game.step.id !== 'terminale') game.control('next');
    game.input('p0', { type: 'tokens', tokens: { etudes: 3, repos: 2 } });

    // « Crash » : passage par JSON comme en base
    const saved = JSON.parse(JSON.stringify(game.snapshot()));
    game.dispose();
    const back = ExposeGame.restore(saved, { deck, cards: DEFAULT_CARDS, roles: new Map(), config, getMembers: () => members, hooks });

    expect(back.step.id).toBe('terminale');
    expect(back.playerView('p0').timer.paused).toBe(true);
    expect(back.playerView('p0').year?.tokens).toEqual({ etudes: 3, repos: 2 });
    expect(back.playerView('p0').character?.origin).toBe(game.playerView('p0').character?.origin);

    // La partie continue jusqu'à la fin
    back.control('resume');
    let guard = 0;
    while (back.step.kind !== 'final' && guard++ < 80) {
      back.control('reveal');
      back.control('next');
    }
    expect(back.step.kind).toBe('final');
    back.dispose();
  });
});
