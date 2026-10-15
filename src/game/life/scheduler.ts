/**
 * Minuteries du jeu, toutes suspendables d'un coup (pause de la régie).
 * Chaque tâche a une clé : la reprogrammer remplace l'ancienne.
 */
export class Scheduler {
  private readonly tasks = new Map<string, { at: number; fn: () => void; timer: NodeJS.Timeout | null }>();
  private pausedAt: number | null = null;

  constructor(private readonly now: () => number = Date.now) {}

  get paused(): boolean {
    return this.pausedAt !== null;
  }

  /** Programme fn dans ms millisecondes ; renvoie l'heure prévue */
  at(key: string, ms: number, fn: () => void): number {
    this.cancel(key);
    const at = (this.pausedAt ?? this.now()) + ms;
    const task = { at, fn, timer: null as NodeJS.Timeout | null };
    this.tasks.set(key, task);
    if (!this.paused) this.arm(key, task);
    return at;
  }

  cancel(key: string): void {
    const t = this.tasks.get(key);
    if (t?.timer) clearTimeout(t.timer);
    this.tasks.delete(key);
  }

  has(key: string): boolean {
    return this.tasks.has(key);
  }

  /** Exécute une tâche tout de suite (si elle existe) */
  runNow(key: string): boolean {
    const t = this.tasks.get(key);
    if (!t) return false;
    this.cancel(key);
    t.fn();
    return true;
  }

  pause(): void {
    if (this.paused) return;
    this.pausedAt = this.now();
    for (const t of this.tasks.values()) {
      if (t.timer) clearTimeout(t.timer);
      t.timer = null;
    }
  }

  /** Reprend toutes les tâches ; renvoie la durée de la pause (pour décaler les heures affichées) */
  resume(): number {
    if (this.pausedAt === null) return 0;
    const shift = this.now() - this.pausedAt;
    this.pausedAt = null;
    for (const [key, t] of this.tasks) {
      t.at += shift;
      this.arm(key, t);
    }
    return shift;
  }

  clear(): void {
    for (const t of this.tasks.values()) if (t.timer) clearTimeout(t.timer);
    this.tasks.clear();
  }

  private arm(key: string, task: { at: number; fn: () => void; timer: NodeJS.Timeout | null }) {
    task.timer = setTimeout(
      () => {
        if (this.tasks.get(key) !== task) return;
        this.tasks.delete(key);
        task.fn();
      },
      Math.max(0, task.at - this.now()),
    );
  }
}
