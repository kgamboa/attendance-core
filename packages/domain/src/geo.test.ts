import { isOutsideSite, isOutsideZones, pointInPolygon, zoneContaining } from './geo';

const square = [[-100, 20], [-100, 21], [-99, 21], [-99, 20], [-100, 20]];

describe('geo', () => {
  test('punto dentro y fuera de un cuadrado', () => {
    expect(pointInPolygon(20.5, -99.5, square)).toBe(true);
    expect(pointInPolygon(22, -99.5, square)).toBe(false);
  });
  test('isOutsideSite devuelve undefined si falta GPS o geocerca', () => {
    expect(isOutsideSite(undefined, -99.5, { coordinates: [square] })).toBeUndefined();
    expect(isOutsideSite(20.5, -99.5, undefined)).toBeUndefined();
    expect(isOutsideSite(20.5, -99.5, { coordinates: [square] })).toBe(false);
    expect(isOutsideSite(25, -99.5, { coordinates: [square] })).toBe(true);
  });
  test('isOutsideZones: dentro de cualquiera de las zonas no marca; fuera de todas sí', () => {
    const other = [[-90, 10], [-90, 11], [-89, 11], [-89, 10], [-90, 10]];
    const zones = [{ boundary: { coordinates: [square] } }, { boundary: { coordinates: [other] } }];
    expect(isOutsideZones(20.5, -99.5, zones)).toBe(false);
    expect(isOutsideZones(10.5, -89.5, zones)).toBe(false);
    expect(isOutsideZones(15, -95, zones)).toBe(true);
  });
  test('isOutsideZones devuelve undefined sin GPS o sin zonas con geocerca', () => {
    expect(isOutsideZones(undefined, -99.5, [{ boundary: { coordinates: [square] } }])).toBeUndefined();
    expect(isOutsideZones(20.5, -99.5, [{}])).toBeUndefined();
    expect(isOutsideZones(20.5, -99.5, [])).toBeUndefined();
  });
});

describe('zoneContaining', () => {
  const sq = (x0: number, y0: number, x1: number, y1: number) => ({ boundary: { coordinates: [[[x0, y0], [x0, y1], [x1, y1], [x1, y0], [x0, y0]]] } });
  test('devuelve la zona que contiene el punto (hay varias entradas)', () => {
    const a = { ...sq(-100, 20, -99, 21), name: 'Entrada A' };
    const b = { ...sq(-90, 20, -89, 21), name: 'Entrada B' };
    expect(zoneContaining(20.5, -89.5, [a, b])?.name).toBe('Entrada B');
    expect(zoneContaining(25, -89.5, [a, b])).toBeUndefined();
    expect(zoneContaining(undefined, -89.5, [a, b])).toBeUndefined();
  });
});
