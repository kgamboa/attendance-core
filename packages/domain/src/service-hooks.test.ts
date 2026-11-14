/**
 * Lo que es propio del núcleo y no venía de Agrovid: puertos y ganchos del servicio, formatos de
 * identificadores compatibles con los datos ya guardados, y llaves de archivos.
 */
import jpeg from 'jpeg-js';
import { AttendanceService, recordIdFor, sessionIdFor } from './attendance-service';
import { enrollKey, keyBelongsToTenant, sessionPhotoKey, signatureKey } from './storage-keys';
import type { Platform } from './ports';
import type { StampLogo } from './stamp';
import { InMemoryBlobStorage, InMemoryStore, FakeFaces, defaultPolicy, makeJpeg, testPlatform } from './testing/in-memory';

const T = 'tenant1';
const NOW = new Date('2026-10-31T15:00:00Z');

function build(extra: Partial<ConstructorParameters<typeof AttendanceService>[0]> = {}) {
  const store = new InMemoryStore();
  const storage = new InMemoryBlobStorage();
  const faces = new FakeFaces();
  const svc = new AttendanceService({ store, faces, storage, platform: testPlatform, now: () => NOW, ...extra });
  return { store, storage, faces, svc };
}

describe('código de acceso al cerrar la lista', () => {
  test('sin gancho no se genera ni se guarda ningún código', async () => {
    const { svc, store } = build();
    const s = await svc.openSession(T, { date: '2026-10-31', groupId: 'g-vacio' }, 'u1');
    const out = await svc.closeSession(T, s.sessionId, 'u1', defaultPolicy(), false);
    expect(out.gateCode).toBeUndefined();
    expect((await store.getSession(T, s.sessionId))!.gateCode).toBeUndefined();
  });

  test('con gancho se guarda y se devuelve el código que genera la aplicación', async () => {
    const { svc, store } = build({ accessCode: () => 'ABCD2345' });
    const s = await svc.openSession(T, { date: '2026-10-31', groupId: 'g-vacio' }, 'u1');
    const out = await svc.closeSession(T, s.sessionId, 'u1', defaultPolicy(), false);
    expect(out.gateCode).toBe('ABCD2345');
    expect((await store.getSession(T, s.sessionId))!.gateCode).toBe('ABCD2345');
  });
});

describe('identificadores compatibles con los datos ya guardados', () => {
  test('sessionIdFor conserva el formato de Agrovid: att_<fecha>_<sitio>_<área>_c<grupo>', () => {
    expect(sessionIdFor('2026-10-31', undefined)).toBe('att_2026-10-31');
    expect(sessionIdFor('2026-10-31', 'L1', 'Z1', 'g1')).toBe('att_2026-10-31_L1_Z1_cg1');
    expect(sessionIdFor('2026-10-31', undefined, undefined, 'g1')).toBe('att_2026-10-31_cg1');
  });

  test('recordIdFor es determinista, tiene prefijo rec_ y 24 caracteres hexadecimales', () => {
    const a = recordIdFor(testPlatform, 's1', 'k1', 0);
    expect(a).toMatch(/^rec_[0-9a-f]{24}$/);
    expect(recordIdFor(testPlatform, 's1', 'k1', 0)).toBe(a);
    expect(recordIdFor(testPlatform, 's1', 'k1', 1)).not.toBe(a);
  });

  test('recordIdFor depende solo del hash que da la plataforma', () => {
    const p: Platform = { ...testPlatform, sha1Hex: () => 'f'.repeat(40) };
    expect(recordIdFor(p, 's1', 'k1', 0)).toBe(`rec_${'f'.repeat(24)}`);
  });
});

describe('llaves de archivos', () => {
  const id = () => 'ID';
  test('forma de cada llave', () => {
    expect(enrollKey('t1', 'e1', id)).toBe('attendance/t1/enroll/e1/ID.jpg');
    expect(sessionPhotoKey('t1', '2026-10-31', 's1', id)).toBe('attendance/t1/2026-10-31/s1/ID.jpg');
    expect(signatureKey('t1', 'e1', id)).toBe('attendance/t1/consent/e1/ID.png');
  });

  test('keyBelongsToTenant rechaza otra empresa, escapes de ruta y valores que no son texto', () => {
    expect(keyBelongsToTenant('attendance/t1/x.jpg', 't1')).toBe(true);
    expect(keyBelongsToTenant('attendance/t2/x.jpg', 't1')).toBe(false);
    expect(keyBelongsToTenant('attendance/t1/../t2/x.jpg', 't1')).toBe(false);
    expect(keyBelongsToTenant(undefined, 't1')).toBe(false);
    expect(keyBelongsToTenant(42, 't1')).toBe(false);
  });

  test('el servicio arma las llaves con la plataforma indicada', async () => {
    const platform: Platform = { ...testPlatform, randomUuid: () => 'FIJO' };
    const { svc } = build({ platform });
    const emp = await svc.createEmployee(T, { name: 'Ana López' });
    expect(emp.employeeId).toBe('emp_FIJO');
    await svc.recordConsent(T, emp.employeeId, 'v1', 'hr1', Buffer.from('png'));
    const up = await svc.newEnrollUpload(T, emp.employeeId);
    expect(up.key).toBe(`attendance/${T}/enroll/emp_FIJO/FIJO.jpg`);
  });
});

describe('marca del sello', () => {
  const logo = (): StampLogo => {
    const width = 96; const height = 72; const rgba = new Uint8Array(width * height * 4);
    for (let i = 0; i < rgba.length; i += 4) { rgba[i] = 220; rgba[i + 1] = (i / 4) % 200; rgba[i + 2] = 20; rgba[i + 3] = 255; }
    return { width, height, rgba };
  };

  async function stamped(brand?: { logo?: StampLogo }) {
    const { svc, store, storage } = build({ brand });
    const emp = await svc.createEmployee(T, { name: 'Ana López' });
    const s = await svc.openSession(T, { date: '2026-10-31' }, 'u1');
    const key = `attendance/${T}/2026-10-31/${s.sessionId}/p.jpg`;
    storage.objects.set(key, makeJpeg(640, 480, 60));
    await svc.resolve(T, { sessionId: s.sessionId, photoKey: key, faceIndex: 0, idempotencyKey: 'k', employeeId: emp.employeeId }, 'u1', defaultPolicy());
    const rec = (await store.listRecords(s.sessionId))[0];
    return svc.stampedPhoto(T, s.sessionId, rec.recordId);
  }

  test('con logo en la marca el sello lo dibuja; sin marca no', async () => {
    const sin = await stamped();
    const con = await stamped({ logo: logo() });
    expect(con.equals(sin)).toBe(false);
    // Sin marca, la esquina derecha de la franja queda oscura (sin placa blanca).
    const px = jpeg.decode(sin, { useTArray: true });
    const i = (470 * px.width + 620) * 4;
    expect(px.data[i]).toBeLessThan(120);
  });
});
