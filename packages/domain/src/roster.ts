/**
 * roster.ts — Presentes y faltantes de una sesión (lógica pura).
 */
import type { AttendanceRecord, AttendanceSession, MissingDecision } from './model';

export interface RosterView {
  presentEmployeeIds: string[];
  extras: { recordId: string; name: string }[];
  /** Esperados sin registro de hoy. */
  missingEmployeeIds: string[];
  /** Faltantes sin decisión: bloquean el cierre. */
  undecidedEmployeeIds: string[];
}

export function buildRoster(session: AttendanceSession, records: AttendanceRecord[]): RosterView {
  const superseded = new Set(records.map((r) => r.supersedes).filter((x): x is string => !!x));
  const live = records.filter((r) => !superseded.has(r.recordId));

  const present = new Set<string>();
  const extras: RosterView['extras'] = [];
  for (const r of live) {
    if (r.employeeId) present.add(r.employeeId);
    else if (r.extraName) extras.push({ recordId: r.recordId, name: r.extraName });
  }

  const missing = session.expectedEmployeeIds.filter((id) => !present.has(id));
  const undecided = missing.filter((id) => !session.missingDecisions[id]);
  return {
    presentEmployeeIds: [...present],
    extras,
    missingEmployeeIds: missing,
    undecidedEmployeeIds: undecided,
  };
}

export function canCloseSession(roster: RosterView): boolean {
  return roster.undecidedEmployeeIds.length === 0;
}

export function isValidDecision(d: unknown): d is MissingDecision {
  return d === 'ABSENT' || d === 'JUSTIFIED';
}
