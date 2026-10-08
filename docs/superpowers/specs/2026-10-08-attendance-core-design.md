# attendance-core — Diseño

Fecha: 2026-10-08 · Estado: borrador para revisión

## 1. Objetivo

Servicio independiente y multi-tenant de **reloj checador** (inspirado en WhatsTime) con canales Web/kiosko, Telegram bot y Telegram MiniApp, reutilizable por otros proyectos (Agrovid, antidoping-lab, ff-agente…) vía API key, webhooks, SDK y widget. Costo de infraestructura objetivo: ≈ $0 al arrancar (solo dominio).

**Fuera de alcance v1:** WhatsApp (Meta cobra por conversación), verificación facial, reportes PDF, QR/carteles, nómina.

## 2. Stack (Cloudflare)

| Pieza | Servicio |
|---|---|
| API | Workers + Hono |
| BD | D1 (SQLite) + Drizzle ORM |
| Fotos/evidencias | R2 (URL prefirmada) |
| Web y MiniApp | Pages (React + Vite, mobile-first) |
| Colas/webhooks | Queues |
| Resumen diario, recordatorios | Cron Triggers |
| Telegram | Bot por webhook (`secret_token`) |

Salida a Postgres (Neon) posible porque todo el acceso a datos pasa por Drizzle. Fotos en R2, solo metadatos en D1 (límite 5 GB/BD).

## 3. Estructura del monorepo (pnpm)

```
apps/api        Workers + Hono + Drizzle
apps/web        kiosko, panel admin, MiniApp
apps/bot        Worker del bot (usa la capa de comandos del núcleo)
packages/shared          esquemas Zod y tipos (contrato único)
packages/evidence-camera cámara + sello (extraído de Agrovid/miniapp-camera/src/camera.ts, drawOverlay)
packages/sdk             cliente y verificación de firma de webhooks
packages/widget          script embebible
```

`evidence-camera` se parametriza (logotipo, fecha/hora, GPS, campos extra) para que Agrovid (PHI/REI/MRL) y antidoping-lab (foto de cassette con folio) lo consuman sin migrar su infraestructura.

## 4. Modelo de datos (D1, todas las tablas con `tenant_id`)

- `tenants` (nombre, zona horaria, logo, plan, `daily_summary`, hora de cierre, política de selfie `off|required|random`, retención)
- `api_keys` (hash, scopes, último uso)
- `employees` (número, nombre, nombre normalizado, rol `admin|employee`, PIN hash, `geofence_on`, `telegram_user_id` único, teléfono)
- `employee_zones`, `zones` (lat, lng, radio, activa)
- `shifts` (turnos y horarios)
- `punches` (inmutables): `employee_id`, tipo `in|out|break_start|break_end`, `server_ts` UTC, lat/lng/accuracy, `zone_id`, `photo_key`, `photo_sha256`, `source` `web|tg_bot|tg_miniapp`, `flags` JSON, `idempotency_key` único
- `leave_requests` (tipo, rango, motivo, evidencias, estado)
- `webhooks` (url, eventos, secreto HMAC)
- `link_codes` (código un solo uso, TTL 24 h)

Índices: (`tenant_id`, fecha) en `punches`; `telegram_user_id`; (`tenant_id`, nombre normalizado). Correcciones = nuevo registro con flag `manual_edit` y autor; nunca se edita un registro.

## 5. Seguridad y anti-fraude

- **El `tenant_id` nunca viene del cliente**: sale del JWT o de la API key resuelta en servidor. Test automático de aislamiento contra todos los endpoints.
- Auth por canal: bot (`from.id` + `secret_token`), MiniApp (`initData` con HMAC y `auth_date` ≤ 5 min → JWT de 15 min), kiosko (token de dispositivo + número + PIN, bloqueo por intentos), admin web (magic link), otros proyectos (API key con scopes, solo hash, rate limit).
- Vinculación Telegram con código de un solo uso; un `telegram_user_id` por empleado; re-vinculación auditada.
- Ubicación: hora siempre del servidor; flags `low_accuracy`, `outside_zone` (rechazo si geofence activo), `teleport` (>200 km/h), `static_coords`, `suspect_mock`. Los flags no bloquean salvo geofence; el admin los revisa.
- Máquina de estados `in → break_start → break_end → out`; `Idempotency-Key` obligatorio.
- Foto: **quemada en `<canvas>` antes de subir** (logotipo, fecha/hora, lat/lng/precisión, zona, empleado y tipo). El servidor guarda SHA-256 y valida que sello y registro coincidan (`stamp_mismatch`). Foto reutilizada detectada por hash perceptual. En el bot, evidencia fuerte solo vía botón "Abrir cámara" (MiniApp); el sellado en servidor queda fuera por el límite de CPU del plan gratuito.
- Privacidad: aviso y consentimiento, retención configurable, cifrado en tránsito/reposo, secretos en Wrangler.

## 6. API (`/v1`) y canales

Endpoints: `POST /punches`, `POST /punches/upload-url`, `GET /punches`, `GET /presence`, `GET /employees/{id}/day`, CRUD `/employees` `/zones` `/shifts` `/webhooks`, `POST /employees/{id}/link-code`, `/leave-requests` (+ `/decision`), `POST /auth/telegram`, `POST /channels/telegram`.

**Capa de comandos independiente del canal** (`getPresent`, `getAbsent`, `getEmployeeDay`, `getStats`, `setDailySummary`). Telegram: `/presentes`, `/ausentes`, `/empleado Juan` (coincidencia aproximada con desambiguación por botones), `/stats`, `/resumen si|no`, `/entrada`, `/salida`.

Webhooks salientes: `punch.created`, `punch.flagged`, `leave.requested`, `leave.decided`, `shift.late`, `daily.summary`; firma HMAC `X-Signature`, reintentos con backoff, DLQ.

Integración: API directa, widget `<script>`, SDK Node/Python.

## 7. Fases

| Fase | Entrega | Listo cuando |
|---|---|---|
| 0 | Monorepo, CI, D1 local (Miniflare), `evidence-camera` extraído con pruebas | CI verde, `drawOverlay` probado |
| 1 | Tenant/empleado/zona, `POST /punches` con foto sellada y geofence, MiniApp de registro | Entrada/salida real desde celular |
| 2 | Panel admin, bot y comandos de admin, vinculación, resumen diario | Admin consulta todo por Telegram |
| 3 | Flags anti-fraude, turnos y retardos, permisos con evidencias | Flags visibles para revisión |
| 4 | API keys, webhooks, SDK, widget, kiosko con PIN | Un proyecto externo consume el SDK |
| 5 | Verificación facial, PDF, QR/carteles, WhatsApp | Solo si se pide |

## 8. Pruebas y despliegue

- Vitest para lógica pura (geofence, anti-fraude, estados, `drawOverlay`, `initData`, firmas), Miniflare para integración con D1, test de aislamiento entre tenants, checklist manual en dispositivo (cámara/GPS dentro de Telegram).
- Ambientes `dev`/`qa`/`prod` en proyectos Cloudflare separados. GitHub Actions: tests en PR; merge a `develop` → qa, a `main` → prod; migraciones D1 antes del deploy. Sin push directo a `main`.

## 9. Riesgos

- D1 a 5 GB → fotos en R2; migración a Postgres vía Drizzle.
- GPS/cámara en WebView de Telegram varían → validar en Fase 1.
- CPU 10 ms/solicitud (plan gratuito) → lógica pesada en cliente, servidor solo valida.
- R2 gratis hasta 10 GB (~10 meses con 100 empleados); después ≈ $0.015/GB-mes.

## 10. Pendiente de decidir

- Modelo de cobro por tenant (si se comercializa).
- Si Agrovid/antidoping adoptan `evidence-camera` como paquete publicado o vía workspace.
