import jpeg from 'jpeg-js';
import { cropFace, pixelAt, readJpegSize, redactFace } from './face-crop';

function makeJpeg(width: number, height: number): Buffer {
  const data = Buffer.alloc(width * height * 4, 200);
  return Buffer.from(jpeg.encode({ data, width, height }, 80).data);
}

describe('face-crop', () => {
  test('lee el tamaño de un JPEG', () => {
    expect(readJpegSize(makeJpeg(120, 80))).toEqual({ width: 120, height: 80 });
  });

  test('recorta la caja con margen y devuelve un JPEG válido', () => {
    const out = cropFace(makeJpeg(200, 100), { left: 0.4, top: 0.3, width: 0.2, height: 0.4 }, 0);
    const size = readJpegSize(out);
    expect(size.width).toBe(40);
    expect(size.height).toBe(40);
  });

  test('el margen se acota a los bordes de la imagen', () => {
    const out = cropFace(makeJpeg(100, 100), { left: 0, top: 0, width: 0.5, height: 0.5 }, 1);
    const size = readJpegSize(out);
    expect(size.width).toBeLessThanOrEqual(100);
    expect(size.height).toBeLessThanOrEqual(100);
    expect(size.width).toBeGreaterThanOrEqual(50);
  });

  test('redactFace tapa solo la caja indicada', () => {
    const out = redactFace(makeJpeg(100, 100), { left: 0.4, top: 0.4, width: 0.2, height: 0.2 }, 0);
    const [r] = pixelAt(out, 50, 50);
    const [r2] = pixelAt(out, 5, 5);
    expect(r).toBeLessThan(30);
    expect(r2).toBeGreaterThan(150);
  });
});
