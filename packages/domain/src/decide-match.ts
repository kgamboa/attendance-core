/**
 * decide-match.ts — Decisión pura por rostro: registra solo, pide confirmar o pide nombre.
 * Sin I/O: Rekognition entrega los candidatos y esta función decide con las políticas del tenant.
 */

export interface FaceCandidate {
  employeeId: string;
  /** Similitud 0–100 de Rekognition. */
  similarity: number;
}

export type MatchDecision =
  | { kind: 'AUTO'; employeeId: string; similarity: number }
  | { kind: 'NEEDS_CONFIRMATION'; candidates: FaceCandidate[] }
  | { kind: 'UNKNOWN' };

export interface DecideMatchOptions {
  thresholdAuto: number;
  thresholdConfirm: number;
  /** Si el segundo candidato queda a menos de esta distancia del primero, no se registra solo. */
  ambiguityMargin?: number;
  maxCandidates?: number;
}

export function decideMatch(raw: FaceCandidate[], opts: DecideMatchOptions): MatchDecision {
  const margin = opts.ambiguityMargin ?? 1;
  const max = opts.maxCandidates ?? 3;

  // Una persona puede tener varias caras indexadas: se queda con su mejor similitud.
  const best = new Map<string, number>();
  for (const c of raw) {
    const prev = best.get(c.employeeId);
    if (prev === undefined || c.similarity > prev) best.set(c.employeeId, c.similarity);
  }
  const sorted = [...best.entries()]
    .map(([employeeId, similarity]) => ({ employeeId, similarity }))
    .sort((a, b) => b.similarity - a.similarity);

  const top = sorted[0];
  if (!top || top.similarity < opts.thresholdConfirm) return { kind: 'UNKNOWN' };

  const second = sorted[1];
  const ambiguous = !!second && top.similarity - second.similarity < margin && second.similarity >= opts.thresholdConfirm;
  if (top.similarity >= opts.thresholdAuto && !ambiguous) {
    return { kind: 'AUTO', employeeId: top.employeeId, similarity: top.similarity };
  }
  return {
    kind: 'NEEDS_CONFIRMATION',
    candidates: sorted.filter((c) => c.similarity >= opts.thresholdConfirm).slice(0, max),
  };
}
