import { evaluateGeofence, GeoZone } from './geofence-block';

// Cuadro de 1° x 1° cerca de (20.5, -99.5). 1° de latitud ≈ 111 195 m.
const square = [[-100, 20], [-100, 21], [-99, 21], [-99, 20], [-100, 20]];
const zone: GeoZone = { name: 'Entrada Principal', moduleCode: 'E01', boundary: { coordinates: [square] } };
const M_PER_DEG_LAT = 6371000 * Math.PI / 180;
const opts = { toleranceMeters: 25, maxAccuracyMeters: 50 };
const at = (lat: number, lng: number, accuracy = 10) => ({ lat, lng, accuracy });

describe('evaluateGeofence (BLOCK)', () => {
  test('dentro del polígono: ok y nombra la zona', () => {
    expect(evaluateGeofence(at(20.5, -99.5), [zone], opts)).toEqual({ ok: true, zoneName: 'Entrada Principal' });
  });

  test('fuera, a más de la tolerancia: OUTSIDE', () => {
    expect(evaluateGeofence(at(21 + 100 / M_PER_DEG_LAT, -99.5), [zone], opts)).toEqual({ ok: false, reason: 'OUTSIDE' });
  });

  test('borde con tolerancia: 20 m fuera del borde norte entra; 30 m no', () => {
    expect(evaluateGeofence(at(21 + 20 / M_PER_DEG_LAT, -99.5), [zone], opts).ok).toBe(true);
    expect(evaluateGeofence(at(21 + 30 / M_PER_DEG_LAT, -99.5), [zone], opts)).toEqual({ ok: false, reason: 'OUTSIDE' });
  });

  test('borde este con tolerancia: 20 m fuera entra; 30 m no', () => {
    const lngPerM = 1 / (M_PER_DEG_LAT * Math.cos((20.5 * Math.PI) / 180));
    expect(evaluateGeofence(at(20.5, -99 + 20 * lngPerM), [zone], opts).ok).toBe(true);
    expect(evaluateGeofence(at(20.5, -99 + 30 * lngPerM), [zone], opts).ok).toBe(false);
  });

  test('la tolerancia es configurable: con 0 m el borde de 20 m queda fuera', () => {
    expect(evaluateGeofence(at(21 + 20 / M_PER_DEG_LAT, -99.5), [zone], { ...opts, toleranceMeters: 0 }).ok).toBe(false);
  });

  test('precisión peor que el máximo: LOW_ACCURACY aunque esté dentro', () => {
    expect(evaluateGeofence(at(20.5, -99.5, 60), [zone], opts)).toEqual({ ok: false, reason: 'LOW_ACCURACY' });
  });

  test('precisión igual al máximo se acepta', () => {
    expect(evaluateGeofence(at(20.5, -99.5, 50), [zone], opts).ok).toBe(true);
  });

  test('sin precisión reportada: LOW_ACCURACY (no se puede validar)', () => {
    expect(evaluateGeofence({ lat: 20.5, lng: -99.5 }, [zone], opts)).toEqual({ ok: false, reason: 'LOW_ACCURACY' });
  });

  test('sin ubicación: NO_LOCATION', () => {
    expect(evaluateGeofence({}, [zone], opts)).toEqual({ ok: false, reason: 'NO_LOCATION' });
    expect(evaluateGeofence({ lat: 20.5, accuracy: 5 }, [zone], opts)).toEqual({ ok: false, reason: 'NO_LOCATION' });
  });

  test('entre varias zonas, basta con estar dentro de una', () => {
    const other: GeoZone = { name: 'Oficinas', boundary: { coordinates: [[[-98, 20], [-98, 21], [-97, 21], [-97, 20], [-98, 20]]] } };
    expect(evaluateGeofence(at(20.5, -97.5), [zone, other], opts)).toEqual({ ok: true, zoneName: 'Oficinas' });
  });

  test('zona sin polígono usable no cuenta', () => {
    expect(evaluateGeofence(at(20.5, -99.5), [{ name: 'X' }], opts)).toEqual({ ok: false, reason: 'OUTSIDE' });
  });
});
