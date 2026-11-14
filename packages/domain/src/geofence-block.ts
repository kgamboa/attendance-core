/**
 * geofence-block.ts — Validación de ubicación para `attendance.geofenceMode = BLOCK`.
 *
 * Decide si una persona puede pasar lista o generar un pase de caseta según su GPS: dentro de
 * alguna zona marcada "Válida para pasar lista", o a no más de `toleranceMeters` de su borde.
 * Sin ubicación o con precisión peor que `maxAccuracyMeters` no se valida: se pide reintentar.
 */
import { pointInPolygon } from './geo';

export interface GeoZone {
  name?: string;
  moduleCode?: string;
  boundary?: { coordinates?: number[][][] };
}

export interface GeofenceOptions {
  toleranceMeters: number;
  maxAccuracyMeters: number;
}

export interface GeofenceGps {
  lat?: number;
  lng?: number;
  accuracy?: number;
}

export type GeofenceVerdict =
  | { ok: true; zoneName?: string }
  | { ok: false; reason: 'NO_LOCATION' | 'LOW_ACCURACY' | 'OUTSIDE' };

const EARTH_RADIUS_M = 6371000;

/** Distancia en metros del punto al segmento a–b, con proyección local (suficiente a escala de campo). */
function distanceToSegmentM(lat: number, lng: number, a: number[], b: number[]): number {
  const kx = (Math.PI / 180) * EARTH_RADIUS_M * Math.cos((lat * Math.PI) / 180);
  const ky = (Math.PI / 180) * EARTH_RADIUS_M;
  const ax = (a[0] - lng) * kx, ay = (a[1] - lat) * ky;
  const bx = (b[0] - lng) * kx, by = (b[1] - lat) * ky;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
  const px = ax + t * dx, py = ay + t * dy;
  return Math.hypot(px, py);
}

/** 0 si el punto está dentro del anillo; si no, la distancia al borde más cercano en metros. */
export function distanceToRingM(lat: number, lng: number, ring: number[][]): number {
  if (pointInPolygon(lat, lng, ring)) return 0;
  let min = Infinity;
  for (let i = 0; i < ring.length - 1; i++) {
    min = Math.min(min, distanceToSegmentM(lat, lng, ring[i], ring[i + 1]));
  }
  return min;
}

const usableRing = (z: GeoZone): number[][] | undefined => {
  const r = z.boundary?.coordinates?.[0];
  return r && r.length >= 3 ? r : undefined;
};

/**
 * Evalúa la ubicación contra las zonas. El orden importa: primero ubicación, luego precisión,
 * y al final distancia. Las zonas sin polígono no cuentan.
 */
export function evaluateGeofence(gps: GeofenceGps, zones: GeoZone[], opts: GeofenceOptions): GeofenceVerdict {
  if (gps.lat === undefined || gps.lng === undefined) return { ok: false, reason: 'NO_LOCATION' };
  if (gps.accuracy === undefined || gps.accuracy > opts.maxAccuracyMeters) return { ok: false, reason: 'LOW_ACCURACY' };
  let best: { zone: GeoZone; d: number } | undefined;
  for (const zone of zones) {
    const ring = usableRing(zone);
    if (!ring) continue;
    const d = distanceToRingM(gps.lat, gps.lng, ring);
    if (!best || d < best.d) best = { zone, d };
  }
  if (best && best.d <= opts.toleranceMeters) {
    return { ok: true, zoneName: best.zone.name || best.zone.moduleCode };
  }
  return { ok: false, reason: 'OUTSIDE' };
}

/** Zonas que sí sirven para validar (tienen polígono). */
export function usableGeofenceZones<T extends GeoZone>(zones: T[]): T[] {
  return zones.filter((z) => usableRing(z) !== undefined);
}
