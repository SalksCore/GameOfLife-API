/**
 * Parcoursup simulé, collectif : tous les joueurs candidatent en même temps à des formations
 * dont le nombre de places dépend du nombre de joueurs.
 *
 * Phase 1 : chaque formation classe ses candidats -> admis / en attente / refusé.
 * Réponses : accepter définitivement une offre, ou la garder et attendre mieux.
 * Phase finale : les places libérées passent aux suivants (acceptation différée, stable),
 * puis phase complémentaire pour ceux qui n'ont rien.
 */
import type { WishStatus } from '../protocol.js';
import { FORMATIONS, FORMATION_IDS, SCHOOLS, clamp, type Character, type FormationId } from './model.js';
import type { ReformId } from './years.js';

/** Places de chaque formation (au moins 1) */
export function capacities(n: number): Record<FormationId, number> {
  const out = {} as Record<FormationId, number>;
  for (const id of FORMATION_IDS) out[id] = Math.max(1, Math.round(FORMATIONS[id].share * n));
  return out;
}

/** Visible dans la liste des vœux ? (inégalité d'information) */
export function visible(c: Character, id: FormationId, reform: ReformId | null): boolean {
  return !FORMATIONS[id].needsInfo || c.info || reform === 'info';
}

/** Raison pour laquelle le vœu est impossible, ou null */
export function eligibility(c: Character, id: FormationId): string | null {
  const f = FORMATIONS[id];
  if (!c.bac || c.bac === 'aucun') return 'Il faut le bac';
  if (f.needsGeneralBac && c.bac !== 'general') return 'Il faut un bac général';
  if (f.fit[c.specialty ?? 'ses'] === 0) return 'Tes spécialités ne correspondent pas';
  return null;
}

/** Note du dossier (0-1) : moyenne, spécialités, lycée, lettre, engagements */
export function dossier(c: Character, id: FormationId, reform: ReformId | null): number {
  const f = FORMATIONS[id];
  const grade = clamp((c.bacGrade - 8) / 10, 0, 1);
  const fit = f.fit[c.specialty ?? 'ses'];
  const school = SCHOOLS[c.school].reputation / 3;
  const engagement = Math.min(1, c.engagement / 4);
  let score =
    id === 'alternance'
      ? 0.35 * grade + 0.45 * (c.contacts / 10) + 0.2 * fit // une entreprise doit t'accepter : le réseau compte
      : 0.6 * grade + 0.15 * fit + 0.1 * school + 0.1 * c.letter + 0.05 * engagement;
  // Quota de boursiers dans les formations publiques sélectives (renforcé par la réforme « quotas »)
  if (f.quota && c.boursier) score += reform === 'quotas' ? 0.25 : 0.08;
  // Places réservées aux bacs pros en BTS
  if (id === 'bts' && c.track === 'pro') score += 0.3;
  return score;
}

export interface PhaseOneResult {
  /** joueur -> formation -> statut et rang d'attente */
  results: Map<string, { formation: FormationId; status: WishStatus; rank: number | null }[]>;
  /** formation -> admis en phase 1 */
  admitted: Map<FormationId, string[]>;
}

export function phaseOne(chars: Character[], wishes: Map<string, FormationId[]>, reform: ReformId | null): PhaseOneResult {
  const cap = capacities(chars.length);
  const byId = new Map(chars.map((c) => [c.id, c]));
  const results = new Map<string, { formation: FormationId; status: WishStatus; rank: number | null }[]>();
  const admitted = new Map<FormationId, string[]>();
  const ranking = new Map<FormationId, string[]>();

  for (const id of FORMATION_IDS) {
    const applicants = chars.filter((c) => wishes.get(c.id)?.includes(id) && !eligibility(c, id));
    applicants.sort((a, b) => dossier(b, id, reform) - dossier(a, id, reform));
    ranking.set(id, applicants.map((c) => c.id));
    admitted.set(id, applicants.slice(0, cap[id]).map((c) => c.id));
  }

  for (const c of chars) {
    const list = (wishes.get(c.id) ?? []).map((formation) => {
      const order = ranking.get(formation) ?? [];
      const pos = order.indexOf(c.id);
      if (pos < 0) return { formation, status: 'refuse' as const, rank: null };
      if (pos < cap[formation]) return { formation, status: 'admis' as const, rank: null };
      // Liste d'attente « réaliste » : au-delà de trois fois les places, refus
      if (pos < cap[formation] * 3 || !FORMATIONS[formation].selective) return { formation, status: 'attente' as const, rank: pos - cap[formation] + 1 };
      return { formation, status: 'refuse' as const, rank: null };
    });
    results.set(c.id, list);
  }
  void byId;
  return { results, admitted };
}

/**
 * Attribution finale. accepted : joueur -> formation acceptée définitivement en phase 1.
 * Les autres reçoivent le meilleur vœu possible (acceptation différée) ; ceux qui n'ont rien
 * passent en phase complémentaire (places restantes), sinon entrent dans la vie active.
 */
export function finalAssignment(
  chars: Character[],
  wishes: Map<string, FormationId[]>,
  accepted: Map<string, FormationId>,
  reform: ReformId | null,
): Map<string, FormationId | 'vie_active'> {
  const cap = capacities(chars.length);
  const out = new Map<string, FormationId | 'vie_active'>();
  const held = new Map<FormationId, string[]>(FORMATION_IDS.map((id) => [id, []]));
  const byId = new Map(chars.map((c) => [c.id, c]));

  for (const [cid, f] of accepted) {
    out.set(cid, f);
    held.get(f)!.push(cid);
  }

  // Acceptation différée : chaque candidat propose à ses vœux dans l'ordre
  const free = chars.filter((c) => !accepted.has(c.id)).map((c) => c.id);
  const next = new Map(free.map((id) => [id, 0]));
  const queue = [...free];
  while (queue.length) {
    const cid = queue.shift()!;
    const c = byId.get(cid)!;
    const list = (wishes.get(cid) ?? []).filter((f) => !eligibility(c, f));
    const i = next.get(cid)!;
    if (i >= list.length) continue;
    next.set(cid, i + 1);
    const f = list[i]!;
    const seats = held.get(f)!;
    seats.push(cid);
    // Les candidats définitifs gardent leur place ; on retire le moins bien classé des autres
    if (seats.length > cap[f]) {
      const removable = seats.filter((id) => !accepted.has(id));
      if (!removable.length) {
        seats.pop();
        queue.push(cid);
        continue;
      }
      removable.sort((a, b) => dossier(byId.get(a)!, f, reform) - dossier(byId.get(b)!, f, reform));
      const out1 = removable[0]!;
      seats.splice(seats.indexOf(out1), 1);
      queue.push(out1);
    }
  }
  for (const [f, seats] of held) for (const cid of seats) out.set(cid, f);

  // Phase complémentaire : places restantes, dans l'ordre licence, BUT, BTS
  for (const c of chars) {
    if (out.has(c.id)) continue;
    const fallback = (['licence', 'but', 'bts'] as FormationId[]).find((f) => !eligibility(c, f) && held.get(f)!.length < cap[f] + (f === 'licence' ? chars.length : 0));
    if (fallback) {
      out.set(c.id, fallback);
      held.get(fallback)!.push(c.id);
    } else out.set(c.id, 'vie_active');
  }
  return out;
}
