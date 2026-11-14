import { AttendanceService, AttendanceError, sessionIdFor } from './attendance-service';
import { InMemoryStore, InMemoryBlobStorage, FakeFaces, defaultPolicy, face, makeJpeg, testPlatform } from './testing/in-memory';

const T = 'tenant1';
const NOW = new Date('2026-10-31T15:00:00Z');
const policy = defaultPolicy();

async function setup() {
  const repo = new InMemoryStore();
  const storage = new InMemoryBlobStorage();
  const faces = new FakeFaces();
  const svc = new AttendanceService({ store: repo, faces, storage, platform: testPlatform, now: () => NOW });
  const ana = await svc.createEmployee(T, { name: 'Ana López', groupId: 'c1' });
  const beto = await svc.createEmployee(T, { name: 'Beto Ruiz', groupId: 'c1' });
  const carla = await svc.createEmployee(T, { name: 'Carla Soto', groupId: 'c1' });
  await svc.assignGroup(T, { groupId: 'c1', siteId: 'L1', from: '2026-10-01' }, 'u1');
  const session = await svc.openSession(T, { siteId: 'L1', date: '2026-10-31' }, 'u1');
  const photo = `attendance/${T}/2026-10-31/${session.sessionId}/p1.jpg`;
  storage.objects.set(photo, makeJpeg());
  return { repo, storage, faces, svc, ana, beto, carla, session, photo };
}

describe('openSession', () => {
  test('sin cuadrilla espera a todo el personal activo, guarda el destino informativo y es idempotente', async () => {
    const { svc, ana, beto, carla, session } = await setup();
    expect(session.sessionId).toBe(sessionIdFor('2026-10-31', undefined));
    expect(session.siteId).toBe('L1'); // destino informativo, no forma parte del id
    expect(session.expectedEmployeeIds.sort()).toEqual([ana.employeeId, beto.employeeId, carla.employeeId].sort());
    const again = await svc.openSession(T, { siteId: 'L1', date: '2026-10-31' }, 'u2');
    expect(again.openedBy).toBe('u1');
  });
});

describe('lista por cuadrilla', () => {
  test('dos cuadrillas el mismo día tienen listas separadas, cada una con su gente', async () => {
    const { svc } = await setup();
    const d1 = await svc.createEmployee(T, { name: 'Diego Paz', groupId: 'c2' });
    const a = await svc.openSession(T, { siteId: 'L1', date: '2026-10-31', groupId: 'c1' }, 'u1');
    const b = await svc.openSession(T, { siteId: 'L1', date: '2026-10-31', groupId: 'c2' }, 'u1');
    expect(a.sessionId).not.toBe(b.sessionId);
    expect(a.sessionId).toBe(sessionIdFor('2026-10-31', undefined, undefined, 'c1'));
    expect(b.expectedEmployeeIds).toEqual([d1.employeeId]);
    expect(a.expectedEmployeeIds).not.toContain(d1.employeeId);
  });
});

describe('identify', () => {
  test('99%+ registra solo y reinicia el contador de inasistencias', async () => {
    const { svc, repo, faces, ana, session, photo } = await setup();
    await repo.updateEmployee(T, ana.employeeId, { missCount: 2 });
    faces.detected = [face(0.4)];
    faces.searchQueue = [[{ employeeId: ana.employeeId, similarity: 99.7 }]];
    const { results } = await svc.identify(T, { sessionId: session.sessionId, photoKey: photo, idempotencyKey: 'k1' }, 'u1', policy);
    expect(results[0]).toMatchObject({ kind: 'AUTO', employee: { name: 'Ana López' } });
    expect(repo.records).toHaveLength(1);
    expect(repo.records[0]).toMatchObject({ method: 'AUTO', employeeId: ana.employeeId, serverTs: NOW.toISOString() });
    expect((await repo.getEmployee(T, ana.employeeId))!.missCount).toBe(0);
  });

  test('reintentar con la misma Idempotency-Key no duplica registros', async () => {
    const { svc, repo, faces, ana, session, photo } = await setup();
    faces.detected = [face(0.4)];
    faces.searchQueue = [[{ employeeId: ana.employeeId, similarity: 99.7 }], [{ employeeId: ana.employeeId, similarity: 99.7 }]];
    const input = { sessionId: session.sessionId, photoKey: photo, idempotencyKey: 'k1' };
    await svc.identify(T, input, 'u1', policy);
    const second = await svc.identify(T, input, 'u1', policy);
    expect(repo.records).toHaveLength(1);
    expect(second.results[0]).toMatchObject({ kind: 'AUTO', alreadyPresent: true });
  });

  test('entre umbrales pide confirmar y no guarda registro', async () => {
    const { svc, repo, faces, ana, beto, session, photo } = await setup();
    faces.detected = [face(0.4)];
    faces.searchQueue = [[{ employeeId: ana.employeeId, similarity: 91 }, { employeeId: beto.employeeId, similarity: 86 }]];
    const { results } = await svc.identify(T, { sessionId: session.sessionId, photoKey: photo, idempotencyKey: 'k2' }, 'u1', policy);
    expect(results[0].kind).toBe('NEEDS_CONFIRMATION');
    expect(repo.records).toHaveLength(0);
  });

  test('alguien de otra cuadrilla nunca se registra solo, aunque pase el 99%', async () => {
    const { svc, repo, faces, session, photo } = await setup();
    const otro = await svc.createEmployee(T, { name: 'Otto Vega', groupId: 'c9' });
    faces.detected = [face(0.4)];
    faces.searchQueue = [[{ employeeId: otro.employeeId, similarity: 99.9 }]];
    const { results } = await svc.identify(T, { sessionId: session.sessionId, photoKey: photo, idempotencyKey: 'k3' }, 'u1', policy);
    expect(results[0]).toMatchObject({ kind: 'NEEDS_CONFIRMATION', candidates: [{ name: 'Otto Vega', inGroup: false }] });
    expect(repo.records).toHaveLength(0);
  });

  test('rechaza más rostros que el máximo y fotos sin rostro', async () => {
    const { svc, faces, session, photo } = await setup();
    faces.detected = [face(0.1), face(0.3), face(0.5), face(0.7)];
    await expect(svc.identify(T, { sessionId: session.sessionId, photoKey: photo, idempotencyKey: 'a' }, 'u1', policy))
      .rejects.toMatchObject({ code: 'TOO_MANY_FACES' });
    faces.detected = [];
    await expect(svc.identify(T, { sessionId: session.sessionId, photoKey: photo, idempotencyKey: 'b' }, 'u1', policy))
      .rejects.toMatchObject({ code: 'NO_FACE' });
  });

  test('rostro pequeño se marca TOO_SMALL sin buscar', async () => {
    const { svc, faces, session, photo } = await setup();
    faces.detected = [face(0.4, 0.05)]; // 0.05 * 400 px = 20 px < 60
    const { results } = await svc.identify(T, { sessionId: session.sessionId, photoKey: photo, idempotencyKey: 'c' }, 'u1', policy);
    expect(results[0].kind).toBe('TOO_SMALL');
  });

  test('no acepta llaves de otra empresa', async () => {
    const { svc, session } = await setup();
    await expect(svc.identify(T, { sessionId: session.sessionId, photoKey: 'attendance/otra/x.jpg', idempotencyKey: 'd' }, 'u1', policy))
      .rejects.toMatchObject({ code: 'INVALID_KEY' });
  });

  test('vista previa: no guarda nada y respeta el tope de cuadros', async () => {
    const { svc, repo, faces, ana, session, photo } = await setup();
    faces.detected = [face(0.4)];
    faces.searchQueue = [[{ employeeId: ana.employeeId, similarity: 99.9 }]];
    const tight = defaultPolicy({ live: { frameIntervalMs: 1500, maxFramesPerSession: 1, frameWidthPx: 640 } });
    const r = await svc.identify(T, { sessionId: session.sessionId, photoKey: photo, idempotencyKey: 'p', preview: true }, 'u1', tight);
    expect(r.results[0].kind).toBe('AUTO');
    expect(repo.records).toHaveLength(0);
    await expect(svc.identify(T, { sessionId: session.sessionId, photoKey: photo, idempotencyKey: 'p2', preview: true }, 'u1', tight))
      .rejects.toMatchObject({ code: 'LIVE_LIMIT' });
  });
});

describe('vista previa con imagen en la petición', () => {
  test('no necesita llave de S3, no guarda nada y cuenta cuadros', async () => {
    const { svc, repo, faces, ana, session } = await setup();
    faces.detected = [face(0.4)];
    faces.searchQueue = [[{ employeeId: ana.employeeId, similarity: 99.9 }]];
    const r = await svc.identify(T, { sessionId: session.sessionId, photoKey: '', idempotencyKey: 'p', preview: true, previewImage: makeJpeg() }, 'u1', policy);
    expect(r.results[0].kind).toBe('AUTO');
    expect(repo.records).toHaveLength(0);
    expect((await repo.getSession(T, session.sessionId))!.liveFrames).toBe(1);
  });
  test('sin vista previa, la imagen en la petición se ignora y se exige llave', async () => {
    const { svc, session } = await setup();
    await expect(svc.identify(T, { sessionId: session.sessionId, photoKey: '', idempotencyKey: 'q', previewImage: makeJpeg() }, 'u1', policy))
      .rejects.toMatchObject({ code: 'INVALID_KEY' });
  });
});

describe('resolve', () => {
  test('confirmar un candidato crea un registro CONFIRMED', async () => {
    const { svc, repo, beto, session, photo } = await setup();
    const r = await svc.resolve(T, { sessionId: session.sessionId, photoKey: photo, faceIndex: 0, idempotencyKey: 'r1', employeeId: beto.employeeId }, 'u1', policy);
    expect(r.method).toBe('CONFIRMED');
    expect(repo.records[0].employeeId).toBe(beto.employeeId);
  });

  test('persona extra: exige nombre completo y no toca el padrón', async () => {
    const { svc, repo, session, photo } = await setup();
    await expect(svc.resolve(T, { sessionId: session.sessionId, photoKey: photo, faceIndex: 0, idempotencyKey: 'r2', extraName: 'Pedro' }, 'u1', policy))
      .rejects.toMatchObject({ code: 'INVALID_INPUT' });
    const before = repo.employees.size;
    const r = await svc.resolve(T, { sessionId: session.sessionId, photoKey: photo, faceIndex: 0, idempotencyKey: 'r3', extraName: 'Pedro Gil' }, 'u1', policy);
    expect(r.method).toBe('EXTRA');
    expect(repo.records[0]).toMatchObject({ extraName: 'Pedro Gil', method: 'EXTRA' });
    expect(repo.employees.size).toBe(before);
  });

  test('con allowExtras apagado rechaza personas extra', async () => {
    const { svc, session, photo } = await setup();
    await expect(svc.resolve(T, { sessionId: session.sessionId, photoKey: photo, faceIndex: 0, idempotencyKey: 'r4', extraName: 'Pedro Gil' }, 'u1', defaultPolicy({ allowExtras: false })))
      .rejects.toMatchObject({ code: 'EXTRAS_DISABLED' });
  });
});

describe('cierre y rotación', () => {
  test('no cierra con faltantes sin decidir; con todo decidido cierra y no se puede editar', async () => {
    const { svc, repo, ana, beto, carla, session, photo } = await setup();
    await svc.resolve(T, { sessionId: session.sessionId, photoKey: photo, faceIndex: 0, idempotencyKey: 'x', employeeId: ana.employeeId }, 'u1', policy);
    await expect(svc.closeSession(T, session.sessionId, 'u1', policy, true)).rejects.toMatchObject({ code: 'MISSING_UNDECIDED' });
    await svc.setMissingDecision(T, session.sessionId, beto.employeeId, 'ABSENT');
    await svc.setMissingDecision(T, session.sessionId, carla.employeeId, 'JUSTIFIED', 'incapacidad');
    const out = await svc.closeSession(T, session.sessionId, 'u1', policy, true);
    expect(out.closed).toBe(true);
    expect((await repo.getEmployee(T, beto.employeeId))!.missCount).toBe(1);
    expect((await repo.getEmployee(T, carla.employeeId))!.missCount).toBe(0); // justificada no cuenta
    await expect(svc.closeSession(T, session.sessionId, 'u1', policy, true)).rejects.toMatchObject({ code: 'SESSION_CLOSED' });
  });

  test('las notas del cierre quedan en la lista como bitácora (recortadas a 500)', async () => {
    const { svc, repo, ana, beto, carla, session, photo } = await setup();
    await svc.resolve(T, { sessionId: session.sessionId, photoKey: photo, faceIndex: 0, idempotencyKey: 'n', employeeId: ana.employeeId }, 'u1', policy);
    await svc.setMissingDecision(T, session.sessionId, beto.employeeId, 'ABSENT');
    await svc.setMissingDecision(T, session.sessionId, carla.employeeId, 'ABSENT');
    await svc.closeSession(T, session.sessionId, 'u1', policy, false, `  Llegó el camión de insumos ${'x'.repeat(600)}  `);
    const saved = await repo.getSession(T, session.sessionId);
    expect(saved!.notes).toMatch(/^Llegó el camión de insumos/);
    expect(saved!.notes!.length).toBe(500);
  });

  test('tercera inasistencia consecutiva genera pre-baja; asistir la cancela', async () => {
    const { svc, repo, beto, session } = await setup();
    await repo.updateEmployee(T, beto.employeeId, { missCount: 2 });
    for (const id of session.expectedEmployeeIds) await svc.setMissingDecision(T, session.sessionId, id, 'ABSENT');
    const out = await svc.closeSession(T, session.sessionId, 'u1', policy, true);
    expect(out.preTermination).toEqual([beto.employeeId]);
    expect((await repo.getEmployee(T, beto.employeeId))!.status).toBe('PRE_TERMINATION');

    const s2 = await svc.openSession(T, { siteId: 'L1', date: '2026-11-01' }, 'u1');
    const photo2 = `attendance/${T}/2026-11-01/${s2.sessionId}/p.jpg`;
    await svc.resolve(T, { sessionId: s2.sessionId, photoKey: photo2, faceIndex: 0, idempotencyKey: 'y', employeeId: beto.employeeId }, 'u1', policy);
    const b = (await repo.getEmployee(T, beto.employeeId))!;
    expect(b.status).toBe('ACTIVE');
    expect(b.missCount).toBe(0);
  });

  test('con rotación apagada no cambia estados', async () => {
    const { svc, repo, beto, session } = await setup();
    await repo.updateEmployee(T, beto.employeeId, { missCount: 5 });
    for (const id of session.expectedEmployeeIds) await svc.setMissingDecision(T, session.sessionId, id, 'ABSENT');
    await svc.closeSession(T, session.sessionId, 'u1', policy, false);
    expect((await repo.getEmployee(T, beto.employeeId))!.missCount).toBe(5);
    expect((await repo.getEmployee(T, beto.employeeId))!.status).toBe('ACTIVE');
  });
});

describe('enrolamiento', () => {
  async function ready() {
    const s = await setup();
    await s.svc.recordConsent(T, s.ana.employeeId, 'v1', 'hr1');
    return s;
  }
  const key = (id: string, n: number) => `attendance/${T}/enroll/${id}/${n}.jpg`;

  test('sin consentimiento no se puede subir ni enrolar', async () => {
    const { svc, beto } = await setup();
    await expect(svc.newEnrollUpload(T, beto.employeeId)).rejects.toMatchObject({ code: 'CONSENT_REQUIRED' });
  });

  test('con 4 fotos aceptadas queda ENROLLED (la quinta es opcional)', async () => {
    const { svc, repo, storage, faces, ana } = await ready();
    for (let n = 1; n <= 4; n++) {
      storage.objects.set(key(ana.employeeId, n), makeJpeg());
      faces.detected = [face(0.4)];
      faces.indexResults = [{ faceId: `f${n}` }];
      const r = await svc.enrollPhoto(T, ana.employeeId, key(ana.employeeId, n), 'hr1', policy);
      expect(r.enrolled).toBe(n === 4);
    }
    expect((await repo.getEmployee(T, ana.employeeId))!.enrollment).toMatchObject({ status: 'ENROLLED', faceIds: ['f1', 'f2', 'f3', 'f4'] });
  });

  test('rechaza la foto de enrolamiento si no se ven los dos ojos (giro excesivo u ojos cerrados)', async () => {
    const { svc, storage, faces, ana } = await ready();
    const k = key(ana.employeeId, 1);
    storage.objects.set(k, makeJpeg());
    faces.indexResults = [{ faceId: 'f1' }];
    faces.detected = [{ ...face(0.4), yaw: 45 }];
    await expect(svc.enrollPhoto(T, ana.employeeId, k, 'hr1', policy)).rejects.toMatchObject({ code: 'EYES_NOT_VISIBLE' });
    storage.objects.set(k, makeJpeg());
    faces.detected = [{ ...face(0.4), eyesOpen: { value: false, confidence: 97 } }];
    await expect(svc.enrollPhoto(T, ana.employeeId, k, 'hr1', policy)).rejects.toMatchObject({ code: 'EYES_NOT_VISIBLE' });
    storage.objects.set(k, makeJpeg());
    faces.detected = [{ ...face(0.4), yaw: 18, eyesOpen: { value: true, confidence: 99 } }];
    await expect(svc.enrollPhoto(T, ana.employeeId, k, 'hr1', policy)).resolves.toMatchObject({ accepted: true });
  });

  test('rechaza fotos de archivo (con EXIF o más grandes que la captura) y las borra', async () => {
    const { svc, storage, faces, ana } = await ready();
    const k = key(ana.employeeId, 1);
    faces.detected = [face(0.4)];
    faces.indexResults = [{ faceId: 'f1' }];
    const base = makeJpeg();
    const exif = Buffer.concat([base.subarray(0, 2), Buffer.from([0xff, 0xe1, 0x00, 0x08]), Buffer.from('Exif\0\0'), base.subarray(2)]);
    storage.objects.set(k, exif);
    // Apagado por defecto: una foto con EXIF se acepta.
    expect(policy.requireLiveEnrollCapture).toBe(false);
    const on = { ...policy, requireLiveEnrollCapture: true };
    await expect(svc.enrollPhoto(T, ana.employeeId, k, 'hr1', on)).rejects.toMatchObject({ code: 'NOT_LIVE_CAPTURE' });
    expect(storage.objects.has(k)).toBe(false);
    storage.objects.set(k, base);
    await expect(svc.enrollPhoto(T, ana.employeeId, k, 'hr1', { ...on, captureMaxWidthPx: 1 })).rejects.toMatchObject({ code: 'NOT_LIVE_CAPTURE' });
  });

  test('duplicado: un rostro ya enrolado en otra persona se avisa, no se indexa y se borra la foto', async () => {
    const { svc, repo, storage, faces, ana, beto } = await ready();
    storage.objects.set(key(ana.employeeId, 1), makeJpeg());
    faces.detected = [face(0.4)];
    faces.indexResults = [{ faceId: 'f1' }];
    faces.searchQueue = [[{ employeeId: beto.employeeId, similarity: 99.6 }]];
    await expect(svc.enrollPhoto(T, ana.employeeId, key(ana.employeeId, 1), 'hr1', policy))
      .rejects.toMatchObject({ code: 'DUPLICATE_FACE', detail: { name: beto.name, similarity: 99.6 } });
    expect(storage.objects.has(key(ana.employeeId, 1))).toBe(false);
    expect((await repo.getEmployee(T, ana.employeeId))!.enrollment.faceIds).toEqual([]);
  });

  test('duplicado: con confirmación explícita se enrola; el propio rostro de la persona no cuenta', async () => {
    const { svc, storage, faces, ana, beto } = await ready();
    storage.objects.set(key(ana.employeeId, 1), makeJpeg());
    faces.detected = [face(0.4)];
    faces.indexResults = [{ faceId: 'f1' }, { faceId: 'f2' }];
    faces.searchQueue = [[{ employeeId: beto.employeeId, similarity: 99.6 }]];
    await expect(svc.enrollPhoto(T, ana.employeeId, key(ana.employeeId, 1), 'hr1', policy, { confirmDuplicate: true }))
      .resolves.toMatchObject({ accepted: true, photos: 1 });
    storage.objects.set(key(ana.employeeId, 2), makeJpeg());
    faces.searchQueue = [[{ employeeId: ana.employeeId, similarity: 100 }]];
    await expect(svc.enrollPhoto(T, ana.employeeId, key(ana.employeeId, 2), 'hr1', policy)).resolves.toMatchObject({ photos: 2 });
  });

  test('volver a enrolar a alguien con datos borrados limpia la marca de borrado', async () => {
    const { svc, repo, storage, faces, ana } = await ready();
    await repo.updateEmployee(T, ana.employeeId, { biometricsDeletedAt: '2026-10-30T10:00:00Z' });
    storage.objects.set(key(ana.employeeId, 1), makeJpeg());
    faces.detected = [face(0.4)];
    faces.indexResults = [{ faceId: 'f1' }];
    await svc.enrollPhoto(T, ana.employeeId, key(ana.employeeId, 1), 'hr1', policy);
    expect((await repo.getEmployee(T, ana.employeeId))!.biometricsDeletedAt).toBeFalsy();
  });

  test('editar persona: cambia nombre, número y cuadrilla; rechaza nombre incompleto', async () => {
    const { svc, repo, ana } = await ready();
    await svc.updateEmployeeProfile(T, ana.employeeId, { name: 'Ana María Pérez', employeeNumber: '77', groupId: 'crew1' });
    expect(await repo.getEmployee(T, ana.employeeId)).toMatchObject({ name: 'Ana María Pérez', employeeNumber: '77', groupId: 'crew1' });
    await svc.updateEmployeeProfile(T, ana.employeeId, { name: 'Ana María Pérez' });
    expect((await repo.getEmployee(T, ana.employeeId))!.groupId).toBeFalsy();
    await expect(svc.updateEmployeeProfile(T, ana.employeeId, { name: 'Ana' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  test('el número de empleado no se puede repetir al crear ni al editar', async () => {
    const { svc, ana } = await ready();
    await svc.updateEmployeeProfile(T, ana.employeeId, { name: 'Ana María Pérez', employeeNumber: '55' });
    await expect(svc.createEmployee(T, { name: 'Luis Gómez Ruiz', employeeNumber: '55' })).rejects.toMatchObject({ code: 'DUPLICATE_NUMBER' });
    const luis = await svc.createEmployee(T, { name: 'Luis Gómez Ruiz', employeeNumber: '56' });
    await expect(svc.updateEmployeeProfile(T, luis.employeeId, { name: 'Luis Gómez Ruiz', employeeNumber: '55' })).rejects.toMatchObject({ code: 'DUPLICATE_NUMBER' });
    await svc.updateEmployeeProfile(T, ana.employeeId, { name: 'Ana María Pérez', employeeNumber: '55' });
  });

  test('borrar persona: se elimina si nunca tuvo asistencias y se rechaza si ya tiene', async () => {
    const { svc, repo, ana } = await ready();
    repo.records.push({ tenantId: T, sessionId: 's1', recordId: 'r1', employeeId: ana.employeeId } as never);
    await expect(svc.deleteEmployee(T, ana.employeeId, 'hr1', 'alta por error')).rejects.toMatchObject({ code: 'HAS_ATTENDANCE' });
    expect(await repo.getEmployee(T, ana.employeeId)).not.toBeNull();
    repo.records.length = 0;
    await svc.deleteEmployee(T, ana.employeeId, 'hr1', 'alta por error');
    expect(await repo.getEmployee(T, ana.employeeId)).toBeNull();
  });

  test('repetir una foto: quita su rostro y su archivo; bajo el mínimo vuelve a enrolando', async () => {
    const { svc, repo, storage, faces, ana } = await ready();
    for (let n = 1; n <= 3; n++) {
      storage.objects.set(key(ana.employeeId, n), makeJpeg());
      faces.detected = [face(0.4)];
      faces.indexResults = [{ faceId: `f${n}` }];
      await svc.enrollPhoto(T, ana.employeeId, key(ana.employeeId, n), 'hr1', policy);
    }
    const r = await svc.removeEnrollPhoto(T, ana.employeeId, 2, policy);
    expect(r).toEqual({ photos: 2, enrolled: false });
    expect(storage.objects.has(key(ana.employeeId, 2))).toBe(false);
    expect((await repo.getEmployee(T, ana.employeeId))!.enrollment).toMatchObject({ status: 'NONE', faceIds: ['f1', 'f3'] });
    await expect(svc.removeEnrollPhoto(T, ana.employeeId, 9, policy)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  test('una foto rechazada se borra de S3', async () => {
    const { svc, storage, faces, ana } = await ready();
    storage.objects.set(key(ana.employeeId, 1), makeJpeg());
    faces.detected = [face(0.2), face(0.6)];
    await expect(svc.enrollPhoto(T, ana.employeeId, key(ana.employeeId, 1), 'hr1', policy)).rejects.toMatchObject({ code: 'MULTIPLE_FACES' });
    expect(storage.objects.has(key(ana.employeeId, 1))).toBe(false);
  });

  test('no acepta la llave de enrolamiento de otra persona', async () => {
    const { svc, ana, beto } = await ready();
    await expect(svc.enrollPhoto(T, ana.employeeId, key(beto.employeeId, 1), 'hr1', policy)).rejects.toMatchObject({ code: 'INVALID_KEY' });
  });
});

describe('borrado biométrico', () => {
  test('borra rostros y fotos de enrolamiento, y deja bitácora sin datos del rostro', async () => {
    const { svc, repo, storage, faces, ana } = await setup();
    const k = `attendance/${T}/enroll/${ana.employeeId}/1.jpg`;
    storage.objects.set(k, makeJpeg());
    await repo.updateEmployee(T, ana.employeeId, { enrollment: { status: 'ENROLLED', faceIds: ['f1', 'f2'], photoKeys: [k] } });
    const d = await svc.deleteBiometrics(T, ana.employeeId, 'hr1', 'baja', false);
    expect(d).toMatchObject({ facesDeleted: 2, enrollPhotosDeleted: 1, attendancePhotosDeleted: 0 });
    expect(faces.deletedFaces).toEqual(['f1', 'f2']);
    expect(storage.objects.has(k)).toBe(false);
    const e = (await repo.getEmployee(T, ana.employeeId))!;
    expect(e.enrollment).toEqual({ status: 'NONE', faceIds: [], photoKeys: [] });
    expect(e.biometricsDeletedAt).toBeDefined();
    // La bitácora no guarda ids de rostro ni llaves de fotos (se comparan valores exactos: el folio es un UUID aleatorio).
    const log = JSON.stringify(repo.deletions[0]);
    expect(log).not.toContain('"f1"');
    expect(log).not.toContain('"f2"');
    expect(log).not.toContain(k);
    expect(log).not.toContain('photoKey');
    expect(log).not.toContain('faceId');
  });

  test('foto de una sola persona se borra; foto de grupo se conserva con su rostro tapado', async () => {
    const { svc, repo, storage, ana, beto, session } = await setup();
    const solo = `attendance/${T}/2026-10-31/${session.sessionId}/solo.jpg`;
    const group = `attendance/${T}/2026-10-31/${session.sessionId}/group.jpg`;
    storage.objects.set(solo, makeJpeg());
    const original = makeJpeg(200, 100, 200);
    storage.objects.set(group, original);
    const box = { left: 0.1, top: 0.1, width: 0.3, height: 0.5 };
    await svc.resolve(T, { sessionId: session.sessionId, photoKey: solo, faceIndex: 0, faceBox: box, idempotencyKey: 's', employeeId: ana.employeeId }, 'u1', policy);
    await svc.resolve(T, { sessionId: session.sessionId, photoKey: group, faceIndex: 0, faceBox: box, idempotencyKey: 'g1', employeeId: ana.employeeId }, 'u1', policy);
    await svc.resolve(T, { sessionId: session.sessionId, photoKey: group, faceIndex: 1, faceBox: { left: 0.6, top: 0.1, width: 0.3, height: 0.5 }, idempotencyKey: 'g2', employeeId: beto.employeeId }, 'u1', policy);

    const d = await svc.deleteBiometrics(T, ana.employeeId, 'hr1', 'baja', true);
    expect(d.attendancePhotosDeleted).toBe(2);
    expect(storage.objects.has(solo)).toBe(false);
    expect(storage.objects.has(group)).toBe(true);
    expect(storage.objects.get(group)!.equals(original)).toBe(false);
    const anaRecords = repo.records.filter((r) => r.employeeId === ana.employeeId);
    expect(anaRecords.every((r) => !r.photoKey)).toBe(true);
    expect(repo.records.find((r) => r.employeeId === beto.employeeId)!.photoKey).toBe(group);
  });

  test('terminate respeta la política: con KEEP no toca las fotos de asistencia', async () => {
    const { svc, repo, storage, ana, session } = await setup();
    const p = `attendance/${T}/2026-10-31/${session.sessionId}/solo.jpg`;
    storage.objects.set(p, makeJpeg());
    await svc.resolve(T, { sessionId: session.sessionId, photoKey: p, faceIndex: 0, idempotencyKey: 's', employeeId: ana.employeeId }, 'u1', policy);
    await svc.terminate(T, ana.employeeId, 'hr1', 'renuncia', defaultPolicy({ photoRetention: 'KEEP' }));
    expect(storage.objects.has(p)).toBe(true);
    expect((await repo.getEmployee(T, ana.employeeId))!.status).toBe('INACTIVE');
  });
});

describe('foto con sello', () => {
  test('arma la foto con sello a partir del registro y no cambia el original guardado', async () => {
    const { svc, repo, storage, ana, session } = await setup();
    const key = `attendance/${T}/2026-10-31/${session.sessionId}/g.jpg`;
    const original = makeJpeg(640, 480, 200);
    storage.objects.set(key, original);
    await svc.resolve(T, {
      sessionId: session.sessionId, photoKey: key, faceIndex: 0, faceBox: { left: 0.2, top: 0.2, width: 0.2, height: 0.3 },
      idempotencyKey: 'st', employeeId: ana.employeeId, gps: { lat: 20.5, lng: -100.2, accuracy: 15, outsideSite: true },
    }, 'u1', policy);
    const rec = repo.records[0];
    const out = await svc.stampedPhoto(T, session.sessionId, rec.recordId);
    expect(out.equals(original)).toBe(false);
    expect(storage.objects.get(key)!.equals(original)).toBe(true); // el original no se toca
    expect(rec.flags).toContain('OUTSIDE_SITE');
  });

  test('sin foto (borrada) o de otra empresa responde NOT_FOUND', async () => {
    const { svc, repo, ana, session } = await setup();
    const key = `attendance/${T}/2026-10-31/${session.sessionId}/g.jpg`;
    await svc.resolve(T, { sessionId: session.sessionId, photoKey: key, faceIndex: 0, idempotencyKey: 'x', employeeId: ana.employeeId }, 'u1', policy);
    const rid = repo.records[0].recordId;
    await expect(svc.stampedPhoto('otra', session.sessionId, rid)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await repo.clearRecordPhoto(session.sessionId, rid);
    await expect(svc.stampedPhoto(T, session.sessionId, rid)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('reporte', () => {
  test('junta las listas del rango con sus registros y respeta el aislamiento', async () => {
    const { svc, ana, beto, carla, session } = await setup();
    await svc.resolve(T, { sessionId: session.sessionId, photoKey: `attendance/${T}/x.jpg`, faceIndex: 0, idempotencyKey: 'r1', employeeId: ana.employeeId }, 'u1', policy);
    await svc.setMissingDecision(T, session.sessionId, beto.employeeId, 'ABSENT');
    await svc.setMissingDecision(T, session.sessionId, carla.employeeId, 'JUSTIFIED', 'permiso');
    const r = await svc.report(T, { from: '2026-10-01', to: '2026-10-31' });
    expect(r.totals).toMatchObject({ sessions: 1, present: 1, absent: 1, justified: 1 });
    expect(r.persons.find((p) => p.employeeId === ana.employeeId)).toMatchObject({ present: 1, pct: 100 });
    expect((await svc.report('otra', { from: '2026-10-01', to: '2026-10-31' })).totals.sessions).toBe(0);
    expect((await svc.report(T, { from: '2026-11-01', to: '2026-11-30' })).days).toHaveLength(0);
  });
});

describe('aislamiento entre empresas', () => {
  test('no se puede leer ni modificar un empleado de otra empresa', async () => {
    const { svc, ana } = await setup();
    await expect(svc.recordConsent('otraEmpresa', ana.employeeId, 'v1', 'x')).rejects.toBeInstanceOf(AttendanceError);
    await expect(svc.deleteBiometrics('otraEmpresa', ana.employeeId, 'x', 'x', true)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('identifyAnyone (caseta)', () => {
  test('99%+ de un activo sale AUTO; no guarda registros ni fotos', async () => {
    const { svc, repo, storage, faces, ana } = await setup();
    faces.detected = [face(0.4)];
    faces.searchQueue = [[{ employeeId: ana.employeeId, similarity: 99.7 }]];
    const before = storage.objects.size;
    const r = await svc.identifyAnyone(T, makeJpeg(), policy);
    expect(r[0]).toMatchObject({ kind: 'AUTO', employee: { name: 'Ana López', status: 'ACTIVE' } });
    expect(repo.records).toHaveLength(0);
    expect(storage.objects.size).toBe(before);
  });

  test('alguien dado de baja nunca entra solo: se avisa que está de baja', async () => {
    const { svc, repo, faces, ana } = await setup();
    await repo.updateEmployee(T, ana.employeeId, { status: 'INACTIVE' });
    faces.detected = [face(0.4)];
    faces.searchQueue = [[{ employeeId: ana.employeeId, similarity: 99.9 }]];
    const r = await svc.identifyAnyone(T, makeJpeg(), policy);
    expect(r[0]).toMatchObject({ kind: 'TERMINATED', employee: { status: 'INACTIVE' } });
  });

  test('sin coincidencia es UNKNOWN y sin rostro falla con NO_FACE', async () => {
    const { svc, faces } = await setup();
    faces.detected = [face(0.4)];
    faces.searchQueue = [[]];
    expect((await svc.identifyAnyone(T, makeJpeg(), policy))[0].kind).toBe('UNKNOWN');
    faces.detected = [];
    await expect(svc.identifyAnyone(T, makeJpeg(), policy)).rejects.toMatchObject({ code: 'NO_FACE' });
  });
});
