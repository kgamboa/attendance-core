/**
 * ports.ts — Puertos del núcleo: lo que `AttendanceService` necesita de afuera.
 *
 * Cada aplicación los implementa con su tecnología (en Agrovid: una base de datos, un almacén de archivos y un servicio de reconocimiento facial).
 * El núcleo no conoce ninguna. Todas las lecturas y escrituras de `AttendanceStore` van acotadas
 * por `tenantId`: nunca devuelven ni modifican datos de otra empresa.
 */
import type { FaceBox } from './face-crop';
import type { FaceCandidate } from './decide-match';
import type { StampLogo } from './stamp';
import type {
  AttendanceRecord, AttendanceSession, BiometricDeletion, Employee, GroupAssignment,
} from './model';

// ── Persistencia ──────────────────────────────────────────────────────────────
export interface AttendanceStore {
  // Personas
  putEmployee(e: Employee): Promise<void>;
  /** Solo si la persona es de la empresa; si no, `null`. */
  getEmployee(tenantId: string, employeeId: string): Promise<Employee | null>;
  listEmployees(tenantId: string): Promise<Employee[]>;
  deleteEmployee(tenantId: string, employeeId: string): Promise<void>;
  /** Condicional por empresa: no modifica a una persona de otra. */
  updateEmployee(tenantId: string, employeeId: string, updates: Partial<Employee>): Promise<void>;

  // Listas
  getSession(tenantId: string, sessionId: string): Promise<AttendanceSession | null>;
  /** Crea la lista solo si no existía. `false` = ya existía (no se sobrescribe). */
  createSession(s: AttendanceSession): Promise<boolean>;
  updateSession(tenantId: string, sessionId: string, updates: Partial<AttendanceSession>): Promise<void>;
  /** Suma un cuadro de vista previa y devuelve el total. Debe ser atómico. */
  incrementLiveFrames(tenantId: string, sessionId: string): Promise<number>;
  listSessions(tenantId: string, datePrefix?: string): Promise<AttendanceSession[]>;
  /** Listas con fecha entre `from` y `to` (ambas incluidas, `YYYY-MM-DD`). */
  listSessionsRange(tenantId: string, from: string, to: string, limit?: number): Promise<AttendanceSession[]>;

  // Registros: inmutables
  /** Inserta. `false` = el id ya existía (reintento idempotente): no se duplica ni se sobrescribe. */
  putRecord(r: AttendanceRecord): Promise<boolean>;
  listRecords(sessionId: string): Promise<AttendanceRecord[]>;
  listRecordsByEmployee(tenantId: string, employeeId: string): Promise<AttendanceRecord[]>;
  /** Único cambio permitido a un registro: quitar la foto (`photoKey`, `photoSha256`, `faceBox`). */
  clearRecordPhoto(sessionId: string, recordId: string): Promise<void>;

  // Asignaciones y bitácora
  putAssignment(a: GroupAssignment): Promise<void>;
  listAssignments(tenantId: string): Promise<GroupAssignment[]>;
  putDeletion(d: BiometricDeletion): Promise<void>;
}

// ── Reconocimiento facial ─────────────────────────────────────────────────────
export interface DetectedFace {
  box: FaceBox;
  confidence: number;
  /** Giro horizontal de la cabeza en grados (0 = de frente). Ausente si no se midió. */
  yaw?: number;
  /** Ojos abiertos y su confianza (0-100). Ausente si no se midió. */
  eyesOpen?: { value: boolean; confidence: number };
}

export interface FaceRecognition {
  ensureCollection(tenantId: string): Promise<void>;
  detectFaces(image: Buffer): Promise<DetectedFace[]>;
  /** Busca el rostro más grande de `image` entre los rostros enrolados de la empresa. */
  search(tenantId: string, image: Buffer, threshold: number): Promise<FaceCandidate[]>;
  /** Indexa el único rostro de `image`; `null` si el proveedor no lo acepta (calidad). */
  index(tenantId: string, image: Buffer, employeeId: string): Promise<{ faceId: string } | null>;
  deleteFaces(tenantId: string, faceIds: string[]): Promise<number>;
}

// ── Archivos (fotos y firmas) ─────────────────────────────────────────────────
/** Las llaves siempre cuelgan de `attendance/<empresa>/` (ver `storage-keys.ts`). */
export interface BlobStorage {
  newUploadUrl(key: string, contentType: string): Promise<string>;
  getBuffer(key: string): Promise<Buffer>;
  putBuffer(key: string, body: Buffer, contentType: string, metadata?: Record<string, string>): Promise<void>;
  signedGetUrl(key: string, seconds?: number): Promise<string>;
  deleteMany(keys: string[]): Promise<number>;
}

// ── Plataforma y marca ────────────────────────────────────────────────────────
/**
 * Identificadores y hashes. El núcleo no importa `crypto`: cada plataforma pasa los suyos
 * (en Node, `randomUUID` y `createHash`).
 */
export interface Platform {
  randomUuid(): string;
  sha1Hex(text: string): string;
  sha256Hex(data: Uint8Array): string;
}

/** Marca que se dibuja en el sello de las fotos. Sin logo, el sello va sin marca. */
export interface Brand {
  logo?: StampLogo;
}
