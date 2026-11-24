import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage, RoomView } from './protocol.js';
import { Room, type GameResult, type RoomOutput } from './room.js';

function setup(maxPlayers = 10) {
  const states = new Map<string, RoomView | null>();
  const chats: { to: string[]; msg: ChatMessage }[] = [];
  const notices: string[] = [];
  const ended: GameResult[] = [];
  const out: RoomOutput = {
    state: (id, v) => states.set(id, v),
    chat: (to, msg) => chats.push({ to, msg }),
    notice: (_id, m) => notices.push(m),
    changed: () => {},
    gameEnded: (r) => ended.push(r),
    leave: (id) => room.leave(id, 'retiré'),
    live: () => {},
  };
  const room: Room = new Room(
    { id: randomUUID(), code: 'ABC234', name: 'Test', maxPlayers, createdBy: randomUUID(), createdByName: 'admin' },
    out,
    { lobbyGrace: 1_000 },
  );
  const player = (n: number) => ({
    id: randomUUID(),
    username: `p${n}`,
    displayName: `Joueur ${n}`,
    avatar: '🙂',
    color: 'violet',
  });
  return { room, states, chats, notices, ended, player };
}

describe('Room', () => {
  it('accepte les joueurs jusqu’à la limite', () => {
    const { room, player, states } = setup(2);
    const [a, b, c] = [player(1), player(2), player(3)];
    expect(room.join(a)).toBeNull();
    expect(room.join(b)).toBeNull();
    expect(room.join(c)).toMatch(/complète/);
    expect(states.get(a.id)!.players).toHaveLength(2);
  });

  it('se lance, refuse les nouveaux joueurs, puis se termine et se sauvegarde', () => {
    const { room, player, ended, states } = setup();
    expect(room.start()).toMatch(/Aucun joueur/);
    const a = player(1);
    room.join(a);
    expect(room.start()).toBeNull();
    expect(states.get(a.id)!.phase).toBe('playing');
    expect(room.join(player(2))).toMatch(/commencé/);
    expect(room.end()).toBeNull();
    expect(ended[0]!.playerIds).toEqual([a.id]);
    expect(room.end()).not.toBeNull();
  });

  it('un joueur reconnecté en cours de partie retrouve sa place', () => {
    const { room, player, states } = setup();
    const a = player(1);
    room.join(a);
    room.start();
    room.disconnect(a.id);
    expect(states.get(a.id)!.players[0]!.connected).toBe(false);
    expect(room.join(a)).toBeNull();
    expect(states.get(a.id)!.players[0]!.connected).toBe(true);
  });

  it('en salle d’attente, un joueur absent trop longtemps est retiré', () => {
    vi.useFakeTimers();
    const { room, player } = setup();
    const a = player(1);
    room.join(a);
    room.disconnect(a.id);
    vi.advanceTimersByTime(1_000);
    expect(room.hasMember(a.id)).toBe(false);
    vi.useRealTimers();
  });

  it('binôme par code : le partenaire hors ligne est ajouté et reste tant que son binôme est là', async () => {
    vi.useFakeTimers();
    const { room, player, states } = setup(3);
    const [a, b] = [player(1), player(2)];
    room.join(a);
    expect(room.pairWithCode(a.id, a)).toMatch(/propre code/);
    expect(room.pairWithCode(a.id, b)).toBeNull();
    const view = states.get(a.id)!;
    expect(view.pairing.partnerId).toBe(b.id);
    expect(view.players.find((p) => p.id === b.id)?.connected).toBe(false);
    // Personne ne le retire : son partenaire joue pour deux
    vi.advanceTimersByTime(5_000);
    expect(states.get(a.id)!.players).toHaveLength(2);
    // Il se connecte plus tard : il retrouve la partie et son binôme
    expect(room.join(b)).toBeNull();
    expect(states.get(b.id)!.pairing.partnerId).toBe(a.id);
    expect(room.pairWithCode(a.id, player(4))).toMatch(/déjà en binôme/);
    // Séparés alors que B est hors ligne : B quitte la salle d'attente
    room.disconnect(b.id);
    room.pairAction(a.id, 'leave', null);
    await Promise.resolve();
    expect(states.get(a.id)!.players.map((p) => p.id)).toEqual([a.id]);
    vi.useRealTimers();
  });

  it('le chat est diffusé à tous les membres, la fermeture prévient les joueurs', () => {
    const { room, player, chats, notices, states } = setup();
    const [a, b] = [player(1), player(2)];
    room.join(a);
    room.join(b);
    expect(room.chat(a.id, '  salut  ')).toBeNull();
    const last = chats.at(-1)!;
    expect(last.msg.text).toBe('salut');
    expect(last.to.sort()).toEqual([a.id, b.id].sort());
    room.close('Fermée');
    expect(states.get(a.id)).toBeNull();
    expect(notices).toContain('Fermée');
  });
});
