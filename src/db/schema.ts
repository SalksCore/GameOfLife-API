import { index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// ============ Comptes ADMINS (utilisés par ADMIN) ============

export const admins = pgTable('admins', {
  id: uuid('id').primaryKey().defaultRandom(),
  username: text('username').notNull(),
  usernameKey: text('username_key').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  disabledAt: timestamp('disabled_at', { withTimezone: true }),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const adminSessions = pgTable(
  'admin_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('admin_id')
      .notNull()
      .references(() => admins.id, { onDelete: 'cascade' }),
    // On ne stocke jamais le refresh token en clair, seulement son SHA-256
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('admin_sessions_admin_idx').on(t.accountId)],
);

/** Journal des actions d'administration (qui a fait quoi) */
export const adminActions = pgTable(
  'admin_actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    adminId: uuid('admin_id').references(() => admins.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    target: text('target'),
    /** Joueur concerné (permet d'afficher l'historique de modération sur son profil) */
    playerId: uuid('player_id'),
    details: text('details'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('admin_actions_created_idx').on(t.createdAt), index('admin_actions_player_idx').on(t.playerId)],
);

/** Paramètres du jeu modifiables depuis ADMIN (une ligne par section) */
export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedBy: uuid('updated_by').references(() => admins.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Relevé périodique de l'activité (graphiques de fréquentation) */
export const statsSnapshots = pgTable(
  'stats_snapshots',
  {
    at: timestamp('at', { withTimezone: true }).primaryKey(),
    connectedPlayers: integer('connected_players').notNull(),
    openRooms: integer('open_rooms').notNull(),
    gamesInProgress: integer('games_in_progress').notNull(),
  },
);

// ============ Comptes JOUEURS (créés par un admin, utilisés par PHONE) ============

export const players = pgTable('players', {
  id: uuid('id').primaryKey().defaultRandom(),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  /** Identifiant généré : 1re lettre du nom + prénom (ex. Jean Dupont -> djean) */
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  /** Personnalisation choisie par le joueur (liste fermée côté serveur) */
  avatar: text('avatar').notNull().default('🙂'),
  color: text('color').notNull().default('violet'),
  gamesPlayed: integer('games_played').notNull().default(0),
  bannedAt: timestamp('banned_at', { withTimezone: true }),
  bannedReason: text('banned_reason'),
  /** Notes internes, visibles uniquement par les admins */
  notes: text('notes').notNull().default(''),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdBy: uuid('created_by').references(() => admins.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Historique des connexions réussies des joueurs */
export const playerLogins = pgTable(
  'player_logins',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    ip: text('ip'),
    userAgent: text('user_agent'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('player_logins_player_idx').on(t.playerId, t.at), index('player_logins_at_idx').on(t.at)],
);

export const playerSessions = pgTable(
  'player_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('player_sessions_player_idx').on(t.accountId)],
);

// ============ Sauvegarde des parties ============

export const games = pgTable(
  'games',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    createdBy: uuid('created_by').references(() => admins.id, { onDelete: 'set null' }),
    playerCount: integer('player_count').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('games_ended_idx').on(t.endedAt)],
);

export const gamePlayers = pgTable(
  'game_players',
  {
    gameId: uuid('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.gameId, t.playerId] }), index('game_players_player_idx').on(t.playerId)],
);

export type Player = typeof players.$inferSelect;
export type Admin = typeof admins.$inferSelect;
