/**
 * Prueba de arquitectura: el núcleo no depende de ninguna nube ni aplicación.
 * Solo puede importar archivos propios y `jpeg-js`, y no puede leer variables de entorno.
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const SRC = __dirname;
const ALLOWED_PACKAGES = new Set(['jpeg-js']);

const files = readdirSync(SRC).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));

describe('arquitectura del núcleo', () => {
  test('hay archivos que revisar', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  test.each(files)('%s solo importa archivos propios y paquetes permitidos', (file) => {
    const text = readFileSync(join(SRC, file), 'utf8');
    const specs = [...text.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
    for (const spec of specs) {
      if (spec.startsWith('./')) continue;
      expect([spec, ALLOWED_PACKAGES.has(spec)]).toEqual([spec, true]);
    }
  });

  test.each(files)('%s no lee el entorno ni usa servicios de nube', (file) => {
    const text = readFileSync(join(SRC, file), 'utf8');
    expect(text).not.toMatch(/process\.env/);
    expect(text).not.toMatch(/@aws-sdk|firebase|cloudflare|DynamoDB|require\(/i);
  });
});
