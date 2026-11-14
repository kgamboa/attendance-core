import { DEFAULT_TIMEZONE } from './constants';
/**
 * stamp.ts — Sello visible sobre una foto de asistencia: caja del rostro de la persona y una franja
 * inferior con nombre, fecha y hora (del servidor), ubicación y lugar.
 *
 * Se genera en el servidor al ver o exportar la foto, a partir de la foto limpia y del registro
 * (que es la fuente de verdad); no se guarda un segundo archivo. JS puro: texto con una fuente de
 * mapa de bits 5x7, sin librerías nativas.
 */
import jpeg from 'jpeg-js';
import { GLYPHS } from './stamp-font';
import type { FaceBox } from './face-crop';

/** Logotipo de la marca (RGBA 8 bits por canal) que se dibuja a la derecha de la franja. */
export interface StampLogo {
  width: number;
  height: number;
  rgba: Uint8Array;
}

export interface StampInput {
  /** Logotipo opcional. Sin logo no se dibuja placa ni marca. */
  logo?: StampLogo;
  /** Líneas de la franja, de arriba abajo. */
  lines: string[];
  /** Rostro de la persona del registro (foto de grupo): se enmarca. */
  box?: FaceBox;
  /** Otros rostros a enmarcar (miniatura de una foto con varias personas). */
  boxes?: FaceBox[];
}

const GREEN: [number, number, number] = [88, 214, 141];
const WHITE: [number, number, number] = [255, 255, 255];

/** Mayúsculas sin acentos; lo que la fuente no tiene se dibuja como "?". */
export function toStampText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ñ/g, 'n').replace(/Ñ/g, 'N')
    .toUpperCase()
    .split('')
    .map((c) => (GLYPHS[c] ? c : '?'))
    .join('');
}

export function textWidth(text: string, scale: number): number {
  return text.length === 0 ? 0 : text.length * 6 * scale - scale;
}

export function renderStamp(buf: Buffer, input: StampInput): Buffer {
  const img = jpeg.decode(buf, { useTArray: true, maxMemoryUsageInMB: 512 });
  const { width, height } = img;
  const data = img.data as Uint8Array;
  const scale = Math.max(1, Math.round(width / 640));
  const pad = 2 * scale;
  const lineH = 9 * scale;
  const lines = input.lines.map(toStampText);
  const barH = Math.min(height, lines.length * lineH + 2 * pad);
  const barTop = height - barH;

  const put = (x: number, y: number, c: [number, number, number]) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = (y * width + x) * 4;
    data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
  };

  // Franja inferior: oscurece lo que hay debajo (65 %) para que el texto se lea sobre cualquier foto.
  for (let y = barTop; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data[i] = data[i] * 0.35; data[i + 1] = data[i + 1] * 0.35; data[i + 2] = data[i + 2] * 0.35;
    }
  }

  const drawText = (text: string, x0: number, y0: number, color: [number, number, number]) => {
    for (let n = 0; n < text.length; n++) {
      const glyph = GLYPHS[text[n]] ?? GLYPHS['?'];
      for (let row = 0; row < 7; row++) {
        for (let col = 0; col < 5; col++) {
          if (glyph[row][col] !== '#') continue;
          for (let dy = 0; dy < scale; dy++) {
            for (let dx = 0; dx < scale; dx++) put(x0 + (n * 6 + col) * scale + dx, y0 + row * scale + dy, color);
          }
        }
      }
    }
  };

  lines.forEach((line, i) => drawText(line, pad * 2, barTop + pad + i * lineH, WHITE));

  // Caja del rostro de esta persona (foto de grupo), con grosor proporcional a la imagen.
  const t = Math.max(2, scale * 2);
  for (const box of [input.box, ...(input.boxes ?? [])]) {
    if (!box) continue;
    const x0 = Math.round(box.left * width);
    const y0 = Math.round(box.top * height);
    const x1 = Math.round((box.left + box.width) * width);
    const y1 = Math.round((box.top + box.height) * height);
    for (let k = 0; k < t; k++) {
      for (let x = x0; x <= x1; x++) { put(x, y0 + k, GREEN); put(x, y1 - k, GREEN); }
      for (let y = y0; y <= y1; y++) { put(x0 + k, y, GREEN); put(x1 - k, y, GREEN); }
    }
  }

  // El logotipo ocupa el lugar del rótulo: a la derecha, dentro de la franja.
  if (input.logo) drawLogo(data, width, height, barTop, pad, input.logo);

  return Buffer.from(jpeg.encode({ data: Buffer.from(data), width, height }, 90).data);
}

/** Logotipo de la marca a la derecha de la franja inferior, sobre una placa blanca (se lee sobre cualquier foto). */
function drawLogo(data: Uint8Array, width: number, height: number, barTop: number, barPad: number, mark: StampLogo): void {
  const logo = mark.rgba;
  const LOGO_W = mark.width;
  const LOGO_H = mark.height;
  const plate = Math.max(2, Math.round(barPad / 2));
  const h = height - barTop - 2 * barPad - 2 * plate;
  const w = Math.round((h * LOGO_W) / LOGO_H);
  if (h < 8 || w + 2 * (barPad + plate) > width) return;
  const x0 = width - w - barPad - plate;
  const y0 = barTop + barPad + plate;
  // Placa blanca.
  for (let y = y0 - plate; y < y0 + h + plate; y++) {
    for (let x = x0 - plate; x < x0 + w + plate; x++) {
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const i = (y * width + x) * 4;
      for (let k = 0; k < 3; k++) data[i + k] = 255;
    }
  }
  // Logotipo escalado (bilineal) con su canal alfa.
  for (let y = 0; y < h; y++) {
    const fy = ((y + 0.5) * LOGO_H) / h - 0.5;
    const ya = Math.max(0, Math.floor(fy)), yb = Math.min(LOGO_H - 1, ya + 1), ty = Math.max(0, fy - ya);
    for (let x = 0; x < w; x++) {
      const fx = ((x + 0.5) * LOGO_W) / w - 0.5;
      const xa = Math.max(0, Math.floor(fx)), xb = Math.min(LOGO_W - 1, xa + 1), tx = Math.max(0, fx - xa);
      const px = (xx: number, yy: number, c: number) => logo[(yy * LOGO_W + xx) * 4 + c];
      const s = (c: number) =>
        (px(xa, ya, c) * (1 - tx) + px(xb, ya, c) * tx) * (1 - ty) + (px(xa, yb, c) * (1 - tx) + px(xb, yb, c) * tx) * ty;
      const a = s(3) / 255;
      const i = ((y0 + y) * width + x0 + x) * 4;
      for (let k = 0; k < 3; k++) data[i + k] = data[i + k] * (1 - a) + s(k) * a;
    }
  }
}

/** Formatea la hora del servidor en la zona dada: 2026-10-31 09:14:22. */
export function formatStampTime(iso: string, timeZone: string = DEFAULT_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${g('year')}-${g('month')}-${g('day')} ${g('hour')}:${g('minute')}:${g('second')}`;
}

export function formatStampGps(lat?: number, lng?: number, accuracy?: number): string {
  if (lat === undefined || lng === undefined) return 'SIN UBICACION';
  const acc = accuracy !== undefined ? ` +/-${Math.round(accuracy)} M` : '';
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}${acc}`;
}
