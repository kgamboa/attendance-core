/** Dobles en memoria de los puertos, para probar `AttendanceService` sin nube. Solo se usan en pruebas. */
import jpeg from 'jpeg-js';
import { createHash, randomUUID } from 'crypto';
import type { AttendanceStore, BlobStorage, DetectedFace, FaceRecognition, Platform } from '../ports';
import type { FaceCandidate } from '../decide-match';
import { DEFAULT_ATTENDANCE_POLICY } from '../policy';
import type {
  AttendancePolicy, AttendanceRecord, AttendanceSession, BiometricDeletion, GroupAssignment, Employee,
} from '../model';

export function makeJpeg(width = 400, height = 300, value = 200): Buffer {
  return Buffer.from(jpeg.encode({ data: Buffer.alloc(width * height * 4, value), width, height }, 80).data);
}

export const defaultPolicy = (over: Partial<AttendancePolicy> = {}): AttendancePolicy => ({ ...DEFAULT_ATTENDANCE_POLICY, ...over });

/** Plataforma de pruebas con `crypto` de Node. Los dobles viven fuera del núcleo puro (`src/testing`). */
export const testPlatform: Platform = {
  randomUuid: () => randomUUID(),
  sha1Hex: (text) => createHash('sha1').update(text).digest('hex'),
  sha256Hex: (data) => createHash('sha256').update(data).digest('hex'),
};

export class InMemoryStore implements AttendanceStore {
  employees = new Map<string, Employee>();
  sessions = new Map<string, AttendanceSession>();
  records: AttendanceRecord[] = [];
  assignments: GroupAssignment[] = [];
  deletions: BiometricDeletion[] = [];

  async putEmployee(e: Employee) { this.employees.set(e.employeeId, e); }
  async getEmployee(t: string, id: string) { const e = this.employees.get(id); return e && e.tenantId === t ? e : null; }
  async listEmployees(t: string) { return [...this.employees.values()].filter((e) => e.tenantId === t); }
  async deleteEmployee(t: string, id: string) { if (this.employees.get(id)?.tenantId === t) this.employees.delete(id); }
  async updateEmployee(t: string, id: string, u: Partial<Employee>) {
    const e = this.employees.get(id);
    if (!e || e.tenantId !== t) throw new Error('cond');
    this.employees.set(id, { ...e, ...u });
  }
  async getSession(t: string, id: string) { const s = this.sessions.get(`${t}|${id}`); return s ?? null; }
  async createSession(s: AttendanceSession) {
    const k = `${s.tenantId}|${s.sessionId}`;
    if (this.sessions.has(k)) return false;
    this.sessions.set(k, s); return true;
  }
  async updateSession(t: string, id: string, u: Partial<AttendanceSession>) {
    const k = `${t}|${id}`; this.sessions.set(k, { ...this.sessions.get(k)!, ...u });
  }
  async incrementLiveFrames(t: string, id: string) {
    const k = `${t}|${id}`; const s = this.sessions.get(k)!;
    const n = (s.liveFrames ?? 0) + 1; this.sessions.set(k, { ...s, liveFrames: n }); return n;
  }
  async listSessionsRange(t: string, from: string, to: string) { return [...this.sessions.values()].filter((s) => s.tenantId === t && s.date >= from && s.date <= to); }
  async listSessions(t: string) { return [...this.sessions.values()].filter((s) => s.tenantId === t); }
  async putRecord(r: AttendanceRecord) {
    if (this.records.some((x) => x.sessionId === r.sessionId && x.recordId === r.recordId)) return false;
    this.records.push(r); return true;
  }
  async listRecords(sid: string) { return this.records.filter((r) => r.sessionId === sid); }
  async listRecordsByEmployee(t: string, id: string) { return this.records.filter((r) => r.tenantId === t && r.employeeId === id); }
  async clearRecordPhoto(sid: string, rid: string) {
    const r = this.records.find((x) => x.sessionId === sid && x.recordId === rid)!;
    delete r.photoKey; delete r.photoSha256; delete r.faceBox;
  }
  async putAssignment(a: GroupAssignment) { this.assignments.push(a); }
  async listAssignments(t: string) { return this.assignments.filter((a) => a.tenantId === t); }
  async putDeletion(d: BiometricDeletion) { this.deletions.push(d); }
}

export class InMemoryBlobStorage implements BlobStorage {
  objects = new Map<string, Buffer>();
  async newUploadUrl(key: string) { return `https://upload.test/${key}`; }
  async getBuffer(key: string) { const b = this.objects.get(key); if (!b) throw new Error(`NoSuchKey ${key}`); return b; }
  async putBuffer(key: string, body: Buffer) { this.objects.set(key, body); }
  async signedGetUrl(key: string) { return `https://get.test/${key}`; }
  async deleteMany(keys: string[]) { let n = 0; for (const k of keys) if (this.objects.delete(k)) n++; return n; }
}

export class FakeFaces implements FaceRecognition {
  detected: DetectedFace[] = [];
  searchQueue: FaceCandidate[][] = [];
  indexResults: ({ faceId: string } | null)[] = [];
  deletedFaces: string[] = [];
  async ensureCollection() { /* noop */ }
  async detectFaces() { return this.detected; }
  async search() { return this.searchQueue.shift() ?? []; }
  async index() { return this.indexResults.shift() ?? null; }
  async deleteFaces(_t: string, ids: string[]) { this.deletedFaces.push(...ids); return ids.length; }
}

export const face = (left: number, width = 0.2): DetectedFace => ({ box: { left, top: 0.3, width, height: 0.3 }, confidence: 99 });
