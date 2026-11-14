import { DEFAULT_ATTENDANCE_POLICY as P } from './policy';

describe('DEFAULT_ATTENDANCE_POLICY', () => {
  test('los umbrales de reconocimiento son coherentes', () => {
    expect(P.thresholdConfirm).toBeLessThan(P.thresholdAuto);
    expect(P.thresholdAuto).toBeLessThanOrEqual(100);
    expect(P.maxFacesPerPhoto).toBeGreaterThanOrEqual(1);
    expect(P.minEnrollPhotos).toBeGreaterThanOrEqual(1);
  });

  test('sin horario no hay retardos y la rotación empieza apagada en baja automática', () => {
    expect(P.shiftStart).toBe('');
    expect(P.rotation.autoBaja).toBe(false);
  });

  test('la política del núcleo no trae ajustes de caseta', () => {
    expect(Object.keys(P).filter((k) => /gate/i.test(k))).toEqual([]);
  });
});
