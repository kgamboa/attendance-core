/** geo.ts — ¿Está el punto dentro del polígono del sitio? (ray casting; GeoJSON usa [lng, lat]) */
export function pointInPolygon(lat: number, lng: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const crosses = (yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

/** undefined = no se puede saber (sin GPS o sin geocerca): no se marca nada. */
export function isOutsideSite(
  lat: number | undefined, lng: number | undefined, boundary?: { coordinates?: number[][][] },
): boolean | undefined {
  const ring = boundary?.coordinates?.[0];
  if (lat === undefined || lng === undefined || !ring || ring.length < 3) return undefined;
  return !pointInPolygon(lat, lng, ring);
}

/**
 * ¿Está el punto fuera de TODAS las zonas marcadas para pasar lista? (puede haber varias entradas)
 * undefined = no se puede saber (sin GPS o ninguna zona con geocerca).
 */
export function isOutsideZones(
  lat: number | undefined, lng: number | undefined, zones: { boundary?: { coordinates?: number[][][] } }[],
): boolean | undefined {
  const rings = zones.map((z) => z.boundary?.coordinates?.[0]).filter((r): r is number[][] => !!r && r.length >= 3);
  if (lat === undefined || lng === undefined || rings.length === 0) return undefined;
  return !rings.some((r) => pointInPolygon(lat, lng, r));
}

/** Primera zona marcada para pasar lista que contiene el punto, o undefined. */
export function zoneContaining<T extends { boundary?: { coordinates?: number[][][] } }>(
  lat: number | undefined, lng: number | undefined, zones: T[],
): T | undefined {
  if (lat === undefined || lng === undefined) return undefined;
  return zones.find((z) => {
    const r = z.boundary?.coordinates?.[0];
    return !!r && r.length >= 3 && pointInPolygon(lat, lng, r);
  });
}
