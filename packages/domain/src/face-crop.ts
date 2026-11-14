/**
 * face-crop.ts — Recorta un rostro de un JPEG (JS puro, sin binarios nativos).
 *
 * Rekognition solo busca el rostro más grande de una imagen, así que para identificar a
 * varias personas de una misma foto se recorta cada caja y se busca por separado. El
 * recorte se hace en el servidor para no depender de lo que mande el celular.
 *
 * La Mini App exporta la foto desde un <canvas>: sin EXIF, sin rotación pendiente. Si una
 * foto trajera orientación EXIF, las cajas de Rekognition ya vienen corregidas y el recorte
 * saldría desfasado; por eso el flujo exige la foto de la Mini App.
 */
import jpeg from 'jpeg-js';

export interface FaceBox {
  /** Razones 0–1 respecto al ancho/alto de la imagen (formato BoundingBox de Rekognition). */
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface JpegInfo {
  width: number;
  height: number;
}

export function readJpegSize(buf: Buffer): JpegInfo {
  const img = jpeg.decode(buf, { useTArray: true, maxMemoryUsageInMB: 512 });
  return { width: img.width, height: img.height };
}

export function cropFace(buf: Buffer, box: FaceBox, margin = 0.35, quality = 90): Buffer {
  const img = jpeg.decode(buf, { useTArray: true, maxMemoryUsageInMB: 512 });
  const mx = box.width * margin;
  const my = box.height * margin;
  const x0 = Math.max(0, Math.round((box.left - mx) * img.width));
  const y0 = Math.max(0, Math.round((box.top - my) * img.height));
  const x1 = Math.min(img.width, Math.round((box.left + box.width + mx) * img.width));
  const y1 = Math.min(img.height, Math.round((box.top + box.height + my) * img.height));
  const w = Math.max(1, x1 - x0);
  const h = Math.max(1, y1 - y0);

  const out = Buffer.alloc(w * h * 4);
  for (let row = 0; row < h; row++) {
    const src = ((y0 + row) * img.width + x0) * 4;
    out.set((img.data as Uint8Array).subarray(src, src + w * 4), row * w * 4);
  }
  return Buffer.from(jpeg.encode({ data: out, width: w, height: h }, quality).data);
}

/** Tapa con negro la caja de un rostro (con margen). Se usa para borrar a una persona de una foto de grupo. */
export function redactFace(buf: Buffer, box: FaceBox, margin = 0.2, quality = 90): Buffer {
  const img = jpeg.decode(buf, { useTArray: true, maxMemoryUsageInMB: 512 });
  const mx = box.width * margin;
  const my = box.height * margin;
  const x0 = Math.max(0, Math.round((box.left - mx) * img.width));
  const y0 = Math.max(0, Math.round((box.top - my) * img.height));
  const x1 = Math.min(img.width, Math.round((box.left + box.width + mx) * img.width));
  const y1 = Math.min(img.height, Math.round((box.top + box.height + my) * img.height));
  const data = img.data as Uint8Array;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * img.width + x) * 4;
      data[i] = 0; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 255;
    }
  }
  return Buffer.from(jpeg.encode({ data: Buffer.from(data), width: img.width, height: img.height }, quality).data);
}

/** Lee el color de un pixel (solo para pruebas). */
export function pixelAt(buf: Buffer, x: number, y: number): [number, number, number] {
  const img = jpeg.decode(buf, { useTArray: true, maxMemoryUsageInMB: 512 });
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
}

/**
 * ¿El JPEG parece salido del <canvas> de la cámara de la Mini App? El canvas no escribe EXIF
 * (APP1) ni miniatura; una foto de galería o archivo casi siempre trae EXIF. Es una barrera
 * contra subir archivos, no una prueba de vida: no detecta fotografiar una pantalla.
 */
export function hasExifSegment(buf: Buffer): boolean {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return false;
  let i = 2;
  while (i + 4 <= buf.length && buf[i] === 0xff) {
    const marker = buf[i + 1];
    if (marker === 0xda || marker === 0xd9) break;
    const len = buf.readUInt16BE(i + 2);
    if (marker === 0xe1 && buf.subarray(i + 4, i + 8).toString('latin1') === 'Exif') return true;
    i += 2 + len;
  }
  return false;
}
