/**
 * Retardos y horas usan la zona horaria que se les pasa, no una fija.
 * 2026-11-10T15:10:00Z son las 09:10 en Ciudad de México (UTC-6) y las 10:10 en Bogotá (UTC-5).
 */
import { stampOf, localMinutes } from './report';
import { formatStampTime } from './stamp';

const ISO = '2026-11-10T15:10:00.000Z';

describe('retardos con la zona indicada', () => {
  test('localMinutes: la hora local depende de la zona', () => {
    expect(localMinutes(ISO, 'America/Mexico_City')).toBe(9 * 60 + 10);
    expect(localMinutes(ISO, 'America/Bogota')).toBe(10 * 60 + 10);
  });

  test('el mismo registro es retardo en Bogotá y no tanto en México si la jornada empieza a las 09:00', () => {
    const opts = { shiftStart: '09:00', lateGraceMin: 0 };
    expect(stampOf([ISO, ISO], { ...opts, timeZone: 'America/Mexico_City' })?.lateMinutes).toBe(10);
    expect(stampOf([ISO, ISO], { ...opts, timeZone: 'America/Bogota' })?.lateMinutes).toBe(70);
  });

  test('sin zona explícita usa la zona por defecto del núcleo (compatibilidad con Agrovid)', () => {
    expect(localMinutes(ISO)).toBe(9 * 60 + 10);
    expect(stampOf([ISO, ISO], { shiftStart: '09:00', lateGraceMin: 0 })?.lateMinutes).toBe(10);
  });
});

describe('hora en el sello de foto', () => {
  test('formatStampTime muestra la hora de la zona indicada', () => {
    expect(formatStampTime(ISO, 'America/Bogota')).toContain('10:10');
    expect(formatStampTime(ISO, 'America/Mexico_City')).toContain('09:10');
  });
});
