import { DEFAULT_TIMEZONE } from './constants';
/**
 * report.ts — Reporte de asistencia por periodo (lógica pura, sin I/O).
 *
 * Por persona: días con asistencia, ausencias, justificadas, sin decidir y porcentaje.
 * Porcentaje = presentes / (presentes + ausencias). Las justificadas no cuentan a favor ni en
 * contra; las que aún no se deciden (lista abierta) tampoco, y se muestran aparte.
 *
 * Entrada y salida (decisión de producto): por persona y día, la entrada es la PRIMERA foto
 * reconocida y la salida la ÚLTIMA (de todas las listas del día; sin botón extra). Con una sola
 * foto hay entrada pero no salida ni horas. El retardo se mide contra `shiftStart` + tolerancia.
 */
import type { AttendanceRecord, AttendanceSession, Employee } from './model';
import { buildRoster } from './roster';

export interface ReportFilters {
  from: string;
  to: string;
  siteId?: string;
  groupId?: string;
}

export interface PersonRow {
  employeeId: string;
  name: string;
  employeeNumber?: string;
  groupId?: string;
  status: Employee['status'];
  present: number;
  absent: number;
  justified: number;
  undecided: number;
  /** null cuando no hay días que contar. */
  pct: number | null;
  /** Días con entrada después de la hora de inicio + tolerancia (0 si no hay horario configurado). */
  late: number;
  /** Minutos trabajados: suma de (última − primera foto) de los días con al menos dos fotos. */
  workedMinutes: number;
  /** Días que aportan horas (con entrada y salida distintas). */
  daysWithHours: number;
}

/** Entrada y salida de una persona en un día, derivadas de sus fotos reconocidas. */
export interface DayStamp {
  date: string;
  employeeId: string;
  name: string;
  /** Hora ISO (servidor) de la primera foto reconocida. */
  entry: string;
  /** Hora ISO de la última foto reconocida; null si solo hubo una. */
  exit: string | null;
  /** Minutos entre entrada y salida; null sin salida. */
  minutes: number | null;
  /** Minutos de retardo respecto a la hora de inicio, si pasó la tolerancia; 0 = a tiempo o sin horario. */
  lateMinutes: number;
}

export interface TimeOptions {
  /** Hora de inicio de jornada 'HH:mm' (vacío = sin retardos). */
  shiftStart?: string;
  /** Tolerancia en minutos antes de contar retardo. */
  lateGraceMin?: number;
  timeZone?: string;
}

export interface DayRow {
  date: string;
  sessionId: string;
  /** Destino (informativo); '' si no se indicó. */
  siteId: string;
  /** Observaciones del cierre (bitácora). */
  notes?: string;
  /** Última verificación en caseta del pase de esta lista (si la hubo). */
  gate?: { result: 'MATCH' | 'MISMATCH'; counted: number; expected: number };
  status: AttendanceSession['status'];
  expected: number;
  present: number;
  absent: number;
  justified: number;
  undecided: number;
  extras: number;
}

export interface ExtraRow { date: string; siteId: string; name: string }

export interface AttendanceReport {
  filters: ReportFilters;
  persons: PersonRow[];
  days: DayRow[];
  extras: ExtraRow[];
  /** Entrada y salida por persona y día. */
  stamps: DayStamp[];
  totals: { sessions: number; present: number; absent: number; justified: number; undecided: number; extras: number; pct: number | null };
}

export function percent(present: number, absent: number): number | null {
  const base = present + absent;
  return base === 0 ? null : Math.round((present / base) * 1000) / 10;
}

/** Minutos desde medianoche (hora local) de un instante ISO; null si no es válido. */
export function localMinutes(iso: string, timeZone: string = DEFAULT_TIMEZONE): number | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(t));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return get('hour') * 60 + get('minute');
}

export function parseShiftStart(v: string | undefined): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(v ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Entrada = primera foto, salida = última (solo si hay dos instantes distintos). */
export function stampOf(times: string[], opts: TimeOptions): Pick<DayStamp, 'entry' | 'exit' | 'minutes' | 'lateMinutes'> | null {
  const valid = times.filter((x) => !Number.isNaN(Date.parse(x))).sort((a, b) => Date.parse(a) - Date.parse(b));
  if (!valid.length) return null;
  const entry = valid[0];
  const last = valid[valid.length - 1];
  const diff = Math.floor((Date.parse(last) - Date.parse(entry)) / 60000);
  const hasExit = diff > 0;
  const start = parseShiftStart(opts.shiftStart);
  const at = localMinutes(entry, opts.timeZone);
  const over = start === null || at === null ? 0 : at - start;
  return { entry, exit: hasExit ? last : null, minutes: hasExit ? diff : null, lateMinutes: over > (opts.lateGraceMin ?? 0) ? over : 0 };
}

export interface SessionData { session: AttendanceSession; records: AttendanceRecord[] }

export function buildReport(data: SessionData[], employees: Employee[], filters: ReportFilters, time: TimeOptions = {}): AttendanceReport {
  const byId = new Map(employees.map((e) => [e.employeeId, e]));
  const inGroup = (id: string) => !filters.groupId || byId.get(id)?.groupId === filters.groupId;

  const persons = new Map<string, PersonRow>();
  const row = (id: string): PersonRow => {
    let r = persons.get(id);
    if (!r) {
      const e = byId.get(id);
      r = {
        employeeId: id, name: e?.name ?? id, employeeNumber: e?.employeeNumber, groupId: e?.groupId,
        status: e?.status ?? 'ACTIVE', present: 0, absent: 0, justified: 0, undecided: 0, pct: null, late: 0, workedMinutes: 0, daysWithHours: 0,
      };
      persons.set(id, r);
    }
    return r;
  };

  const days: DayRow[] = [];
  const dayTimes = new Map<string, { date: string; id: string; times: string[] }>();
  const extras: ExtraRow[] = [];

  const relevant = data
    .filter(({ session }) => session.date >= filters.from && session.date <= filters.to)
    .filter(({ session }) => !filters.siteId || session.siteId === filters.siteId)
    .sort((a, b) => a.session.sessionId.localeCompare(b.session.sessionId));

  for (const { session, records } of relevant) {
    const roster = buildRoster(session, records);
    const present = roster.presentEmployeeIds.filter(inGroup);
    const missing = roster.missingEmployeeIds.filter(inGroup);
    const decision = (id: string) => session.missingDecisions[id]?.decision;

    for (const id of present) row(id).present++;
    // Fotos reconocidas vigentes (no reemplazadas) de las personas del filtro: base de entrada y salida.
    const superseded = new Set(records.map((r) => r.supersedes).filter((x): x is string => !!x));
    for (const r of records) {
      if (!r.employeeId || superseded.has(r.recordId) || !inGroup(r.employeeId)) continue;
      const k = `${r.employeeId}|${session.date}`;
      const e = dayTimes.get(k) ?? { date: session.date, id: r.employeeId, times: [] };
      e.times.push(r.serverTs);
      dayTimes.set(k, e);
    }
    let absent = 0; let justified = 0; let undecided = 0;
    for (const id of missing) {
      const d = decision(id);
      if (d === 'ABSENT') { row(id).absent++; absent++; }
      else if (d === 'JUSTIFIED') { row(id).justified++; justified++; }
      else { row(id).undecided++; undecided++; }
    }
    // Las personas extra no pertenecen a un grupo: con filtro de grupo no se cuentan.
    const sessionExtras = filters.groupId ? [] : roster.extras;
    for (const x of sessionExtras) extras.push({ date: session.date, siteId: session.siteId, name: x.name });

    days.push({
      date: session.date, sessionId: session.sessionId, siteId: session.siteId, notes: session.notes, status: session.status,
      expected: session.expectedEmployeeIds.filter(inGroup).length, present: present.length, absent, justified, undecided,
      extras: sessionExtras.length,
    });
  }

  const stamps: DayStamp[] = [];
  for (const { date, id, times } of dayTimes.values()) {
    const st = stampOf(times, time);
    if (!st) continue;
    const r = row(id);
    if (st.lateMinutes > 0) r.late++;
    if (st.minutes !== null) { r.workedMinutes += st.minutes; r.daysWithHours++; }
    stamps.push({ date, employeeId: id, name: r.name, ...st });
  }
  stamps.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name, 'es'));

  const personRows = [...persons.values()].map((p) => ({ ...p, pct: percent(p.present, p.absent) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const sum = (f: (d: DayRow) => number) => days.reduce((n, d) => n + f(d), 0);
  const present = sum((d) => d.present);
  const absent = sum((d) => d.absent);
  return {
    filters, persons: personRows, days, extras, stamps,
    totals: { sessions: days.length, present, absent, justified: sum((d) => d.justified), undecided: sum((d) => d.undecided), extras: extras.length, pct: percent(present, absent) },
  };
}

/** Rango válido: fechas YYYY-MM-DD, from ≤ to, máximo 93 días. */
export function validateRange(from: unknown, to: unknown, maxDays = 93): { ok: true } | { ok: false; error: string } {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (typeof from !== 'string' || typeof to !== 'string' || !re.test(from) || !re.test(to)) return { ok: false, error: 'INVALID_RANGE' };
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b) || a > b) return { ok: false, error: 'INVALID_RANGE' };
  if ((b - a) / 86_400_000 > maxDays) return { ok: false, error: 'RANGE_TOO_LARGE' };
  return { ok: true };
}
