import { applyAbsence, applyAttendance } from './rotation';

const policy = { preBajaAfterMisses: 3, bajaAfterMoreMisses: 2, autoBaja: false };

describe('rotation', () => {
  test('inasistencias por debajo del umbral solo suman', () => {
    expect(applyAbsence({ status: 'ACTIVE', missCount: 0 }, policy)).toEqual({ action: 'NONE', missCount: 1 });
    expect(applyAbsence({ status: 'ACTIVE', missCount: 1 }, policy)).toEqual({ action: 'NONE', missCount: 2 });
  });

  test('la tercera consecutiva genera pre-baja', () => {
    expect(applyAbsence({ status: 'ACTIVE', missCount: 2 }, policy)).toEqual({ action: 'PRE_TERMINATION', missCount: 3 });
  });

  test('en pre-baja, dos inasistencias más recomiendan la baja (HR decide)', () => {
    expect(applyAbsence({ status: 'PRE_TERMINATION', missCount: 3 }, policy)).toEqual({ action: 'NONE', missCount: 4 });
    expect(applyAbsence({ status: 'PRE_TERMINATION', missCount: 4 }, policy)).toEqual({ action: 'RECOMMEND_TERMINATION', missCount: 5 });
  });

  test('con autoBaja la baja es automática', () => {
    expect(applyAbsence({ status: 'PRE_TERMINATION', missCount: 4 }, { ...policy, autoBaja: true }))
      .toEqual({ action: 'TERMINATE', missCount: 5 });
  });

  test('preBajaAfterMisses=0 desactiva la regla', () => {
    expect(applyAbsence({ status: 'ACTIVE', missCount: 9 }, { ...policy, preBajaAfterMisses: 0 }))
      .toEqual({ action: 'NONE', missCount: 10 });
  });

  test('un inactivo no genera acciones', () => {
    expect(applyAbsence({ status: 'INACTIVE', missCount: 0 }, policy).action).toBe('NONE');
  });

  test('asistir cancela la pre-baja y reinicia el contador', () => {
    expect(applyAttendance({ status: 'PRE_TERMINATION', missCount: 4 })).toEqual({ action: 'CANCEL_PRE_TERMINATION', missCount: 0 });
    expect(applyAttendance({ status: 'ACTIVE', missCount: 2 })).toEqual({ action: 'NONE', missCount: 0 });
  });
});
