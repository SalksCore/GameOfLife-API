/**
 * Verrouillage par identifiant (en plus du rate-limit par IP) :
 * après MAX_FAILURES échecs en WINDOW_MS, le compte est bloqué LOCK_MS.
 * Protège contre le bruteforce distribué sur plusieurs IP.
 */
const MAX_FAILURES = 8;
const WINDOW_MS = 15 * 60_000;
const LOCK_MS = 15 * 60_000;
const MAX_ENTRIES = 50_000;

interface Entry {
  failures: number;
  firstAt: number;
  lockedUntil: number;
}

const entries = new Map<string, Entry>();

/** Secondes restantes de verrouillage (0 si libre). */
export function lockRemaining(key: string): number {
  const e = entries.get(key);
  if (!e) return 0;
  const now = Date.now();
  if (e.lockedUntil > now) return Math.ceil((e.lockedUntil - now) / 1000);
  if (now - e.firstAt > WINDOW_MS) entries.delete(key);
  return 0;
}

export function recordFailure(key: string): void {
  const now = Date.now();
  let e = entries.get(key);
  if (!e || now - e.firstAt > WINDOW_MS) {
    if (entries.size >= MAX_ENTRIES) entries.delete(entries.keys().next().value!);
    e = { failures: 0, firstAt: now, lockedUntil: 0 };
    entries.set(key, e);
  }
  if (++e.failures >= MAX_FAILURES) e.lockedUntil = now + LOCK_MS;
}

export function recordSuccess(key: string): void {
  entries.delete(key);
}
