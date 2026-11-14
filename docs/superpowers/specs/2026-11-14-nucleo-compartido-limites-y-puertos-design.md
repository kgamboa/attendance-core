# Núcleo compartido de asistencia — límites, puertos y plan de extracción

> Fecha: 2026-11-14 · Estado: diseño para aprobar, sin código
> Reemplaza el rumbo del diseño del 2026-10-08 (`2026-10-08-attendance-core-design.md`), que sigue como contexto. Lo que cambió está en la sección 2.
> Origen: el módulo de asistencia por rostro de Agrovid ya está construido y probado (`kgamboa/Agrovid`, `aws-serverless/src/services/attendance*`, ver su sección 19). Este documento define cómo sacar de ahí un **núcleo** que usen Agrovid y un producto de asistencia para **cualquier negocio**, sin empezar de cero y sin romper Agrovid.

## 1. Decisiones tomadas

| # | Decisión | Quién |
|---|---|---|
| D1 | El producto es para **cualquier negocio**, no solo agro | Karlo, 2026-11-14 |
| D2 | **Primero este documento, después la extracción** | Karlo, 2026-11-14 |
| D3 | El núcleo se **mueve** desde Agrovid (con sus pruebas), no se copia: una sola fuente de verdad | Propuesta de este documento |
| D4 | Agrovid **consume** el núcleo y conserva sus adaptadores y su API actual; el producto trae los suyos | Propuesta |
| D5 | Agrovid **no** se convierte en cliente de un servicio `attendance-core` (opción D de la discusión): la migración sería grande y no aporta al producto | Propuesta |
| D6 | Plataforma de la primera versión del producto: **AWS**, porque los adaptadores ya existen. Cloudflare queda como revisión posterior si el costo lo pide (sección 9) | Karlo, 2026-11-14 (confirmada) |
| D7 | Vocabulario del núcleo: **sitio** y **grupo** | Karlo, 2026-11-14 |
| D8 | El paquete se publica en **GitHub Packages** (privado) | Karlo, 2026-11-14 |
| D9 | Este documento queda **aprobado** y se arranca la F1 | Karlo, 2026-11-14 |

## 2. Qué cambia respecto al diseño del 8 de octubre

| Tema | 2026-10-08 | Ahora |
|---|---|---|
| Reconocimiento facial | Fuera de la v1 (Fase 5, "solo si se pide") | **Dentro**: ya existe y es el centro del producto |
| Plataforma | Cloudflare (Workers, D1, R2) por costo cercano a cero | AWS en la primera versión; ver sección 9 |
| Punto de partida | Código nuevo, fases 0 a 1 | Código **existente y probado** que se extrae |
| Sello de foto | Se quema en un `<canvas>` en el celular antes de subir | Se arma en el servidor al pedir la foto, con la foto limpia y los datos del registro; el logo y el rótulo son **parámetros de marca** |
| Canal | Web, kiosko, bot de Telegram y Mini App | Mini App y bot de Telegram hoy; el resto queda como idea de producto |
| WhatsApp | Fuera de la v1 | Se mantiene fuera para registrar; ver la comparativa en Agrovid (`2026-11-14-asistencia-comparativa-whatstime.md`) |

El plan de fases 0 a 1 del 8 de octubre queda **superado** por el de la sección 8.

## 3. Capas

```
┌──────────────────────────────────────────────────────────┐
│ Aplicaciones (una por despliegue)                        │
│  Agrovid: handlers, RBAC, config, supervisión, nómina    │
│  Producto: handlers, empresas, cobro, marca, UI          │
├──────────────────────────────────────────────────────────┤
│ Adaptadores (implementan los puertos)                    │
│  AWS: DynamoDB, S3, Rekognition   · Notificadores        │
├──────────────────────────────────────────────────────────┤
│ Núcleo  packages/domain  (sin framework ni nube)         │
│  modelos · lógica pura · AttendanceService sobre puertos │
└──────────────────────────────────────────────────────────┘
```

**Regla de dependencia:** cada capa solo mira hacia abajo. El núcleo no importa nada de las capas de arriba.

## 4. Qué se mueve al núcleo y qué no

Rutas de Agrovid al 2026-11-14 (`aws-serverless/src/…`). Tamaños aproximados.

| Archivo | Líneas | Destino | Cambios necesarios |
|---|---|---|---|
| `services/attendance/decide-match.ts` | 51 | Núcleo | Ninguno |
| `services/attendance/roster.ts` | 42 | Núcleo | Ninguno |
| `services/attendance/rotation.ts` | 39 | Núcleo | Ninguno |
| `services/attendance/geo.ts`, `geofence-block.ts` | 43, 84 | Núcleo | Renombrar "lote" a "sitio" |
| `services/attendance/report.ts` | 223 | Núcleo | Renombrar `loteId` y `crewId` (sección 5) |
| `services/attendance/face-crop.ts` | 93 | Núcleo | Ninguno |
| `services/attendance/stamp.ts`, `stamp-font.ts` | 151, 53 | Núcleo | El rótulo "AGROVID" pasa a parámetro de marca |
| `services/attendance/stamp-logo.ts` | 104 | **Se queda en Agrovid** | Es el logo de Agrovid en bytes; el núcleo recibe el logo por el puerto `Brand` |
| `services/attendance/attendance-policy.ts` | 69 | Núcleo (los tipos y valores por defecto); la lectura de la configuración se queda | Separar `policyFromResolved` de `ConfigResolver` |
| `services/attendance/gate-terminated-policy.ts` | 44 | Se queda por ahora | Es la caseta; ver sección 7 |
| `services/attendance/geofence-support-alert.ts` | 37 | Se queda en Agrovid | Habla del canal de soporte de Agrovid |
| `services/attendance-import.service.ts` | — | Núcleo (el lector de filas); la lectura del Excel se queda en la app | Ninguno |
| `services/attendance-report-xlsx.ts` | — | Se queda en cada app | Depende de `exceljs`; el núcleo entrega el reporte como datos |
| `models/attendance.model.ts` | — | Núcleo | Vocabulario (sección 5) |
| `services/attendance.service.ts` | 742 | Núcleo | Recibir los puertos de la sección 6 en lugar de `AttendanceRepo` concreto; vocabulario |
| `services/attendance.repo.ts` | 207 | **Adaptador** | Implementa `AttendanceStore` sobre DynamoDB |
| `services/face-recognition.service.ts` | 142 | **Adaptador** AWS | Ya cumple `FaceRecognition` |
| `services/attendance-storage.service.ts` | 65 | **Adaptador** AWS | Ya cumple `BlobStorage` |
| `services/attendance-deps.ts` | 72 | Se queda en cada app | Cableado y lectura de flags |
| `services/attendance-supervision.ts` | 88 | **Adaptador** de Agrovid | Implementa `Notifier` con los temas de supervisión |
| `api/attendance.handler.ts`, `api/miniapp-attendance.handler.ts` | 396, 411 | Se quedan en cada app | Autenticación, permisos y empresas son de la aplicación |
| `miniapp-camera/src/attendance/*` | — | Paquete de interfaz **después** (fase posterior) | Hoy depende del contrato de `/api/miniapp/attendance/*` |
| `services/attendance/test-doubles.ts` y las pruebas | 22 archivos de pruebas del backend | Núcleo | Las pruebas se mueven con su código |

Lo que se mueve suma unas 1,900 líneas de código (con el servicio, el modelo y el lector de importación) más sus pruebas. Lo que se queda es lo que amarra al producto con Agrovid: empresas, usuarios, permisos, configuración, supervisión, cuadrillas, lotes y nómina.

## 5. Vocabulario: de agro a cualquier negocio

El núcleo usa nombres genéricos. Agrovid conserva los suyos en su capa y **traduce en el adaptador**, de modo que **no hace falta migrar los datos** de DynamoDB.

| Hoy (Agrovid) | Núcleo | Nota |
|---|---|---|
| `loteId`, `moduleId` | `siteId`, `areaId` | Sitio de trabajo y, opcionalmente, un área dentro de él |
| `crewId`, `crewIds` | `groupId`, `groupIds` | Cuadrilla, equipo, turno, departamento |
| `crewLeaderCanTake` | `groupLeaderCanTake` | Ajuste de la política |
| `CrewAssignment` | `GroupAssignment` | Un grupo asignado a un sitio por un rango de fechas |
| `employeeId`, `employeeNumber` | Se quedan | "Empleado" ya es genérico |
| `gateCode`, "caseta" | Se queda fuera del núcleo por ahora | Sección 7 |
| Rótulo "AGROVID" y logo | `Brand` | Parámetro por despliegue o por cliente |

Los nombres de los atributos en DynamoDB no cambian: el adaptador de Agrovid asigna `loteId ↔ siteId` y `crewId ↔ groupId` al leer y escribir. Las respuestas de la API de Agrovid tampoco cambian.

## 6. Puertos

Interfaces que el núcleo recibe. Firmas indicativas; los detalles se afinan al implementar.

```ts
/** Persistencia. Todas las lecturas y escrituras están acotadas por `tenantId`. */
export interface AttendanceStore {
  // Personas
  putEmployee(e: Employee): Promise<void>;
  getEmployee(tenantId: string, id: string): Promise<Employee | null>;     // solo si es de la empresa
  listEmployees(tenantId: string): Promise<Employee[]>;
  updateEmployee(tenantId: string, id: string, patch: Partial<Employee>): Promise<void>; // condicional por empresa
  deleteEmployee(tenantId: string, id: string): Promise<void>;
  // Listas
  getSession(tenantId: string, id: string): Promise<AttendanceSession | null>;
  createSession(s: AttendanceSession): Promise<boolean>;                    // false si ya existía
  updateSession(tenantId: string, id: string, patch: Partial<AttendanceSession>): Promise<void>;
  incrementLiveFrames(tenantId: string, id: string): Promise<number>;       // atómico
  listSessions(tenantId: string, datePrefix?: string): Promise<AttendanceSession[]>;
  listSessionsRange(tenantId: string, from: string, to: string, limit?: number): Promise<AttendanceSession[]>;
  // Registros: inmutables
  putRecord(r: AttendanceRecord): Promise<boolean>;                          // false si el id ya existía (idempotencia)
  listRecords(sessionId: string): Promise<AttendanceRecord[]>;
  listRecordsByEmployee(tenantId: string, employeeId: string): Promise<AttendanceRecord[]>;
  clearRecordPhoto(sessionId: string, recordId: string): Promise<void>;     // único cambio permitido a un registro
  // Asignaciones y bitácora
  putAssignment(a: GroupAssignment): Promise<void>;
  listAssignments(tenantId: string): Promise<GroupAssignment[]>;
  putDeletion(d: BiometricDeletion): Promise<void>;
}

/** Reconocimiento facial: ya existe como interfaz `FaceRecognition`. */
export interface FaceRecognition {
  ensureCollection(tenantId: string): Promise<void>;
  detectFaces(image: Buffer): Promise<DetectedFace[]>;
  search(tenantId: string, image: Buffer, threshold: number): Promise<FaceCandidate[]>;
  index(tenantId: string, image: Buffer, employeeId: string): Promise<{ faceId: string } | null>;
  deleteFaces(tenantId: string, faceIds: string[]): Promise<number>;
}

/** Archivos (fotos y firmas): ya existe como `AttendanceStorage`. Llaves siempre bajo `attendance/<empresa>/`. */
export interface BlobStorage {
  newUploadUrl(key: string, contentType: string): Promise<string>;
  getBuffer(key: string): Promise<Buffer>;
  putBuffer(key: string, body: Buffer, contentType: string, metadata?: Record<string, string>): Promise<void>;
  signedGetUrl(key: string, seconds?: number): Promise<string>;
  deleteMany(keys: string[]): Promise<number>;
}

/** Sitios y grupos viven en la aplicación (en Agrovid: lotes y cuadrillas). */
export interface SiteDirectory {
  getSite(tenantId: string, siteId: string): Promise<{ siteId: string; name: string; boundary?: GeoPolygon; timeZone?: string } | null>;
}
export interface GroupDirectory {
  listGroups(tenantId: string): Promise<{ groupId: string; name: string; leaderContact?: string }[]>;
}

/** Políticas efectivas de una empresa (en Agrovid: el catálogo de configuración con herencia por rancho). */
export interface PolicyProvider {
  getPolicy(tenantId: string, siteId?: string): Promise<AttendancePolicy>;
  getFlags(tenantId: string): Promise<{ attendance: boolean; rotation: boolean; live: boolean }>;
}

/** Avisos. El núcleo emite eventos estructurados; el texto y el canal son del adaptador. */
export interface Notifier {
  notify(event: AttendanceEvent): Promise<void>;   // nunca lanza: una falla no detiene el pase de lista
}

/** Marca del sello de la foto. */
export interface Brand { tag: string; logoRgba?: { width: number; height: number; data: Uint8Array } }

export interface Clock { now(): Date }
export interface Logger { info(m: string, f?: object): void; warn(m: string, f?: object): void; error(m: string, f?: object): void }
```

> **Ajuste de la F2 (2026-11-14):** al portar el servicio se vio que solo usa cinco puertos: `AttendanceStore`, `FaceRecognition`, `BlobStorage`, `Platform` (identificadores y hashes) y `Brand` (logo del sello), más un reloj (`now`). `SiteDirectory`, `GroupDirectory`, `PolicyProvider`, `Notifier` y `Logger` **no se implementaron**: hoy el servicio recibe la política en cada llamada, no consulta nombres de sitios ni de grupos y no emite avisos (los emite el manejador de cada aplicación). Se agregarán cuando algo del núcleo los necesite, no antes.

**Eventos del `Notifier`:** `SESSION_OPENED`, `PHOTO`, `RESOLVED`, `CLOSED`, `CONSENT`, `ENROLLED`, `PRE_TERMINATION`, `RECOMMEND_TERMINATION`, `TERMINATED`, `GEOFENCE_BLOCKED`. Hoy los textos en español de `attendance-supervision.ts` pasan al adaptador de Agrovid; el producto traerá los suyos (correo, Telegram, webhook).

**Qué ya estaba listo:** `FaceRecognition` y `AttendanceStorage` ya son interfaces y el servicio ya las recibe por constructor. **Lo que falta:** el repositorio (hoy una clase concreta), las políticas, el directorio de sitios y grupos, el notificador y la marca.

## 7. Qué NO se extrae ahora

- **Caseta** (`gate-terminated-policy.ts`, `access.handler.ts`, pases con QR, rol Vigilante): es control de acceso, no asistencia, y hoy está pensada para el flujo de Agrovid. Se queda hasta que el producto la pida; el núcleo deja los ganchos (código corto en la lista cerrada, `gateCode`) pero no la lógica.
- **Cruce con nómina y costo por lote:** es un módulo opcional de Agrovid. El núcleo entrega el reporte como datos; el cruce vive en la aplicación.
- **Reportes programados, supervisión por temas de Telegram, alertas de soporte:** de Agrovid.
- **Mini App como paquete de interfaz:** después de que el núcleo esté estable.
- **Excel de salida:** cada aplicación lo arma con `exceljs`.

## 8. Plan de extracción por fases

Cada fase se entrega sola, con las pruebas de Agrovid en verde, y se puede revertir.

| Fase | Entrega | Criterio de terminado |
|---|---|---|
| **F0** | Este documento y los nombres congelados (sección 5) | Aprobado por Karlo |
| **F1** | Repo `attendance-core` convertido en monorepo (pnpm): `packages/domain`, CI con `tsc` y pruebas; entra la **lógica pura** con sus pruebas | CI verde; las pruebas movidas pasan sin tocar Agrovid |
| **F2** | Puertos (sección 6) y `AttendanceService` generalizado, con dobles en memoria y las pruebas del servicio portadas (hoy 42) | Las pruebas del servicio (hoy 42) pasan en el núcleo |
| **F3** | **Agrovid adopta el núcleo:** dependencia del paquete, adaptadores (`AttendanceStore` sobre DynamoDB con la traducción de nombres, `Notifier` hacia supervisión, `SiteDirectory` hacia lotes, `GroupDirectory` hacia cuadrillas, `PolicyProvider` hacia `ConfigResolver`) y borrado del código movido en el mismo PR | Pruebas de asistencia y de contrato de Agrovid sin cambios y en verde; la API de Agrovid no cambia; sin migración de datos |
| **F4** | El producto: aplicación propia (empresas, inicio de sesión, cobro, marca, interfaz) sobre el mismo núcleo; documento aparte | Un cliente de prueba pasa lista de punta a punta |

**Cómo llega el paquete a Agrovid:** paquete privado `@kgamboa/attendance-domain` en GitHub Packages con versiones semánticas, o dependencia directa por etiqueta de Git si el registro estorba. Agrovid fija la versión y la actualiza a propósito. Su despliegue empaqueta con esbuild, así que el paquete queda dentro del Lambda.

**Dependencias de Node a vigilar:** el núcleo usa `crypto` y `zlib` de Node y `jpeg-js` (JavaScript puro). Para no depender de Node se propone reemplazar `zlib.inflateSync` por una librería de JavaScript puro (por ejemplo `fflate`) y usar Web Crypto para los hash e identificadores. Es un cambio pequeño y deja el núcleo listo para cualquier plataforma.

**Cómo se evita que el núcleo se contamine:** una prueba de arquitectura (o `dependency-cruiser`) que falle si algo de `packages/domain` importa AWS, `@aws-sdk/*`, la aplicación o `process.env`.

## 9. Plataforma del producto

El núcleo no obliga a elegir: es el mismo en cualquier plataforma. Para la primera versión del producto se recomienda **AWS**:

- Los adaptadores de DynamoDB, S3 y Rekognition ya existen y funcionan en Agrovid; solo habría que generalizar el prefijo de las tablas.
- En Cloudflare Workers el plan gratis da 10 ms de procesador por solicitud, y el recorte, el tapado y el sello de fotos son pesados; haría falta el plan de pago o mover esas operaciones.
- Rekognition es de AWS: desde Cloudflare habría que llamarlo por red y firmar las peticiones, y el costo por imagen sería el mismo.
- "Costo cercano a cero" no se cumple de todos modos: cada búsqueda facial cuesta.

Se puede revisar si el costo del producto lo pide. Si hiciera falta, un adaptador nuevo (`AttendanceStore` sobre D1 y `BlobStorage` sobre R2) no cambia el núcleo.

## 10. Producto para cualquier negocio: qué implica

- **Vocabulario y marca por cliente:** sitios, grupos y logo configurables; textos sin referencias a agro.
- **Horarios por grupo o persona**, no uno por empresa (ver la comparativa en Agrovid). Es una función del núcleo, útil a Agrovid y al producto.
- **Legal:** vender reconocimiento facial convierte a la empresa en **encargado del tratamiento** de los datos de sus clientes: contrato, aviso y consentimiento por cliente, subencargados (AWS) y procedimiento de borrado. Es trabajo del área legal y conviene empezarlo en paralelo.
- **Separación entre clientes:** una colección de Rekognition y un prefijo de archivos por empresa, y pruebas de aislamiento, como hoy.
- **Cobro y límites:** medir las búsquedas por cliente (cada una cuesta) y poner topes, como ya se hace con los cuadros de la vista en vivo.

## 11. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Un error de traducción de nombres en el adaptador de Agrovid (`loteId ↔ siteId`) | Pruebas de contrato de Agrovid sin cambios; prueba de ida y vuelta del adaptador |
| Agrovid y el producto se desfasan por versiones | Versiones semánticas, cambios incompatibles solo con número mayor, Agrovid fija y actualiza a propósito |
| Generalizar de más antes de tener un segundo cliente | Solo se generaliza lo listado en la sección 5; lo demás se queda en las aplicaciones (sección 7) |
| Romper algo en producción al migrar Agrovid | F3 en un PR aparte, con reversión sencilla; sin migración de datos; API intacta |
| El núcleo vuelve a depender de AWS o de Agrovid | Prueba de arquitectura de la sección 8 |
| El tamaño del paquete en los Lambda | Medir al adoptar; el núcleo no trae `exceljs` ni el SDK de AWS |

## 12. Decisiones que quedan abiertas

1. ~~**Q1** Nombres del vocabulario~~ Resuelta: **sitio** y **grupo** (D7).
2. ~~**Q2** Registro del paquete~~ Resuelta: **GitHub Packages** (D8).
3. **Q3** ¿Los adaptadores de AWS viven en un paquete compartido (`packages/adapter-aws`) o cada aplicación trae los suyos? Recomendación: compartido, para que el producto y Agrovid no los dupliquen; se decide al terminar F3.
4. ~~**Q4** Plataforma de la primera versión~~ Resuelta: **AWS** (D6).
5. **Q5** ¿Cuándo entra la caseta al núcleo? Cuando el producto la pida.
6. **Q6** Modelo de horarios (por grupo, por persona o ambos), que afecta al núcleo en la fase F2 o después.

## 13. Estado de la ejecución

### F0 — hecha
Documento aprobado el 2026-11-14 con las decisiones D6 a D9.

### F1 — entregada (2026-11-14, en el PR de este documento)
Qué contiene:

- **Monorepo pnpm** con `packages/domain` (`@kgamboa/attendance-domain` 0.1.0, TypeScript, CommonJS, con tipos). El código fuente de aplicaciones aún no existe.
- **CI** (`.github/workflows/ci.yml`): `typecheck`, pruebas y compilación en cada PR y en `main`.
- **Lógica pura portada desde Agrovid con sus pruebas** (101 pruebas en total: 72 de la lógica, portadas o nuevas, y 29 de arquitectura): decisión de coincidencia, lista y faltantes, rotación, geometría y geocerca, reporte (retardos, horas, rango), recorte y tapado de rostros, sello de foto, lectura e importación de personal, y el modelo con vocabulario genérico.
- **Valores por defecto de la política** (`DEFAULT_ATTENDANCE_POLICY`).
- **Prueba de arquitectura** que falla si el núcleo importa algo que no sea un archivo propio o `jpeg-js`, lee `process.env` o menciona servicios de nube. Se comprobó que detecta una violación.
- **Flujo de publicación** (`publish-domain.yml`): al crear la etiqueta `domain-v<versión>` verifica que coincida con la versión del paquete y publica en GitHub Packages. **No está probado** hasta que se publique la primera versión.

Cambios respecto a lo previsto en la sección 4:

| Tema | Qué se hizo |
|---|---|
| Logo del sello | `renderStamp` recibe `logo?: StampLogo` (ancho, alto y bytes RGBA). Sin logo no dibuja placa ni marca. El logo de Agrovid se queda en Agrovid. Aún no es el puerto `Brand` completo (falta el rótulo de texto) |
| `crypto` y `zlib` de Node | **Ya no hacen falta en el núcleo:** `zlib` solo se usaba para el logo, que salió. El núcleo todavía usa el tipo `Buffer` de Node, que se revisa antes de apuntar a otra plataforma |
| Políticas | El núcleo solo trae el tipo y los valores por defecto. Leerlos del catálogo de configuración (`policyFromResolved`) se queda en Agrovid. Los ajustes de caseta (`gate*`) y la bandera `gate` no están en el núcleo |
| Mensajes de importación | `planImport` acepta `groupLabel` ("cuadrilla", "equipo"…) para que la advertencia hable como la aplicación |
| Prueba de zona horaria | Se porta lo que prueba la lógica pura; lo que toca el servicio y el Excel se queda en Agrovid |

**Qué no entró en la F1:** el servicio (`AttendanceService`), los puertos y el repositorio (F2); los adaptadores y la adopción por Agrovid (F3).

### F2 — entregada (2026-11-14)

Qué contiene (en `packages/domain`, 159 pruebas en total):

- **Puertos** (`ports.ts`): `AttendanceStore`, `FaceRecognition`, `BlobStorage`, `Platform` y `Brand`, con la regla de que todo acceso al almacén va acotado por empresa.
- **`AttendanceService` generalizado** (`attendance-service.ts`, unas 750 líneas): enrolar, abrir lista, identificar (con vista previa y sin lista), resolver, cerrar con rotación, pre-baja, baja y borrado biométrico, sello de foto y reporte. Recibe `{ store, faces, storage, platform, brand?, now?, accessCode? }`.
- **Llaves de archivos** (`storage-keys.ts`): `enrollKey`, `sessionPhotoKey`, `signatureKey` y `keyBelongsToTenant`.
- **Dobles en memoria** (`testing/`): `InMemoryStore`, `InMemoryBlobStorage`, `FakeFaces`, `testPlatform`. No se exportan desde el índice (usan `crypto` de Node); se importan desde `@kgamboa/attendance-domain/dist/testing`.
- **Pruebas:** las 42 del servicio de Agrovid portadas y verdes, más 9 nuevas sobre lo propio del núcleo (ganchos, formatos de identificadores, llaves de archivos y marca del sello).

Cambios respecto a lo previsto:

| Tema | Qué se hizo |
|---|---|
| Código de acceso (caseta) | `closeSession` ya no genera el código: recibe `accessCode?: () => string`. Sin él no se guarda `gateCode`. La lógica de la caseta (`newGateCode`, pases) sigue en Agrovid |
| Identificación sin lista | `identifyAtGate` pasa a ser **`identifyAnyone`**, con tipos `OpenFaceResult` y `StatusRef`: sirve a un quiosco o una caseta. El núcleo no sabe qué es la caseta |
| `crypto` | El núcleo no lo importa: `randomUUID`, SHA-1 y SHA-256 llegan por `Platform`. Los helpers de llaves reciben `newId` |
| Formatos de identificador | **Se conservan idénticos** para no migrar datos: `att_<fecha>_<sitio>_<área>_c<grupo>`, `rec_<24 hex>`, `emp_`, `asg_`, `del_` |
| Sello de foto | Usa `brand.logo`; el texto de una captura fuera de sitio pasa de "FUERA DEL LOTE" a **"FUERA DEL SITIO"**. Se quitó la opción `loteName` (no se usaba) |

**Qué no entró en la F2:** `SiteDirectory`, `GroupDirectory`, `PolicyProvider`, `Notifier` y `Logger` (ver la nota de la sección 6); los adaptadores de AWS y la adopción por Agrovid (F3).

### Para la F3 (traducción en el adaptador de Agrovid)
Nombres que cambian entre Agrovid y el núcleo, a traducir sin migrar datos:

| Agrovid | Núcleo |
|---|---|
| `loteId`, `moduleId` | `siteId`, `areaId` |
| `crewId`, `crewIds`, `CrewAssignment` | `groupId`, `groupIds`, `GroupAssignment` |
| `crewLeaderCanTake` (política) | `groupLeaderCanTake` |
| bandera de registro `OUTSIDE_LOTE` | `OUTSIDE_SITE` (el adaptador la traduce al leer y escribir) |
| clave `crew` del mapa de columnas de la importación | `group` |
| `isOutsideLote` | `isOutsideSite` |
| `planImport(..., crews)` con texto "La cuadrilla…" | `planImport(..., groups, { groupLabel: 'cuadrilla' })`; el texto cambia ligeramente |
| `AttendanceService({ repo, faces, storage, now })` | `AttendanceService({ store, faces, storage, platform, brand?, now?, accessCode? })` |
| `assignCrew`, `identifyAtGate`, tipos `GateFaceResult` y `GateRef` | `assignGroup`, `identifyAnyone`, `OpenFaceResult` y `StatusRef` |
| propiedad `inCrew` en los candidatos de `identify` y `outsideLote` en `Gps` | `inGroup` y `outsideSite` (la Mini App de Agrovid recibe `inCrew`: el adaptador lo traduce) |
| `sessionIdFor(date, loteId, moduleId, crewId)`, `recordIdFor(sessionId, …)` | `sessionIdFor(date, siteId, areaId, groupId)` (mismo formato) y `recordIdFor(platform, sessionId, …)` |
| `newGateCode()` dentro de `closeSession` | Agrovid pasa su `newGateCode` como `accessCode` |
| texto del sello "FUERA DEL LOTE"; opción `loteName` de `stampedPhoto` | "FUERA DEL SITIO"; opción eliminada |
| `enrollKey`, `sha256`… de `attendance-storage.service` | `enrollKey(…, newId)` de `storage-keys`; el hash lo da `Platform.sha256Hex` |

**Riesgo conocido:** `DEFAULT_ATTENDANCE_POLICY` repite los valores del catálogo de Agrovid. Hasta la F3 pueden desfasarse; en la F3 el catálogo debe apoyarse en esos valores.

**Requisito de la F3:** para que el despliegue de Agrovid instale el paquete privado, su CI necesita un token con permiso `read:packages`, y el paquete debe darle acceso al repositorio de Agrovid.

## 14. F3 — Agrovid adopta el núcleo (plan, 2026-11-14)

Estado: **plan listo; sin PR en Agrovid** hasta cumplir los requisitos de la sección 14.1.

### 14.1 Requisitos previos (no se pueden hacer desde el código)

1. **Publicar la primera versión:** crear la etiqueta `domain-v0.1.0` en este repositorio. El flujo `publish-domain.yml` nunca se ha ejecutado; la primera corrida es su prueba.
2. **Acceso a GitHub Packages desde Agrovid:** darle al repositorio `Agrovid` acceso de lectura al paquete y un token con `read:packages` como secreto de CI (`ci-dev.yml` corre `npm ci` en `aws-serverless` y `sam build`). Agrovid no tiene `.npmrc`: se agrega con `@kgamboa:registry=https://npm.pkg.github.com` y `_authToken=${NODE_AUTH_TOKEN}`.
3. **Equipos de desarrollo:** `deploy.ps1` corre `npm ci` en Windows; cada máquina que despliega necesita el mismo token (variable `NODE_AUTH_TOKEN`). Alternativa provisional sin token: versionar el `.tgz` en `aws-serverless/vendor/` y apuntar la dependencia a `file:`. Es más simple pero hay que actualizarlo a mano.

### 14.2 Qué se comprobó (prueba de consumo, sin subir nada)

En una copia limpia de Agrovid `main`, con el núcleo empaquetado (`npm pack`, 39 archivos) e instalado como tarball:

- `decide-match`, `rotation`, `face-crop` y `geofence-block` se reemplazaron por reexportaciones del núcleo.
- `tsc --noEmit` limpio; las **22 suites / 188 pruebas** de asistencia pasan sin tocar una sola prueba.
- `esbuild` (mismas opciones que SAM: `--bundle`, `--platform=node`, `--target=es2020`, `--minify`, `@aws-sdk/*` externo) empaqueta el módulo en 57 KB: el paquete CommonJS se compila bien en el despliegue.

Es decir: consumir el paquete funciona; lo que falta es publicarlo y la parte difícil (14.3, etapas b y c).

### 14.3 Etapas (un PR por etapa; cada una deja `main` verde y se puede revertir sola)

| Etapa | Qué | Cuánto toca | Compuerta |
|---|---|---|---|
| **F3a** | Hojas sin cambio de nombres: `decide-match`, `rotation`, `face-crop`, `geofence-block`, `geo` (con alias `isOutsideLote` → `isOutsideSite`), `stamp` y `stamp-font` (el logo de Agrovid se pasa por un envoltorio). Se borran los archivos movidos | 7 módulos, 1 a 2 importadores no-prueba cada uno | Pruebas existentes de asistencia sin editar, `tsc`, `sam build` |
| **F3b** | `report`, `roster`, modelo e importación de personal. Capa de traducción de nombres: `loteId↔siteId`, `moduleId↔areaId`, `crewId↔groupId`, `inCrew↔inGroup`, `OUTSIDE_LOTE↔OUTSIDE_SITE`, columna `crew→group`, rótulo "FUERA DEL LOTE" | `report` 4 importadores, modelo 6; salida de la API y la web | Pruebas de contrato de la API sin cambios (la API sigue hablando "lote/cuadrilla") |
| **F3c** | `AttendanceService` y adaptadores: `AttendanceStore` sobre DynamoDB (traduce nombres al leer y escribir, **sin migrar datos**), `FaceRecognition` sobre Rekognition, `BlobStorage` sobre S3, `Platform`, `Brand` (logo), `accessCode`. Se borran `attendance.service.ts` (742 líneas) y las partes de `attendance.repo.ts` que pasan al adaptador | Servicio, repositorio y 3 manejadores (396, 411 y 285 líneas) | **Pruebas de paridad:** las 42 pruebas del servicio de Agrovid corren contra el núcleo con los adaptadores y deben dar el mismo resultado; más una prueba de que los identificadores generados siguen el formato antiguo |

### 14.4 Reglas

- No se borra nada hasta que las pruebas del propio Agrovid pasen contra el núcleo (es el requisito de la sección 9).
- Los formatos de identificadores y de llaves de S3 no cambian: sin migración.
- Cada etapa sube la versión del núcleo solo si hubo que cambiarlo; los cambios al núcleo se hacen aquí primero y Agrovid solo actualiza la dependencia.
- **Reversión:** cada etapa es un PR independiente; revertirlo devuelve los archivos borrados. Se despliega a dev y se prueba el pase de lista en la Mini App antes de la siguiente.
- Ante cualquier diferencia de comportamiento en la paridad, gana Agrovid: se corrige el núcleo.

### 14.5 Riesgos propios de la F3

| Riesgo | Mitigación |
|---|---|
| El despliegue falla por falta de token | Requisito 14.1.2 y 14.1.3 antes del primer PR; la F3a es la prueba |
| Cambio de forma en la salida (`crewId` → `groupId`) rompe web o API | La traducción vive en Agrovid; el contrato externo no cambia |
| Adaptador DynamoDB con diferencias sutiles (condiciones, índices, escritura atómica) | Pruebas de paridad en F3c y despliegue a dev antes de producción |
| Dependencia de un paquete privado en `sam build --cached` | Verificar en la primera corrida de CI; plan B: `.tgz` versionado |
