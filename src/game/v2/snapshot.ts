/**
 * Sérialisation de l'état d'une partie (Map et Set compris) pour la sauvegarde en base.
 * JSON pur : { "__m": [[clé, valeur]…] } pour une Map, { "__s": […] } pour un Set.
 */
export function encode(v: unknown): unknown {
  if (v instanceof Map) return { __m: [...v].map(([k, x]) => [k, encode(x)]) };
  if (v instanceof Set) return { __s: [...v].map(encode) };
  if (Array.isArray(v)) return v.map(encode);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encode(x)]));
  return v;
}

export function decode(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(decode);
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.__m) && Object.keys(o).length === 1) return new Map((o.__m as [unknown, unknown][]).map(([k, x]) => [k, decode(x)]));
    if (Array.isArray(o.__s) && Object.keys(o).length === 1) return new Set((o.__s as unknown[]).map(decode));
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, decode(x)]));
  }
  return v;
}
