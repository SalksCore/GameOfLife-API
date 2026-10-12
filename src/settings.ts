import { EventEmitter } from 'node:events';
import { z } from 'zod';
import { db } from './db/client.js';
import { settings as settingsTable } from './db/schema.js';
import { LIMITS } from './game/protocol.js';

/**
 * Paramètres modifiables depuis ADMIN, stockés en base et gardés en mémoire
 * (lecture instantanée à chaque requête, aucune requête SQL).
 */

export const generalSchema = z.object({
  gameName: z.string().trim().min(1).max(40),
  welcomeMessage: z.string().trim().max(200),
  defaultMaxPlayers: z.number().int().min(LIMITS.maxPlayersMin).max(LIMITS.maxPlayersMax),
  maxOpenRooms: z.number().int().min(1).max(2_000),
  idleTimeoutHours: z.number().int().min(1).max(72),
  chatEnabled: z.boolean(),
});

export const maintenanceSchema = z.object({
  enabled: z.boolean(),
  message: z.string().trim().max(300),
  /** Fin estimée (ISO 8601), affichée aux joueurs */
  endsAt: z.iso.datetime({ offset: true }).nullable(),
});

export type GeneralSettings = z.infer<typeof generalSchema>;
export type MaintenanceSettings = z.infer<typeof maintenanceSchema> & { since: string | null };

interface Sections {
  general: GeneralSettings;
  maintenance: MaintenanceSettings;
}

const DEFAULTS: Sections = {
  general: {
    gameName: 'GameOfLife',
    welcomeMessage: '',
    defaultMaxPlayers: 30,
    maxOpenRooms: 500,
    idleTimeoutHours: 6,
    chatEnabled: true,
  },
  maintenance: {
    enabled: false,
    message: 'Le jeu est en maintenance. Nous revenons très vite !',
    endsAt: null,
    since: null,
  },
};

type Key = keyof Sections;

const current: Sections = structuredClone(DEFAULTS);
const meta: Record<Key, { updatedAt: Date | null; updatedBy: string | null }> = {
  general: { updatedAt: null, updatedBy: null },
  maintenance: { updatedAt: null, updatedBy: null },
};

/** Événements : 'maintenance' (MaintenanceSettings), 'general' (GeneralSettings) */
export const settingsEvents = new EventEmitter();

export async function loadSettings(): Promise<void> {
  const rows = await db.select().from(settingsTable);
  for (const row of rows) {
    if (row.key !== 'general' && row.key !== 'maintenance') continue;
    // Fusion avec les valeurs par défaut : un nouveau paramètre ajouté plus tard a toujours une valeur
    Object.assign(current[row.key], row.value as object);
    meta[row.key] = { updatedAt: row.updatedAt, updatedBy: row.updatedBy };
  }
}

export const getGeneral = (): Readonly<GeneralSettings> => current.general;
export const getMaintenance = (): Readonly<MaintenanceSettings> => current.maintenance;
export const getSettingsMeta = () => meta;

async function save<K extends Key>(key: K, value: Sections[K], adminId: string) {
  const now = new Date();
  await db
    .insert(settingsTable)
    .values({ key, value, updatedBy: adminId, updatedAt: now })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value, updatedBy: adminId, updatedAt: now } });
  meta[key] = { updatedAt: now, updatedBy: adminId };
}

export async function updateGeneral(value: GeneralSettings, adminId: string): Promise<GeneralSettings> {
  await save('general', value, adminId);
  current.general = value;
  settingsEvents.emit('general', value);
  return value;
}

export async function updateMaintenance(
  input: z.infer<typeof maintenanceSchema>,
  adminId: string,
): Promise<MaintenanceSettings> {
  const wasEnabled = current.maintenance.enabled;
  const value: MaintenanceSettings = {
    ...input,
    since: input.enabled ? (wasEnabled ? current.maintenance.since : new Date().toISOString()) : null,
  };
  await save('maintenance', value, adminId);
  current.maintenance = value;
  settingsEvents.emit('maintenance', value);
  return value;
}

/** Informations publiques (écran de connexion / maintenance de PHONE) */
export function publicStatus() {
  const m = current.maintenance;
  return {
    gameName: current.general.gameName,
    welcomeMessage: current.general.welcomeMessage,
    maintenance: m.enabled ? { message: m.message, endsAt: m.endsAt, since: m.since } : null,
  };
}
