/**
 * storage-keys.ts — Llaves de los archivos de asistencia. Siempre cuelgan de `attendance/<empresa>/`
 * y se pueden validar contra la empresa. El identificador único lo pone quien llama (`newId`).
 */
export function enrollKey(tenantId: string, employeeId: string, newId: () => string): string {
  return `attendance/${tenantId}/enroll/${employeeId}/${newId()}.jpg`;
}

export function sessionPhotoKey(tenantId: string, date: string, sessionId: string, newId: () => string): string {
  return `attendance/${tenantId}/${date}/${sessionId}/${newId()}.jpg`;
}

export function signatureKey(tenantId: string, employeeId: string, newId: () => string): string {
  return `attendance/${tenantId}/consent/${employeeId}/${newId()}.png`;
}

/** Una llave solo es válida para su empresa y sin escapes de ruta. */
export function keyBelongsToTenant(key: unknown, tenantId: string): key is string {
  return typeof key === 'string' && key.startsWith(`attendance/${tenantId}/`) && !key.includes('..');
}
