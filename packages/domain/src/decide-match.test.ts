import { decideMatch } from './decide-match';

const opts = { thresholdAuto: 99, thresholdConfirm: 80 };

describe('decideMatch', () => {
  test('sin candidatos → UNKNOWN', () => {
    expect(decideMatch([], opts)).toEqual({ kind: 'UNKNOWN' });
  });

  test('mejor por debajo del umbral de confirmación → UNKNOWN', () => {
    expect(decideMatch([{ employeeId: 'a', similarity: 79.9 }], opts)).toEqual({ kind: 'UNKNOWN' });
  });

  test('≥ umbral alto y sin rival cercano → AUTO', () => {
    expect(decideMatch([{ employeeId: 'a', similarity: 99.5 }, { employeeId: 'b', similarity: 85 }], opts))
      .toEqual({ kind: 'AUTO', employeeId: 'a', similarity: 99.5 });
  });

  test('umbral alto pero el segundo está a menos del margen → pide confirmar', () => {
    const r = decideMatch([{ employeeId: 'a', similarity: 99.4 }, { employeeId: 'b', similarity: 98.9 }], opts);
    expect(r.kind).toBe('NEEDS_CONFIRMATION');
  });

  test('entre umbrales → confirma con candidatos ordenados, máximo 3', () => {
    const r = decideMatch(
      [
        { employeeId: 'a', similarity: 90 },
        { employeeId: 'b', similarity: 88 },
        { employeeId: 'c', similarity: 85 },
        { employeeId: 'd', similarity: 82 },
      ],
      opts,
    );
    expect(r).toEqual({
      kind: 'NEEDS_CONFIRMATION',
      candidates: [
        { employeeId: 'a', similarity: 90 },
        { employeeId: 'b', similarity: 88 },
        { employeeId: 'c', similarity: 85 },
      ],
    });
  });

  test('varias caras de la misma persona no la vuelven ambigua consigo misma', () => {
    const r = decideMatch([{ employeeId: 'a', similarity: 99.6 }, { employeeId: 'a', similarity: 99.2 }], opts);
    expect(r).toEqual({ kind: 'AUTO', employeeId: 'a', similarity: 99.6 });
  });

  test('descarta candidatos por debajo del umbral de confirmación', () => {
    const r = decideMatch([{ employeeId: 'a', similarity: 90 }, { employeeId: 'b', similarity: 50 }], opts);
    expect(r).toEqual({ kind: 'NEEDS_CONFIRMATION', candidates: [{ employeeId: 'a', similarity: 90 }] });
  });
});
