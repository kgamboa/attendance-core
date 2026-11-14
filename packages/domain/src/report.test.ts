import { buildReport, percent, validateRange } from './report';
import type { AttendanceRecord, AttendanceSession, Employee } from './model';

const emp = (id: string, name: string, groupId = 'c1'): Employee => ({
  employeeId: id, tenantId: 't', name, nameNormalized: name.toLowerCase(), groupId, status: 'ACTIVE', missCount: 0,
  enrollment: { status: 'NONE', faceIds: [], photoKeys: [] }, createdAt: 'x',
});
const session = (date: string, over: Partial<AttendanceSession> = {}): AttendanceSession => ({
  tenantId: 't', sessionId: `att_${date}_L1`, date, siteId: 'L1', status: 'CLOSED', groupIds: ['c1'],
  expectedEmployeeIds: ['a', 'b', 'c'], missingDecisions: {}, openedBy: 'u', openedAt: 'x', ...over,
});
const rec = (s: AttendanceSession, id: string, over: Partial<AttendanceRecord> = {}): AttendanceRecord => ({
  sessionId: s.sessionId, recordId: `r_${id}_${s.date}`, tenantId: 't', date: s.date, employeeId: id, method: 'AUTO',
  serverTs: 'x', flags: [], idempotencyKey: 'k', capturedBy: 'u', ...over,
});

const employees = [emp('a', 'Ana López'), emp('b', 'Beto Ruiz'), emp('c', 'Carla Soto'), emp('z', 'Zoe Otra', 'c2')];
const f = { from: '2026-10-01', to: '2026-10-31' };

describe('buildReport', () => {
  const s1 = session('2026-10-01', { missingDecisions: { c: { decision: 'JUSTIFIED', reason: 'permiso' } } });
  const s2 = session('2026-10-02', { missingDecisions: { b: { decision: 'ABSENT' }, c: { decision: 'ABSENT' } } });
  const s3 = session('2026-10-03', { status: 'OPEN' });
  const data = [
    { session: s1, records: [rec(s1, 'a'), rec(s1, 'b')] },
    { session: s2, records: [rec(s2, 'a'), { ...rec(s2, 'x'), employeeId: undefined, extraName: 'Pedro Gil', method: 'EXTRA' as const }] },
    { session: s3, records: [rec(s3, 'a'), rec(s3, 'b')] },
  ];

  test('cuenta presentes, ausentes, justificadas y sin decidir por persona', () => {
    const r = buildReport(data, employees, f);
    const by = (id: string) => r.persons.find((p) => p.employeeId === id)!;
    expect(by('a')).toMatchObject({ present: 3, absent: 0, pct: 100 });
    expect(by('b')).toMatchObject({ present: 2, absent: 1, pct: 66.7 });
    expect(by('c')).toMatchObject({ present: 0, absent: 1, justified: 1, undecided: 1, pct: 0 });
  });

  test('por día y totales; las personas extra van aparte', () => {
    const r = buildReport(data, employees, f);
    expect(r.days.map((d) => d.date)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);
    expect(r.days[1]).toMatchObject({ expected: 3, present: 1, absent: 2, extras: 1 });
    expect(r.extras).toEqual([{ date: '2026-10-02', siteId: 'L1', name: 'Pedro Gil' }]);
    expect(r.totals).toMatchObject({ sessions: 3, present: 5, absent: 2, justified: 1, undecided: 1, extras: 1 });
  });

  test('filtra por rango, lote y cuadrilla', () => {
    expect(buildReport(data, employees, { from: '2026-10-02', to: '2026-10-02' }).days).toHaveLength(1);
    expect(buildReport(data, employees, { ...f, siteId: 'otro' }).days).toHaveLength(0);
    const crew = buildReport(data, employees, { ...f, groupId: 'c2' });
    expect(crew.persons).toHaveLength(0);
    expect(crew.extras).toHaveLength(0);
  });

  test('porcentaje sin base es null', () => {
    expect(percent(0, 0)).toBeNull();
    expect(percent(3, 1)).toBe(75);
  });
});

describe('validateRange', () => {
  test('acepta rangos válidos y rechaza fechas mal formadas, invertidas o muy largas', () => {
    expect(validateRange('2026-10-01', '2026-10-31')).toEqual({ ok: true });
    expect(validateRange('2026-10-31', '2026-10-01')).toMatchObject({ ok: false });
    expect(validateRange('01/10/2026', '2026-10-31')).toMatchObject({ ok: false });
    expect(validateRange('2026-01-01', '2026-12-31')).toEqual({ ok: false, error: 'RANGE_TOO_LARGE' });
    expect(validateRange(undefined, undefined)).toMatchObject({ ok: false });
  });
});

describe('entrada y salida (primera y última foto reconocida)', () => {
  const s1 = session('2026-10-05', { expectedEmployeeIds: ['a', 'b'] });
  const at = (id: string, hhmmZ: string, over: Partial<AttendanceRecord> = {}) =>
    rec(s1, id, { recordId: `r_${id}_${hhmmZ}`, serverTs: `2026-10-05T${hhmmZ}:00Z`, ...over });
  // México es UTC-6 en octubre de 2026 (sin horario de verano).
  const opts = { shiftStart: '08:00', lateGraceMin: 10 };

  test('entrada = primera foto, salida = última, horas = diferencia', () => {
    const r = buildReport([{ session: s1, records: [at('a', '23:00'), at('a', '13:55'), at('a', '18:00')] }], employees, { from: '2026-10-05', to: '2026-10-05' }, opts);
    expect(r.stamps).toEqual([{ date: '2026-10-05', employeeId: 'a', name: 'Ana López', entry: '2026-10-05T13:55:00Z', exit: '2026-10-05T23:00:00Z', minutes: 545, lateMinutes: 0 }]);
    expect(r.persons.find((p) => p.employeeId === 'a')).toMatchObject({ late: 0, workedMinutes: 545, daysWithHours: 1 });
  });

  test('retardo solo pasada la tolerancia; una sola foto no da salida ni horas', () => {
    const r = buildReport([{ session: s1, records: [at('a', '14:10'), at('b', '14:11')] }], employees, { from: '2026-10-05', to: '2026-10-05' }, opts);
    const by = (id: string) => r.persons.find((p) => p.employeeId === id)!;
    expect(by('a')).toMatchObject({ late: 0, workedMinutes: 0, daysWithHours: 0 });
    expect(by('b')).toMatchObject({ late: 1, workedMinutes: 0 });
    expect(r.stamps.find((x) => x.employeeId === 'b')).toMatchObject({ exit: null, minutes: null, lateMinutes: 11 });
  });

  test('sin horario configurado no hay retardos; las fotos reemplazadas y las extra no cuentan', () => {
    const old = at('a', '14:30');
    const fix = at('a', '14:00', { recordId: 'fix', supersedes: old.recordId });
    const extra = rec(s1, 'x', { employeeId: undefined, extraName: 'Pedro', method: 'EXTRA', serverTs: '2026-10-05T20:00:00Z' });
    const r = buildReport([{ session: s1, records: [old, fix, extra] }], employees, { from: '2026-10-05', to: '2026-10-05' });
    expect(r.stamps).toHaveLength(1);
    expect(r.stamps[0]).toMatchObject({ entry: '2026-10-05T14:00:00Z', exit: null, lateMinutes: 0 });
  });

  test('varias listas del mismo día se juntan; el filtro de cuadrilla se respeta', () => {
    const s2 = session('2026-10-05', { sessionId: 'att_2026-10-05_L2', siteId: 'L2', expectedEmployeeIds: ['a'] });
    const r = buildReport([
      { session: s1, records: [at('a', '14:00'), at('z', '14:00')] },
      { session: s2, records: [rec(s2, 'a', { serverTs: '2026-10-05T22:00:00Z' })] },
    ], employees, { from: '2026-10-05', to: '2026-10-05', groupId: 'c1' }, opts);
    expect(r.stamps.map((x) => [x.employeeId, x.minutes])).toEqual([['a', 480]]);
  });
});
