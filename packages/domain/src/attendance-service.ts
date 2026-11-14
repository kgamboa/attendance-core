/**
 * attendance-service.ts — Reglas de la asistencia por rostro.
 *
 * Orquesta los puertos (`ports.ts`): almacén, reconocimiento facial y archivos. No conoce HTTP ni
 * ninguna nube: la aplicación traduce `AttendanceError` a su canal (en Agrovid, códigos de estado).
 * Vocabulario genérico: sitio (`siteId`, `areaId`) y grupo (`groupId`).
 */
import type {
  AttendancePolicy, AttendanceRecord, AttendanceSession, BiometricDeletion, GroupAssignment,
  Employee, MissingDecision, RecordFlag, RecordMethod,
} from './model';
import { normalizeName } from './model';
import type { AttendanceStore, BlobStorage, Brand, FaceRecognition, Platform } from './ports';
import { enrollKey, keyBelongsToTenant, sessionPhotoKey, signatureKey } from './storage-keys';
import { DEFAULT_TIMEZONE } from './constants';
import { cropFace, hasExifSegment, readJpegSize, redactFace, type FaceBox } from './face-crop';
import { decideMatch, type FaceCandidate, type MatchDecision } from './decide-match';
import { buildRoster, canCloseSession, isValidDecision, type RosterView } from './roster';
import { applyAbsence, applyAttendance } from './rotation';
import { buildReport, type AttendanceReport, type ReportFilters, type TimeOptions } from './report';
import { formatStampGps, formatStampTime, renderStamp } from './stamp';

export type AttendanceErrorCode =
  | 'NOT_FOUND' | 'CONSENT_REQUIRED' | 'INVALID_KEY' | 'NOT_LIVE_CAPTURE' | 'NO_FACE' | 'MULTIPLE_FACES' | 'FACE_TOO_SMALL' | 'EYES_NOT_VISIBLE'
  | 'LOW_QUALITY' | 'TOO_MANY_FACES' | 'SESSION_CLOSED' | 'MISSING_UNDECIDED' | 'INVALID_DECISION'
  | 'GEOFENCE_OUTSIDE' | 'GEOFENCE_NO_LOCATION' | 'GEOFENCE_LOW_ACCURACY'
  | 'EXTRAS_DISABLED' | 'INVALID_INPUT' | 'LIVE_LIMIT' | 'ALREADY_ENROLLING' | 'INVALID_RANGE' | 'RANGE_TOO_LARGE' | 'HAS_ATTENDANCE' | 'DUPLICATE_NUMBER' | 'DUPLICATE_FACE';

export class AttendanceError extends Error {
  constructor(public code: AttendanceErrorCode, public detail?: Record<string, unknown>) {
    super(code);
  }
}

export interface AttendanceDeps {
  store: AttendanceStore;
  faces: FaceRecognition;
  storage: BlobStorage;
  platform: Platform;
  /** Marca del sello de las fotos. */
  brand?: Brand;
  now?: () => Date;
  /**
   * Genera el código corto de acceso que se guarda al cerrar una lista (por ejemplo para el QR de
   * un punto de acceso). Sin esta función no se genera ningún código.
   */
  accessCode?: () => string;
}

export interface Gps { lat?: number; lng?: number; accuracy?: number; outsideSite?: boolean; outsideZones?: boolean; zoneName?: string }

export type FaceResult =
  | { index: number; box: FaceBox; kind: 'AUTO'; employee: EmployeeRef; similarity: number; alreadyPresent: boolean; recordId?: string }
  | { index: number; box: FaceBox; kind: 'NEEDS_CONFIRMATION'; candidates: (EmployeeRef & { similarity: number; inGroup: boolean })[] }
  | { index: number; box: FaceBox; kind: 'TERMINATED'; employee: StatusRef; similarity: number }
  | { index: number; box: FaceBox; kind: 'UNKNOWN' }
  | { index: number; box: FaceBox; kind: 'TOO_SMALL' };

type StatusRef = EmployeeRef & { status: Employee['status'] };
export type OpenFaceResult =
  | { index: number; box: FaceBox; kind: 'AUTO'; employee: StatusRef; similarity: number }
  | { index: number; box: FaceBox; kind: 'NEEDS_CONFIRMATION'; candidates: (StatusRef & { similarity: number })[] }
  | { index: number; box: FaceBox; kind: 'TERMINATED'; employee: StatusRef; similarity: number }
  | { index: number; box: FaceBox; kind: 'UNKNOWN' }
  | { index: number; box: FaceBox; kind: 'TOO_SMALL' };

export interface EmployeeRef { employeeId: string; name: string }

/** Giro máximo de la cabeza en enrolamiento: más allá, un ojo deja de verse. */
const MAX_ENROLL_YAW_DEG = 30;

const METHOD_LABEL: Record<RecordMethod, string> = {
  AUTO: 'REGISTRO AUTOMATICO', CONFIRMED: 'CONFIRMADO POR SUPERVISOR', MANUAL: 'MANUAL', EXTRA: 'PERSONA EXTRA',
};

const ref = (e: Employee): EmployeeRef => ({ employeeId: e.employeeId, name: e.name });

/** Una lista por día, sitio (y zona) y, si se pasa, por grupo: dos grupos del mismo sitio no se pisan. */
export function sessionIdFor(date: string, siteId: string | undefined, areaId?: string, groupId?: string): string {
  return `att_${date}${siteId ? `_${siteId}` : ''}${areaId ? `_${areaId}` : ''}${groupId ? `_c${groupId}` : ''}`;
}

export function recordIdFor(platform: Platform, sessionId: string, idempotencyKey: string, index: number): string {
  return `rec_${platform.sha1Hex(`${sessionId}|${idempotencyKey}|${index}`).slice(0, 24)}`;
}

/** YYYY-MM-DD en la zona horaria dada. */
export function localDate(now: Date, timeZone: string = DEFAULT_TIMEZONE): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export class AttendanceService {
  private repo: AttendanceStore;
  private faces: FaceRecognition;
  private storage: BlobStorage;
  private platform: Platform;
  private brand?: Brand;
  private now: () => Date;
  private accessCode?: () => string;

  constructor(deps: AttendanceDeps) {
    this.repo = deps.store;
    this.faces = deps.faces;
    this.storage = deps.storage;
    this.platform = deps.platform;
    this.brand = deps.brand;
    this.now = deps.now ?? (() => new Date());
    this.accessCode = deps.accessCode;
  }

  private newId = (): string => this.platform.randomUuid();

  // ── Padrón ─────────────────────────────────────────────────────────────────
  /** El número de empleado no se puede repetir en la empresa (vacío = sin número). */
  private async assertNumberFree(tenantId: string, number: string | undefined, exceptId?: string): Promise<void> {
    const n = number?.trim();
    if (!n) return;
    const taken = (await this.repo.listEmployees(tenantId)).some((e) => e.employeeId !== exceptId && e.employeeNumber?.trim() === n);
    if (taken) throw new AttendanceError('DUPLICATE_NUMBER');
  }

  async createEmployee(
    tenantId: string,
    input: { name: string; employeeNumber?: string; groupId?: string; importSource?: string; externalId?: string },
  ): Promise<Employee> {
    const name = input.name?.trim();
    if (!name || name.split(/\s+/).length < 2) throw new AttendanceError('INVALID_INPUT', { field: 'name' });
    await this.assertNumberFree(tenantId, input.employeeNumber);
    const e: Employee = {
      employeeId: `emp_${this.platform.randomUuid()}`, tenantId, name, nameNormalized: normalizeName(name),
      employeeNumber: input.employeeNumber, groupId: input.groupId, status: 'ACTIVE', missCount: 0,
      enrollment: { status: 'NONE', faceIds: [], photoKeys: [] },
      importSource: input.importSource, externalId: input.externalId,
      createdAt: this.now().toISOString(),
    };
    await this.repo.putEmployee(e);
    return e;
  }

  /** Edita nombre, número y grupo (`groupId` vacío la quita). El resto de los datos no se toca. */
  async updateEmployeeProfile(
    tenantId: string, employeeId: string, input: { name: string; employeeNumber?: string; groupId?: string },
  ): Promise<void> {
    await this.mustEmployee(tenantId, employeeId);
    const name = input.name?.trim();
    if (!name || name.split(/\s+/).length < 2) throw new AttendanceError('INVALID_INPUT', { field: 'name' });
    await this.assertNumberFree(tenantId, input.employeeNumber, employeeId);
    await this.repo.updateEmployee(tenantId, employeeId, {
      name, nameNormalized: normalizeName(name),
      employeeNumber: input.employeeNumber?.trim() || '', groupId: input.groupId || '',
    });
  }

  async recordConsent(
    tenantId: string, employeeId: string, version: string, recordedBy: string, signaturePng?: Buffer,
  ): Promise<Employee> {
    const emp = await this.mustEmployee(tenantId, employeeId);
    let sigKey: string | undefined;
    if (signaturePng?.length) {
      sigKey = signatureKey(tenantId, employeeId, this.newId);
      await this.storage.putBuffer(sigKey, signaturePng, 'image/png');
    }
    const consent = { acceptedAt: this.now().toISOString(), version, recordedBy, signatureKey: sigKey };
    await this.repo.updateEmployee(tenantId, employeeId, { consent });
    return { ...emp, consent };
  }

  async newEnrollUpload(tenantId: string, employeeId: string): Promise<{ uploadUrl: string; key: string }> {
    const emp = await this.mustEmployee(tenantId, employeeId);
    if (!emp.consent) throw new AttendanceError('CONSENT_REQUIRED');
    const key = enrollKey(tenantId, employeeId, this.newId);
    return { uploadUrl: await this.storage.newUploadUrl(key, 'image/jpeg'), key };
  }

  /** Valida y indexa una foto de enrolamiento (una sola persona). Si no sirve, la borra. */
  async enrollPhoto(
    tenantId: string, employeeId: string, key: string, actor: string, policy: AttendancePolicy,
    opts: { confirmDuplicate?: boolean } = {},
  ): Promise<{ accepted: true; photos: number; enrolled: boolean }> {
    const emp = await this.mustEmployee(tenantId, employeeId);
    if (!emp.consent) throw new AttendanceError('CONSENT_REQUIRED');
    if (!keyBelongsToTenant(key, tenantId) || !key.startsWith(`attendance/${tenantId}/enroll/${employeeId}/`)) {
      throw new AttendanceError('INVALID_KEY');
    }
    const img = await this.storage.getBuffer(key);
    try {
      const { width } = readJpegSize(img);
      // La foto debe salir de la cámara de la Mini App, no de un archivo o galería.
      if (policy.requireLiveEnrollCapture && (hasExifSegment(img) || width > policy.captureMaxWidthPx)) throw new AttendanceError('NOT_LIVE_CAPTURE');
      const detected = await this.faces.detectFaces(img);
      if (detected.length === 0) throw new AttendanceError('NO_FACE');
      if (detected.length > 1) throw new AttendanceError('MULTIPLE_FACES');
      if (detected[0].box.width * width < policy.minFacePx) throw new AttendanceError('FACE_TOO_SMALL');
      // Los dos ojos deben verse: giro excesivo de la cabeza u ojos cerrados con certeza.
      const f0 = detected[0];
      if ((f0.yaw !== undefined && Math.abs(f0.yaw) > MAX_ENROLL_YAW_DEG)
        || (f0.eyesOpen && !f0.eyesOpen.value && f0.eyesOpen.confidence >= 90)) {
        throw new AttendanceError('EYES_NOT_VISIBLE');
      }
      // Duplicados: el mismo rostro ya enrolado en OTRA persona de la empresa. Se avisa y no se indexa
      // salvo confirmación explícita (la foto rechazada se borra; el cliente la vuelve a subir al confirmar).
      if (!opts.confirmDuplicate) {
        const dup = await this.findDuplicateOwner(tenantId, employeeId, img, policy);
        if (dup) throw new AttendanceError('DUPLICATE_FACE', { name: dup.name, employeeNumber: dup.employeeNumber, similarity: dup.similarity });
      }
      const indexed = await this.faces.index(tenantId, img, employeeId);
      if (!indexed) throw new AttendanceError('LOW_QUALITY');

      const faceIds = [...emp.enrollment.faceIds, indexed.faceId];
      const photoKeys = [...emp.enrollment.photoKeys, key];
      const enrolled = faceIds.length >= policy.minEnrollPhotos;
      await this.repo.updateEmployee(tenantId, employeeId, {
        // Volver a enrolar a alguien cuyos datos biométricos se borraron: ya no cuenta como "borrado".
        ...(emp.biometricsDeletedAt ? { biometricsDeletedAt: '' } : {}),
        enrollment: {
          ...emp.enrollment, faceIds, photoKeys, status: enrolled ? 'ENROLLED' : emp.enrollment.status,
          enrolledAt: enrolled ? (emp.enrollment.enrolledAt ?? this.now().toISOString()) : emp.enrollment.enrolledAt,
          enrolledBy: enrolled ? (emp.enrollment.enrolledBy ?? actor) : emp.enrollment.enrolledBy,
        },
      });
      return { accepted: true, photos: faceIds.length, enrolled };
    } catch (e) {
      // Una foto rechazada no debe quedarse guardada: es un dato biométrico sin uso.
      await this.storage.deleteMany([key]).catch(() => undefined);
      throw e;
    }
  }

  /** Persona distinta con un rostro enrolado casi idéntico (similitud >= umbral automático), si existe. */
  private async findDuplicateOwner(
    tenantId: string, employeeId: string, img: Buffer, policy: AttendancePolicy,
  ): Promise<{ name: string; employeeNumber?: string; similarity: number } | null> {
    const hits = (await this.faces.search(tenantId, img, policy.thresholdAuto))
      .filter((c) => c.employeeId !== employeeId)
      .sort((a, b) => b.similarity - a.similarity);
    for (const h of hits) {
      const other = await this.repo.getEmployee(tenantId, h.employeeId);
      if (other) return { name: other.name, employeeNumber: other.employeeNumber, similarity: Math.round(h.similarity * 10) / 10 };
    }
    return null;
  }

  // ── Grupos ─────────────────────────────────────────────────────────────
  async assignGroup(
    tenantId: string,
    input: { groupId: string; siteId: string; areaId?: string; taskId?: string; from: string; to?: string },
    actor: string,
  ): Promise<GroupAssignment> {
    const a: GroupAssignment = {
      tenantId, assignmentId: `asg_${this.platform.randomUuid()}`, ...input, assignedBy: actor, createdAt: this.now().toISOString(),
    };
    await this.repo.putAssignment(a);
    return a;
  }

  // ── Sesión del día ─────────────────────────────────────────────────────────
  async openSession(
    tenantId: string,
    input: { date?: string; siteId?: string; areaId?: string; groupId?: string; timeZone?: string },
    actor: string,
  ): Promise<AttendanceSession> {
    const date = input.date ?? localDate(this.now(), input.timeZone);
    // El destino (sitio) es informativo: la lista es por día y grupo.
    const sessionId = sessionIdFor(date, undefined, input.areaId, input.groupId);
    const existing = await this.repo.getSession(tenantId, sessionId);

    const siteId = input.siteId ?? '';
    // Con grupo, se espera a sus integrantes; sin ella, a todo el personal activo.
    const groupIds: string[] = input.groupId ? [input.groupId] : [];
    const employees = await this.repo.listEmployees(tenantId);
    const expected = employees
      .filter((e) => e.status !== 'INACTIVE' && (!input.groupId || (!!e.groupId && groupIds.includes(e.groupId))))
      .map((e) => e.employeeId);

    if (existing) {
      // Una lista abierta se retoma, pero quien se dio de alta o se asignó a la grupo después
      // de abrirla (p. ej. Ada) debe aparecer: se agrega sin quitar a nadie.
      if (existing.status === 'OPEN') {
        const known = new Set(existing.expectedEmployeeIds);
        const added = expected.filter((id) => !known.has(id));
        if (added.length) {
          const merged = [...existing.expectedEmployeeIds, ...added];
          await this.repo.updateSession(tenantId, sessionId, { expectedEmployeeIds: merged });
          return { ...existing, expectedEmployeeIds: merged };
        }
      }
      return existing;
    }

    const session: AttendanceSession = {
      tenantId, sessionId, date, siteId, areaId: input.areaId, status: 'OPEN',
      groupIds, expectedEmployeeIds: expected, missingDecisions: {}, openedBy: actor, openedAt: this.now().toISOString(),
    };
    const created = await this.repo.createSession(session);
    return created ? session : (await this.repo.getSession(tenantId, sessionId))!;
  }

  // ── Identificar ────────────────────────────────────────────────────────────
  /**
   * Foto de hasta N personas → resultado por rostro. En `preview` (vista en vivo) solo
   * devuelve nombres: no guarda registros ni toca la foto.
   */
  async identify(
    tenantId: string,
    input: { sessionId: string; photoKey: string; idempotencyKey: string; gps?: Gps; preview?: boolean; previewImage?: Buffer },
    actor: string,
    policy: AttendancePolicy,
  ): Promise<{ results: FaceResult[]; photoKey: string }> {
    const session = await this.mustSession(tenantId, input.sessionId);
    // La vista previa en vivo manda los bytes del cuadro en la petición (sin pasar por el almacén de archivos);
    // todo lo demás exige una llave de la propia empresa.
    const inline = input.preview === true && !!input.previewImage;
    if (!inline && !keyBelongsToTenant(input.photoKey, tenantId)) throw new AttendanceError('INVALID_KEY');
    if (!input.preview && session.status !== 'OPEN') throw new AttendanceError('SESSION_CLOSED');
    if (input.preview) {
      const used = await this.repo.incrementLiveFrames(tenantId, session.sessionId);
      if (used > policy.live.maxFramesPerSession) throw new AttendanceError('LIVE_LIMIT');
    }

    const img = inline ? input.previewImage! : await this.storage.getBuffer(input.photoKey);
    const { width } = readJpegSize(img);
    const detected = await this.faces.detectFaces(img);
    if (detected.length === 0) throw new AttendanceError('NO_FACE');
    if (detected.length > policy.maxFacesPerPhoto) {
      throw new AttendanceError('TOO_MANY_FACES', { found: detected.length, max: policy.maxFacesPerPhoto });
    }

    const employees = new Map((await this.repo.listEmployees(tenantId)).map((e) => [e.employeeId, e]));
    const expected = new Set(session.expectedEmployeeIds);
    const decideOpts = {
      thresholdAuto: policy.thresholdAuto, thresholdConfirm: policy.thresholdConfirm, ambiguityMargin: policy.ambiguityMargin,
    };
    const existingRecords = input.preview ? [] : await this.repo.listRecords(session.sessionId);
    const presentNow = new Set(buildRoster(session, existingRecords).presentEmployeeIds);

    const results: FaceResult[] = [];
    for (let i = 0; i < detected.length; i++) {
      const { box } = detected[i];
      if (box.width * width < policy.minFacePx) { results.push({ index: i, box, kind: 'TOO_SMALL' }); continue; }
      const crop = detected.length === 1 ? img : cropFace(img, box);
      const raw = (await this.faces.search(tenantId, crop, policy.thresholdConfirm))
        .filter((c) => employees.get(c.employeeId)?.status !== 'INACTIVE' && employees.has(c.employeeId));

      // Primero entre los esperados de la grupo; si nadie coincide, entre todos pero siempre a confirmar.
      let decision: MatchDecision = decideMatch(raw.filter((c) => expected.has(c.employeeId)), decideOpts);
      let outOfGroup = false;
      if (decision.kind === 'UNKNOWN' && raw.length) {
        const wide = decideMatch(raw, decideOpts);
        if (wide.kind !== 'UNKNOWN') {
          outOfGroup = true;
          decision = wide.kind === 'AUTO'
            ? { kind: 'NEEDS_CONFIRMATION', candidates: [{ employeeId: wide.employeeId, similarity: wide.similarity }] }
            : wide;
        }
      }
      results.push(this.toResult(i, box, decision, employees, expected, presentNow, outOfGroup));
    }

    if (input.preview) return { results, photoKey: input.photoKey };

    // Registro definitivo: la foto limpia queda como evidencia, con metadata puesta por el servidor.
    const serverTs = this.now().toISOString();
    await this.storage.putBuffer(input.photoKey, img, 'image/jpeg', {
      tenantid: tenantId, sessionid: session.sessionId, servertime: serverTs, sha256: this.platform.sha256Hex(img),
    });
    const flags = this.gpsFlags(input.gps, policy);
    for (const r of results) {
      if (r.kind !== 'AUTO' || r.alreadyPresent) continue;
      const recordId = await this.writeRecord(session, {
        index: r.index, idempotencyKey: input.idempotencyKey, employeeId: r.employee.employeeId, method: 'AUTO',
        similarity: r.similarity, photoKey: input.photoKey, photoSha256: this.platform.sha256Hex(img), faceBox: r.box,
        gps: input.gps, flags, actor, serverTs,
      });
      r.recordId = recordId;
      await this.markAttended(tenantId, employees.get(r.employee.employeeId)!, serverTs);
    }
    return { results, photoKey: input.photoKey };
  }

  /**
   * Sin lista: identifica a quien está frente a la cámara contra todo el padrón activo (por ejemplo, un
   * quiosco o una caseta). No guarda la
   * foto ni escribe registros (el paso lo registra el vigilante después). Hay que confirmar siempre
   * cuando la coincidencia no es clara; nunca se acepta sola a alguien dado de baja.
   */
  async identifyAnyone(tenantId: string, image: Buffer, policy: AttendancePolicy): Promise<OpenFaceResult[]> {
    const { width } = readJpegSize(image);
    const detected = await this.faces.detectFaces(image);
    if (detected.length === 0) throw new AttendanceError('NO_FACE');
    if (detected.length > policy.maxFacesPerPhoto) {
      throw new AttendanceError('TOO_MANY_FACES', { found: detected.length, max: policy.maxFacesPerPhoto });
    }
    const employees = new Map((await this.repo.listEmployees(tenantId)).map((e) => [e.employeeId, e]));
    const opts = { thresholdAuto: policy.thresholdAuto, thresholdConfirm: policy.thresholdConfirm, ambiguityMargin: policy.ambiguityMargin };
    const out: OpenFaceResult[] = [];
    for (let i = 0; i < detected.length; i++) {
      const { box } = detected[i];
      if (box.width * width < policy.minFacePx) { out.push({ index: i, box, kind: 'TOO_SMALL' }); continue; }
      const crop = detected.length === 1 ? image : cropFace(image, box);
      const raw = (await this.faces.search(tenantId, crop, policy.thresholdConfirm)).filter((c) => employees.has(c.employeeId));
      const d = decideMatch(raw, opts);
      const info = (id: string) => { const e = employees.get(id)!; return { ...ref(e), status: e.status }; };
      if (d.kind === 'AUTO') {
        const who = info(d.employeeId);
        out.push(who.status === 'ACTIVE'
          ? { index: i, box, kind: 'AUTO', employee: who, similarity: d.similarity }
          : who.status === 'INACTIVE'
            ? { index: i, box, kind: 'TERMINATED', employee: who, similarity: d.similarity }
            : { index: i, box, kind: 'NEEDS_CONFIRMATION', candidates: [{ ...who, similarity: d.similarity }] });
      } else if (d.kind === 'NEEDS_CONFIRMATION') {
        out.push({ index: i, box, kind: 'NEEDS_CONFIRMATION', candidates: d.candidates.map((c: FaceCandidate) => ({ ...info(c.employeeId), similarity: c.similarity })) });
      } else out.push({ index: i, box, kind: 'UNKNOWN' });
    }
    return out;
  }

  private toResult(
    index: number, box: FaceBox, d: MatchDecision, employees: Map<string, Employee>,
    expected: Set<string>, present: Set<string>, outOfGroup: boolean,
  ): FaceResult {
    if (d.kind === 'AUTO') {
      const emp = employees.get(d.employeeId)!;
      return { index, box, kind: 'AUTO', employee: ref(emp), similarity: d.similarity, alreadyPresent: present.has(emp.employeeId) };
    }
    if (d.kind === 'NEEDS_CONFIRMATION') {
      return {
        index, box, kind: 'NEEDS_CONFIRMATION',
        candidates: d.candidates.map((c: FaceCandidate) => ({
          ...ref(employees.get(c.employeeId)!), similarity: c.similarity, inGroup: !outOfGroup && expected.has(c.employeeId),
        })),
      };
    }
    return { index, box, kind: 'UNKNOWN' };
  }

  /** El supervisor confirma un candidato (o elige a otra persona), o registra una persona extra. */
  async resolve(
    tenantId: string,
    input: {
      sessionId: string; photoKey: string; faceIndex: number; faceBox?: FaceBox; idempotencyKey: string;
      employeeId?: string; extraName?: string; gps?: Gps;
    },
    actor: string,
    policy: AttendancePolicy,
  ): Promise<{ recordId: string; method: RecordMethod }> {
    const session = await this.mustSession(tenantId, input.sessionId);
    if (session.status !== 'OPEN') throw new AttendanceError('SESSION_CLOSED');
    if (!keyBelongsToTenant(input.photoKey, tenantId)) throw new AttendanceError('INVALID_KEY');
    const serverTs = this.now().toISOString();
    const flags = this.gpsFlags(input.gps, policy);

    let employee: Employee | undefined;
    let method: RecordMethod;
    if (input.employeeId) {
      employee = await this.mustEmployee(tenantId, input.employeeId);
      if (employee.status === 'INACTIVE') throw new AttendanceError('NOT_FOUND');
      method = 'CONFIRMED';
    } else {
      if (!policy.allowExtras) throw new AttendanceError('EXTRAS_DISABLED');
      const name = input.extraName?.trim();
      if (!name || name.split(/\s+/).length < 2) throw new AttendanceError('INVALID_INPUT', { field: 'extraName' });
      method = 'EXTRA';
    }

    const recordId = await this.writeRecord(session, {
      index: input.faceIndex, idempotencyKey: input.idempotencyKey, employeeId: employee?.employeeId,
      extraName: employee ? undefined : input.extraName!.trim(), method, photoKey: input.photoKey,
      faceBox: input.faceBox, gps: input.gps, flags, actor, serverTs,
    });
    if (employee) await this.markAttended(tenantId, employee, serverTs);
    return { recordId, method };
  }

  private async writeRecord(
    session: AttendanceSession,
    r: {
      index: number; idempotencyKey: string; employeeId?: string; extraName?: string; method: RecordMethod;
      similarity?: number; photoKey?: string; photoSha256?: string; faceBox?: FaceBox; gps?: Gps;
      flags: RecordFlag[]; actor: string; serverTs: string;
    },
  ): Promise<string> {
    const recordId = recordIdFor(this.platform, session.sessionId, r.idempotencyKey, r.index);
    const record: AttendanceRecord = {
      sessionId: session.sessionId, recordId, tenantId: session.tenantId, date: session.date,
      employeeId: r.employeeId, extraName: r.extraName, method: r.method, similarity: r.similarity,
      photoKey: r.photoKey, photoSha256: r.photoSha256, faceBox: r.faceBox, serverTs: r.serverTs,
      lat: r.gps?.lat, lng: r.gps?.lng, accuracy: r.gps?.accuracy, zoneName: r.gps?.zoneName, flags: r.flags,
      idempotencyKey: r.idempotencyKey, capturedBy: r.actor,
    };
    await this.repo.putRecord(record); // false = reintento idempotente: mismo recordId, no se duplica
    return recordId;
  }

  private gpsFlags(gps: Gps | undefined, policy: AttendancePolicy): RecordFlag[] {
    const flags: RecordFlag[] = [];
    if (gps?.accuracy !== undefined && gps.accuracy > policy.gpsMaxAccuracyM) flags.push('LOW_ACCURACY');
    if (gps?.outsideSite && policy.geofenceMode === 'FLAG') flags.push('OUTSIDE_SITE');
    if (gps?.outsideZones && policy.geofenceMode === 'FLAG') flags.push('OUTSIDE_ZONES');
    return flags;
  }

  /** Asistir reinicia el contador de inasistencias y cancela una pre-baja pendiente. */
  private async markAttended(tenantId: string, emp: Employee, serverTs: string): Promise<void> {
    const outcome = applyAttendance(emp);
    const updates: Partial<Employee> = { missCount: outcome.missCount, lastAttendanceAt: serverTs };
    if (outcome.action === 'CANCEL_PRE_TERMINATION') {
      updates.status = 'ACTIVE';
      updates.preTerminationAt = undefined;
    }
    await this.repo.updateEmployee(tenantId, emp.employeeId, updates);
  }

  // ── Vista y cierre ─────────────────────────────────────────────────────────
  async getSessionView(tenantId: string, sessionId: string): Promise<{
    session: AttendanceSession; roster: RosterView; records: AttendanceRecord[];
    employees: Record<string, EmployeeRef & { status: Employee['status'] }>;
  }> {
    const session = await this.mustSession(tenantId, sessionId);
    const records = await this.repo.listRecords(sessionId);
    const roster = buildRoster(session, records);
    const all = await this.repo.listEmployees(tenantId);
    const needed = new Set([...session.expectedEmployeeIds, ...roster.presentEmployeeIds]);
    const employees: Record<string, EmployeeRef & { status: Employee['status'] }> = {};
    // Además de la lista esperada se incluye a todo el personal activo: quien no es de la grupo
    // elegida debe poder escogerse al registrar una cara sin identificar.
    for (const e of all) if (needed.has(e.employeeId) || e.status !== 'INACTIVE') employees[e.employeeId] = { ...ref(e), status: e.status };
    return { session, roster, records, employees };
  }

  async setMissingDecision(
    tenantId: string, sessionId: string, employeeId: string, decision: MissingDecision, reason?: string,
  ): Promise<void> {
    if (!isValidDecision(decision)) throw new AttendanceError('INVALID_DECISION');
    if (decision === 'JUSTIFIED' && !reason?.trim()) throw new AttendanceError('INVALID_INPUT', { field: 'reason' });
    const session = await this.mustSession(tenantId, sessionId);
    if (session.status !== 'OPEN') throw new AttendanceError('SESSION_CLOSED');
    await this.repo.updateSession(tenantId, sessionId, {
      missingDecisions: { ...session.missingDecisions, [employeeId]: { decision, reason: reason?.trim() } },
    });
  }

  async closeSession(
    tenantId: string, sessionId: string, actor: string, policy: AttendancePolicy, rotationEnabled: boolean, notes?: string,
  ): Promise<{ closed: true; gateCode?: string; preTermination: string[]; recommendTermination: string[]; terminated: string[] }> {
    const { session, roster } = await this.getSessionView(tenantId, sessionId);
    if (session.status !== 'OPEN') throw new AttendanceError('SESSION_CLOSED');
    if (!canCloseSession(roster)) throw new AttendanceError('MISSING_UNDECIDED', { undecided: roster.undecidedEmployeeIds });

    const gateCode = this.accessCode?.();
    const out = { closed: true as const, gateCode, preTermination: [] as string[], recommendTermination: [] as string[], terminated: [] as string[] };
    if (rotationEnabled) {
      const employees = new Map((await this.repo.listEmployees(tenantId)).map((e) => [e.employeeId, e]));
      for (const id of roster.missingEmployeeIds) {
        if (session.missingDecisions[id]?.decision !== 'ABSENT') continue; // justificadas no cuentan
        const emp = employees.get(id);
        if (!emp) continue;
        const r = applyAbsence(emp, policy.rotation);
        const updates: Partial<Employee> = { missCount: r.missCount };
        if (r.action === 'PRE_TERMINATION') {
          updates.status = 'PRE_TERMINATION';
          updates.preTerminationAt = this.now().toISOString();
          out.preTermination.push(id);
        } else if (r.action === 'RECOMMEND_TERMINATION') {
          out.recommendTermination.push(id);
        }
        await this.repo.updateEmployee(tenantId, id, updates);
        if (r.action === 'TERMINATE') {
          await this.terminate(tenantId, id, actor, 'Baja automática por inasistencias', policy);
          out.terminated.push(id);
        }
      }
    }
    await this.repo.updateSession(tenantId, sessionId, { status: 'CLOSED', closedBy: actor, closedAt: this.now().toISOString(), gateCode, ...(notes?.trim() ? { notes: notes.trim().slice(0, 500) } : {}) });
    return out;
  }

  // ── Pre-baja y baja ────────────────────────────────────────────────────────
  async decidePreBaja(
    tenantId: string, employeeId: string, decision: 'KEEP' | 'TERMINATE', actor: string, reason: string,
    policy: AttendancePolicy,
  ): Promise<void> {
    const emp = await this.mustEmployee(tenantId, employeeId);
    if (decision === 'KEEP') {
      await this.repo.updateEmployee(tenantId, employeeId, { status: 'ACTIVE', missCount: 0, preTerminationAt: undefined });
      return;
    }
    if (emp.status === 'INACTIVE') return;
    await this.terminate(tenantId, employeeId, actor, reason, policy);
  }

  /** Baja: marca inactivo y borra los datos biométricos según la política de la empresa. */
  async terminate(tenantId: string, employeeId: string, actor: string, reason: string, policy: AttendancePolicy) {
    await this.mustEmployee(tenantId, employeeId);
    await this.repo.updateEmployee(tenantId, employeeId, {
      status: 'INACTIVE', terminatedAt: this.now().toISOString(), terminationReason: reason,
    });
    return this.deleteBiometrics(tenantId, employeeId, actor, reason, policy.photoRetention === 'ON_TERMINATION');
  }

  /**
   * Borra el registro de una persona. Solo si nunca tuvo asistencias (altas por error o de prueba);
   * si ya tiene historial se da de baja. Antes borra rostro y fotos de enrolamiento.
   */
  async deleteEmployee(tenantId: string, employeeId: string, actor: string, reason: string): Promise<void> {
    await this.mustEmployee(tenantId, employeeId);
    const records = await this.repo.listRecordsByEmployee(tenantId, employeeId);
    if (records.length > 0) throw new AttendanceError('HAS_ATTENDANCE');
    await this.deleteBiometrics(tenantId, employeeId, actor, reason, true);
    await this.repo.deleteEmployee(tenantId, employeeId);
  }

  // ── Borrado biométrico ─────────────────────────────────────────────────────
  /**
   * Borra el rostro registrado y las fotos de enrolamiento siempre. Las fotos de asistencia solo
   * si `includeAttendancePhotos`. Una foto con más personas no se borra: se tapa el rostro de esta
   * persona y el archivo se queda para las demás. Reintentable: cada paso tolera lo ya borrado.
   */
  async deleteBiometrics(
    tenantId: string, employeeId: string, actor: string, reason: string, includeAttendancePhotos: boolean,
  ): Promise<BiometricDeletion> {
    const emp = await this.mustEmployee(tenantId, employeeId);

    const facesDeleted = await this.faces.deleteFaces(tenantId, emp.enrollment.faceIds);
    const enrollPhotosDeleted = await this.storage.deleteMany(emp.enrollment.photoKeys);

    let attendancePhotosDeleted = 0;
    if (includeAttendancePhotos) {
      const mine = (await this.repo.listRecordsByEmployee(tenantId, employeeId)).filter((r) => r.photoKey);
      for (const rec of mine) {
        const siblings = (await this.repo.listRecords(rec.sessionId))
          .filter((o) => o.photoKey === rec.photoKey && o.recordId !== rec.recordId && o.employeeId !== employeeId);
        if (siblings.length === 0) {
          attendancePhotosDeleted += await this.storage.deleteMany([rec.photoKey!]);
        } else if (rec.faceBox) {
          const buf = await this.storage.getBuffer(rec.photoKey!);
          await this.storage.putBuffer(rec.photoKey!, redactFace(buf, rec.faceBox), 'image/jpeg');
          attendancePhotosDeleted++;
        }
        await this.repo.clearRecordPhoto(rec.sessionId, rec.recordId);
      }
    }

    await this.repo.updateEmployee(tenantId, employeeId, {
      enrollment: { status: 'NONE', faceIds: [], photoKeys: [] },
      biometricsDeletedAt: this.now().toISOString(),
    });
    const deletion: BiometricDeletion = {
      tenantId, deletionId: `del_${this.platform.randomUuid()}`, employeeId, employeeName: emp.name, requestedBy: actor, reason,
      executedAt: this.now().toISOString(), facesDeleted, enrollPhotosDeleted, attendancePhotosDeleted,
    };
    await this.repo.putDeletion(deletion);
    return deletion;
  }

  /**
   * Quita una foto de enrolamiento (la n-ésima, desde 1) para repetirla: borra su rostro en el proveedor de reconocimiento
   * y el archivo. Si quedan menos del mínimo, la persona vuelve a "enrolando".
   */
  async removeEnrollPhoto(
    tenantId: string, employeeId: string, n: number, policy: AttendancePolicy,
  ): Promise<{ photos: number; enrolled: boolean }> {
    const emp = await this.mustEmployee(tenantId, employeeId);
    const i = Math.floor(n) - 1;
    const { faceIds, photoKeys } = emp.enrollment;
    if (!Number.isInteger(i) || i < 0 || i >= faceIds.length) throw new AttendanceError('NOT_FOUND');
    await this.faces.deleteFaces(tenantId, [faceIds[i]]);
    if (photoKeys[i]) await this.storage.deleteMany([photoKeys[i]]).catch(() => undefined);
    const nextFaces = faceIds.filter((_, k) => k !== i);
    const nextKeys = photoKeys.filter((_, k) => k !== i);
    const enrolled = nextFaces.length >= policy.minEnrollPhotos;
    await this.repo.updateEmployee(tenantId, employeeId, {
      enrollment: {
        ...emp.enrollment, faceIds: nextFaces, photoKeys: nextKeys,
        status: enrolled ? emp.enrollment.status : 'NONE',
      },
    });
    return { photos: nextFaces.length, enrolled };
  }

  async photoUrl(tenantId: string, key: string): Promise<string> {
    if (!keyBelongsToTenant(key, tenantId)) throw new AttendanceError('INVALID_KEY');
    return this.storage.signedGetUrl(key, 900);
  }

  /**
   * Foto con sello visible: caja del rostro de la persona, nombre, hora del servidor, ubicación y
   * lugar. Se arma al pedirla, con la foto limpia y los datos del registro; no se guarda otro archivo.
   */
  async stampedPhoto(
    tenantId: string, sessionId: string, recordId: string, opts: { timeZone?: string; allBoxes?: boolean } = {},
  ): Promise<Buffer> {
    await this.mustSession(tenantId, sessionId); // la lista debe ser de la empresa
    const rec = (await this.repo.listRecords(sessionId)).find((r) => r.recordId === recordId && r.tenantId === tenantId);
    if (!rec?.photoKey || !keyBelongsToTenant(rec.photoKey, tenantId)) throw new AttendanceError('NOT_FOUND');

    const name = rec.employeeId ? (await this.mustEmployee(tenantId, rec.employeeId)).name : (rec.extraName ?? '');
    // El sello no lleva el sitio (por ahora); la geocerca de asistencia dice si la captura fue en un lugar válido.
    const flags = [
      rec.zoneName ? `DENTRO DE GEOCERCA ${rec.zoneName}` : '',
      rec.flags.includes('OUTSIDE_ZONES') ? 'FUERA DE GEOCERCA DE ASISTENCIA' : '',
      rec.flags.includes('OUTSIDE_SITE') ? 'FUERA DEL SITIO' : '',
      rec.flags.includes('LOW_ACCURACY') ? 'GPS POCO PRECISO' : '',
    ].filter(Boolean);
    const place = flags.join(' - ');
    const img = await this.storage.getBuffer(rec.photoKey);
    // Miniatura de una foto de grupo: se enmarca a todos los que salen en ella.
    const siblings = opts.allBoxes
      ? (await this.repo.listRecords(sessionId)).filter((r) => r.photoKey === rec.photoKey && r.recordId !== rec.recordId && r.faceBox).map((r) => r.faceBox!)
      : [];
    return renderStamp(img, {
      lines: [
        `${name} - ${METHOD_LABEL[rec.method]}`,
        formatStampTime(rec.serverTs, opts.timeZone),
        formatStampGps(rec.lat, rec.lng, rec.accuracy),
        ...(place ? [place] : []),
      ],
      box: rec.faceBox,
      boxes: siblings,
      logo: this.brand?.logo,
    });
  }

  /** Reporte de asistencia del periodo: lee las listas del rango y sus registros. */
  async report(tenantId: string, filters: ReportFilters, time: TimeOptions = {}): Promise<AttendanceReport> {
    const sessions = await this.repo.listSessionsRange(tenantId, filters.from, filters.to);
    const data = [];
    for (const session of sessions) {
      if (filters.siteId && session.siteId !== filters.siteId) continue;
      data.push({ session, records: await this.repo.listRecords(session.sessionId) });
    }
    return buildReport(data, await this.repo.listEmployees(tenantId), filters, time);
  }

  async newSessionUpload(tenantId: string, sessionId: string): Promise<{ uploadUrl: string; key: string }> {
    const session = await this.mustSession(tenantId, sessionId);
    const key = sessionPhotoKey(tenantId, session.date, sessionId, this.newId);
    return { uploadUrl: await this.storage.newUploadUrl(key, 'image/jpeg'), key };
  }

  // ── Utilidades ─────────────────────────────────────────────────────────────
  private async mustEmployee(tenantId: string, employeeId: string): Promise<Employee> {
    const e = await this.repo.getEmployee(tenantId, employeeId);
    if (!e) throw new AttendanceError('NOT_FOUND');
    return e;
  }
  private async mustSession(tenantId: string, sessionId: string): Promise<AttendanceSession> {
    const s = await this.repo.getSession(tenantId, sessionId);
    if (!s) throw new AttendanceError('NOT_FOUND');
    return s;
  }
}
