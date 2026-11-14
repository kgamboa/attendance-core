/**
 * rotation.ts — Reglas de rotación de personal (lógica pura).
 *
 * Una inasistencia cuenta cuando la sesión se cierra con la persona como ABSENT (no JUSTIFIED).
 * Asistir reinicia el contador y cancela una pre-baja pendiente.
 * Con `autoBaja=false` la baja definitiva la decide HR; aquí solo se marca "recomendar baja".
 */
import type { AttendancePolicy, Employee } from './model';

export type RotationOutcome =
  | { action: 'NONE'; missCount: number }
  | { action: 'PRE_TERMINATION'; missCount: number }
  | { action: 'RECOMMEND_TERMINATION'; missCount: number }
  | { action: 'TERMINATE'; missCount: number }
  | { action: 'CANCEL_PRE_TERMINATION'; missCount: 0 };

type RotationInput = Pick<Employee, 'status' | 'missCount'>;

export function applyAttendance(emp: RotationInput): RotationOutcome {
  if (emp.status === 'PRE_TERMINATION') return { action: 'CANCEL_PRE_TERMINATION', missCount: 0 };
  return { action: 'NONE', missCount: 0 };
}

export function applyAbsence(emp: RotationInput, policy: AttendancePolicy['rotation']): RotationOutcome {
  const missCount = (emp.missCount ?? 0) + 1;
  if (emp.status === 'INACTIVE' || policy.preBajaAfterMisses <= 0) return { action: 'NONE', missCount };

  if (emp.status === 'ACTIVE') {
    if (missCount >= policy.preBajaAfterMisses) return { action: 'PRE_TERMINATION', missCount };
    return { action: 'NONE', missCount };
  }

  // PRE_TERMINATION: cuenta las inasistencias posteriores a la pre-baja.
  const sincePre = missCount - policy.preBajaAfterMisses;
  if (sincePre >= policy.bajaAfterMoreMisses) {
    return { action: policy.autoBaja ? 'TERMINATE' : 'RECOMMEND_TERMINATION', missCount };
  }
  return { action: 'NONE', missCount };
}
