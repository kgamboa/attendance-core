/**
 * model.ts — Modelo de asistencia por rostro del núcleo (sin nube ni aplicación).
 *
 * Vocabulario genérico: sitio (`siteId`, `areaId`) y grupo (`groupId`). Las aplicaciones traducen
 * a su propio vocabulario en sus adaptadores (en Agrovid: sitio y grupo).
 */

export type EmployeeStatus = 'ACTIVE' | 'PRE_TERMINATION' | 'INACTIVE';
export type EnrollmentStatus = 'NONE' | 'ENROLLED';

export interface Employee {
  employeeId: string;
  tenantId: string;
  name: string;
  /** Minúsculas, sin acentos ni espacios repetidos: búsqueda aproximada. */
  nameNormalized: string;
  employeeNumber?: string;
  groupId?: string;
  /** Usuario del sistema ligado a esta persona (vacío = sin liga). Uno a uno dentro de la empresa. */
  userId?: string;
  status: EmployeeStatus;
  /** Inasistencias consecutivas sin justificar. Se reinicia al asistir. */
  missCount: number;
  lastAttendanceAt?: string;
  preTerminationAt?: string;
  terminatedAt?: string;
  terminationReason?: string;
  enrollment: {
    status: EnrollmentStatus;
    /** Identificadores del rostro registrado en el proveedor de reconocimiento. */
    faceIds: string[];
    /** Llaves de las fotos de enrolamiento en el almacén de archivos. */
    photoKeys: string[];
    enrolledAt?: string;
    enrolledBy?: string;
  };
  consent?: {
    acceptedAt: string;
    version: string;
    recordedBy: string;
    /** Llave de la firma en pantalla en el almacén de archivos. */
    signatureKey?: string;
  };
  biometricsDeletedAt?: string;
  importSource?: string;
  externalId?: string;
  createdAt: string;
  updatedAt?: string;
}

export type SessionStatus = 'OPEN' | 'CLOSED';
export type MissingDecision = 'ABSENT' | 'JUSTIFIED';

export interface AttendanceSession {
  tenantId: string;
  sessionId: string;
  /** YYYY-MM-DD en la zona horaria del tenant. */
  date: string;
  /** Destino ("a dónde van"): opcional e informativo; no forma parte del identificador de la lista. '' = sin destino. */
  siteId: string;
  areaId?: string;
  status: SessionStatus;
  groupIds: string[];
  expectedEmployeeIds: string[];
  missingDecisions: Record<string, { decision: MissingDecision; reason?: string }>;
  /** Cuadros de vista previa en vivo consumidos (tope: `live.maxFramesPerSession` de la política). */
  liveFrames?: number;
  openedBy: string;
  openedAt: string;
  closedBy?: string;
  closedAt?: string;
  /** Observaciones antes de cerrar: quedan como bitácora de accesos. */
  notes?: string;
  /** Código corto de acceso (por ejemplo el QR de una caseta); lo genera la aplicación al cerrar la lista. Gancho para módulos de control de acceso. */
  gateCode?: string;
}

export type RecordMethod = 'AUTO' | 'CONFIRMED' | 'MANUAL' | 'EXTRA';
export type RecordFlag = 'LOW_ACCURACY' | 'OUTSIDE_SITE' | 'OUTSIDE_ZONES' | 'DUPLICATE_TODAY';

export interface AttendanceRecord {
  sessionId: string;
  recordId: string;
  tenantId: string;
  date: string;
  employeeId?: string;
  extraName?: string;
  method: RecordMethod;
  similarity?: number;
  photoKey?: string;
  photoSha256?: string;
  /** Caja del rostro dentro de la foto (razones 0–1): permite tapar solo a esa persona al borrar sus datos. */
  faceBox?: { left: number; top: number; width: number; height: number };
  /** Única hora válida: la del servidor. */
  serverTs: string;
  lat?: number;
  lng?: number;
  accuracy?: number;
  /** Geocerca de asistencia (zona marcada para pasar lista) en la que se capturó, si estaba dentro de una. */
  zoneName?: string;
  flags: RecordFlag[];
  idempotencyKey: string;
  capturedBy: string;
  supersedes?: string;
}

export interface GroupAssignment {
  tenantId: string;
  assignmentId: string;
  groupId: string;
  siteId: string;
  areaId?: string;
  taskId?: string;
  from: string;
  to?: string;
  assignedBy: string;
  createdAt: string;
}

export interface BiometricDeletion {
  tenantId: string;
  deletionId: string;
  employeeId: string;
  /** Nombre de la persona al momento de borrar (el comprobante debe seguir diciendo de quién fue). */
  employeeName?: string;
  requestedBy: string;
  reason: string;
  executedAt: string;
  facesDeleted: number;
  enrollPhotosDeleted: number;
  attendancePhotosDeleted: number;
}

/** Políticas efectivas de asistencia de una empresa (y, si aplica, de un sitio). Los valores por defecto están en `policy.ts`. */
export interface AttendancePolicy {
  thresholdAuto: number;
  thresholdConfirm: number;
  ambiguityMargin: number;
  maxFacesPerPhoto: number;
  minFacePx: number;
  minEnrollPhotos: number;
  captureMaxWidthPx: number;
  /** Exige que la foto de enrolamiento venga de la cámara en vivo (sin EXIF, dentro del ancho de captura). Apagado por defecto. */
  requireLiveEnrollCapture: boolean;
  allowExtras: boolean;
  groupLeaderCanTake: boolean;
  photoRetention: 'ON_TERMINATION' | 'KEEP';
  consentVersion: string;
  gpsMaxAccuracyM: number;
  /** OFF no revisa; FLAG marca fuera de zona; BLOCK impide pasar lista, pases de acceso y fotos fuera de la zona. */
  geofenceMode: 'OFF' | 'FLAG' | 'BLOCK';
  /** Margen (m) alrededor del polígono de la zona para considerar a la persona dentro (BLOCK). */
  geofenceToleranceMeters: number;
  /** Precisión máxima del GPS (m) para validar BLOCK; peor precisión = pedir reintento. */
  geofenceMaxAccuracyMeters: number;
  /** Inicio de jornada 'HH:mm' (vacío = sin retardos) y tolerancia en minutos. Entrada = primera foto del día, salida = última. */
  shiftStart: string;
  lateGraceMin: number;
  live: { frameIntervalMs: number; maxFramesPerSession: number; frameWidthPx: number };
  rotation: { preBajaAfterMisses: number; bajaAfterMoreMisses: number; autoBaja: boolean };
}

export interface AttendanceFlags {
  /** Módulo completo. Sin esto no hay botones, ni endpoints, ni modos en la Mini App. */
  attendance: boolean;
  /** Reglas de rotación: pre-baja y baja por inasistencias. */
  rotation: boolean;
  /** Nombres en vivo sobre los rostros. */
  live: boolean;
}

export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
