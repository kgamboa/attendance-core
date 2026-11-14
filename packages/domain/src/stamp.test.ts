import jpeg from 'jpeg-js';
import { formatStampGps, formatStampTime, renderStamp, textWidth, toStampText, type StampLogo } from './stamp';
import { readJpegSize } from './face-crop';

/** Decodifica una vez y devuelve un lector de pixeles (decodificar por cada pixel tardaba segundos). */
function reader(buf: Buffer) {
  const img = jpeg.decode(buf, { useTArray: true });
  return (x: number, y: number): [number, number, number] => { const i = (y * img.width + x) * 4; return [img.data[i], img.data[i + 1], img.data[i + 2]]; };
}
import { GLYPHS } from './stamp-font';

/** Logo de prueba 192x144 con un color distinto en cada punto (sin transparencia). */
function syntheticLogo(): StampLogo {
  const width = 192; const height = 144;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    rgba[i] = 210 + (x % 40); rgba[i + 1] = (y * 7) % 256; rgba[i + 2] = (x * 3) % 90; rgba[i + 3] = 255;
  }
  return { width, height, rgba };
}

const photo = (w = 640, h = 480) => Buffer.from(jpeg.encode({ data: Buffer.alloc(w * h * 4, 200), width: w, height: h }, 90).data);

describe('stamp', () => {
  test('toda letra y dígito tiene glifo de 7 filas por 5 columnas', () => {
    for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,:-/()%+_ ') {
      expect(GLYPHS[c]).toHaveLength(7);
      GLYPHS[c].forEach((r) => expect(r).toHaveLength(5));
    }
  });

  test('toStampText quita acentos y reemplaza lo que no existe', () => {
    expect(toStampText('Ana López Muñoz')).toBe('ANA LOPEZ MUNOZ');
    expect(toStampText('a€')).toBe('A?');
  });

  test('formatos de hora y ubicación', () => {
    expect(formatStampTime('2026-10-31T15:14:22Z', 'America/Mexico_City')).toBe('2026-10-31 09:14:22');
    expect(formatStampGps(20.123456, -100.5, 12.4)).toBe('20.12346, -100.50000 +/-12 M');
    expect(formatStampGps()).toBe('SIN UBICACION');
  });

  test('conserva el tamaño, oscurece la franja inferior y deja intacto el resto', () => {
    const out = renderStamp(photo(), { lines: ['ANA LOPEZ', '2026-10-31 09:14:22', '20.1, -100.5'] });
    expect(readJpegSize(out)).toEqual({ width: 640, height: 480 });
    const px = reader(out);
    expect(px(5, 478)[0]).toBeLessThan(110); // franja oscura (fondo 200 * 0.35 ≈ 70)
    expect(px(5, 10)[0]).toBeGreaterThan(180); // arriba, intacto
  });

  test('pone el logotipo de la marca a la derecha de la franja', async () => {
    const dark = Buffer.from(jpeg.encode({ data: Buffer.alloc(640 * 480 * 4, 40), width: 640, height: 480 }, 90).data);
    const px = reader(renderStamp(dark, { lines: ['A', 'B', 'C', 'D'], logo: syntheticLogo() }));
    expect(px(5, 5)[0]).toBeLessThan(80); // arriba a la derecha ya no hay nada
    expect(px(630, 5)[0]).toBeLessThan(80);
    let bright = 0;
    const colors = new Set<number>();
    for (let y = 442; y < 478; y++) for (let x = 585; x < 638; x++) {
      const [r, g, b] = px(x, y);
      if (r > 200) bright++;
      colors.add(Math.round((r - b) / 20));
    }
    expect(bright).toBeGreaterThan(600); // placa blanca
    expect(colors.size).toBeGreaterThan(2); // el logotipo trae color, no es solo una placa
  });

  test('sin logotipo no dibuja placa ni marca', async () => {
    const dark = Buffer.from(jpeg.encode({ data: Buffer.alloc(640 * 480 * 4, 40), width: 640, height: 480 }, 90).data);
    const px = reader(renderStamp(dark, { lines: ['A', 'B', 'C', 'D'] }));
    let bright = 0;
    for (let y = 442; y < 478; y++) for (let x = 585; x < 638; x++) if (px(x, y)[0] > 200) bright++;
    expect(bright).toBe(0);
  });

  test('enmarca a todas las personas de una foto de grupo con "boxes"', async () => {
    const out = renderStamp(photo(), {
      lines: ['A'],
      boxes: [{ left: 0.1, top: 0.1, width: 0.2, height: 0.3 }, { left: 0.6, top: 0.1, width: 0.2, height: 0.3 }],
    });
    const px = reader(out);
    const green = (x: number, y: number) => px(x, y)[1] > 180 && px(x, y)[0] < 140;
    expect(green(Math.round(0.1 * 640) + 1, Math.round(0.2 * 480))).toBe(true);
    expect(green(Math.round(0.6 * 640) + 1, Math.round(0.2 * 480))).toBe(true);
  });

  test('dibuja texto claro sobre la franja', () => {
    const out = renderStamp(photo(), { lines: ['HOLA'] });
    // La franja mide 2*pad + 9 px (escala 1); la H empieza en x=4: columna izquierda encendida.
    const px = reader(out);
    let bright = 0;
    for (let y = 480 - 14; y < 480; y++) for (let x = 0; x < 40; x++) if (px(x, y)[0] > 200) bright++;
    expect(bright).toBeGreaterThan(10);
  });

  test('enmarca el rostro de la persona en verde', () => {
    const out = renderStamp(photo(), { lines: ['X'], box: { left: 0.25, top: 0.2, width: 0.2, height: 0.3 } });
    const [r, g, b] = reader(out)(Math.round(0.25 * 640) + 1, Math.round(0.35 * 480));
    expect(g).toBeGreaterThan(r + 40);
    expect(g).toBeGreaterThan(b + 20);
  });

  test('textWidth y escala para fotos grandes', () => {
    expect(textWidth('AB', 1)).toBe(11);
    expect(textWidth('', 3)).toBe(0);
    const big = renderStamp(photo(1920, 1440), { lines: ['A', 'B', 'C'] });
    expect(readJpegSize(big)).toEqual({ width: 1920, height: 1440 });
  });
});
