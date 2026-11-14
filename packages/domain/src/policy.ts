import type { AttendancePolicy } from './model';

/**
 * Valores por defecto de la política de asistencia. Coinciden con los del catálogo de
 * configuración de Agrovid (`attendance.*`) al 2026-11-14; en la fase F3 ese catálogo pasa a
 * apoyarse en estos valores para que no se desfasen.
 */
export const DEFAULT_ATTENDANCE_POLICY: AttendancePolicy = {
  thresholdAuto: 99,
  thresholdConfirm: 80,
  ambiguityMargin: 1,
  maxFacesPerPhoto: 3,
  minFacePx: 60,
  minEnrollPhotos: 4,
  captureMaxWidthPx: 1920,
  requireLiveEnrollCapture: false,
  allowExtras: true,
  groupLeaderCanTake: true,
  photoRetention: 'ON_TERMINATION',
  consentVersion: 'borrador-1',
  gpsMaxAccuracyM: 100,
  geofenceMode: 'FLAG',
  geofenceToleranceMeters: 25,
  geofenceMaxAccuracyMeters: 50,
  shiftStart: '',
  lateGraceMin: 10,
  live: { frameIntervalMs: 1500, maxFramesPerSession: 200, frameWidthPx: 640 },
  rotation: { preBajaAfterMisses: 3, bajaAfterMoreMisses: 2, autoBaja: false },
};
