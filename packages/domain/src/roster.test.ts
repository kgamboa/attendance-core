import { buildRoster, canCloseSession } from './roster';
import type { AttendanceRecord, AttendanceSession } from './model';

const session = (over: Partial<AttendanceSession> = {}): AttendanceSession => ({
  tenantId: 't', sessionId: 's', date: '2026-10-31', siteId: 'L1', status: 'OPEN', groupIds: [],
  expectedEmployeeIds: ['a', 'b', 'c'], missingDecisions: {}, openedBy: 'u', openedAt: 'x', ...over,
});
const rec = (over: Partial<AttendanceRecord>): AttendanceRecord => ({
  sessionId: 's', recordId: 'r1', tenantId: 't', date: '2026-10-31', method: 'AUTO', serverTs: 'x',
  flags: [], idempotencyKey: 'k', capturedBy: 'u', ...over,
});

describe('buildRoster', () => {
  test('separa presentes, extras y faltantes', () => {
    const r = buildRoster(session(), [rec({ recordId: '1', employeeId: 'a' }), rec({ recordId: '2', extraName: 'Pedro Gil', method: 'EXTRA' })]);
    expect(r.presentEmployeeIds).toEqual(['a']);
    expect(r.extras).toEqual([{ recordId: '2', name: 'Pedro Gil' }]);
    expect(r.missingEmployeeIds).toEqual(['b', 'c']);
  });

  test('un empleado fuera de la lista esperada también cuenta como presente', () => {
    expect(buildRoster(session(), [rec({ employeeId: 'z' })]).presentEmployeeIds).toEqual(['z']);
  });

  test('un registro reemplazado por una corrección no cuenta', () => {
    const r = buildRoster(session(), [
      rec({ recordId: '1', employeeId: 'a' }),
      rec({ recordId: '2', employeeId: 'b', supersedes: '1' }),
    ]);
    expect(r.presentEmployeeIds).toEqual(['b']);
  });

  test('no se puede cerrar con faltantes sin decisión', () => {
    const open = buildRoster(session({ missingDecisions: { b: { decision: 'ABSENT' } } }), [rec({ employeeId: 'a' })]);
    expect(open.undecidedEmployeeIds).toEqual(['c']);
    expect(canCloseSession(open)).toBe(false);
    const done = buildRoster(
      session({ missingDecisions: { b: { decision: 'ABSENT' }, c: { decision: 'JUSTIFIED', reason: 'incapacidad' } } }),
      [rec({ employeeId: 'a' })],
    );
    expect(canCloseSession(done)).toBe(true);
  });
});
