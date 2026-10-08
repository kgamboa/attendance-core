# attendance-core Fases 0–1 (base + rebanada vertical) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un empleado registra entrada/salida/pausa desde una Telegram MiniApp con foto sellada (hora, GPS, logotipo) y geofence, de punta a punta sobre Cloudflare.

**Architecture:** Monorepo pnpm. `apps/api` (Hono en Workers + Drizzle sobre D1 + R2) con lógica de dominio pura y testeada; `packages/evidence-camera` extrae y generaliza `drawOverlay` de Agrovid; `apps/web` es la MiniApp React. El `tenant_id` sale siempre del JWT/API key, nunca del cliente.

**Tech Stack:** pnpm, TypeScript, Hono, Drizzle ORM (sqlite/D1), Zod, Vitest + `@cloudflare/vitest-pool-workers` (Miniflare), React + Vite, Wrangler, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-08-attendance-core-design.md`

## Global Constraints

- Costo de infraestructura ≈ $0: solo Workers, D1, R2, Pages (plan gratuito); CPU ≤ 10 ms por solicitud → el servidor solo valida, la foto se sella en el cliente.
- Toda tabla operativa lleva `tenant_id`; todo acceso a datos recibe `tenantId` como primer parámetro y este viene del JWT/API key, nunca del body/query.
- Hora de un registro = hora del servidor (UTC); se ignora cualquier timestamp del cliente.
- `punches` son inmutables (solo INSERT; correcciones = nuevo registro con flag `manual_edit`).
- Máquina de estados de registro: `in → break_start → break_end → out`; `Idempotency-Key` obligatorio en `POST /v1/punches`.
- Flags: `low_accuracy` (>100 m), `outside_zone` (rechazo si `geofence_on`), `teleport` (>200 km/h), `static_coords`, `stamp_mismatch`.
- La foto se quema en `<canvas>` antes de subir; el servidor guarda SHA-256.
- Sin push directo a `main`: trabajar en la rama `feat/fase-0-1` y abrir PR.
- Versiones: usar las que resuelva `pnpm add` y verificar la configuración de `@cloudflare/vitest-pool-workers` y Drizzle D1 en su documentación vigente (context7) antes de la Tarea 4.

## Estructura de archivos

```
package.json, pnpm-workspace.yaml, tsconfig.base.json, .gitignore, .github/workflows/ci.yml
packages/shared/src/{index.ts,punch.ts}                  contrato Zod
packages/evidence-camera/src/{index.ts,overlay.ts}       sello de foto
packages/evidence-camera/src/__tests__/overlay.test.ts
apps/api/wrangler.toml, vitest.config.ts, drizzle.config.ts
apps/api/src/index.ts                                    app Hono (rutas)
apps/api/src/env.ts                                      tipo Bindings
apps/api/src/db/schema.ts                                tablas Drizzle
apps/api/src/db/repo.ts                                  acceso a datos con tenantId
apps/api/src/domain/{geofence.ts,state.ts,flags.ts}      lógica pura
apps/api/src/auth/{jwt.ts,telegram.ts,apikey.ts}
apps/api/src/routes/{auth.ts,punches.ts,photo.ts,admin.ts}
apps/api/test/*.test.ts, apps/api/test/setup.ts
apps/api/scripts/create-tenant.mjs
apps/web/{index.html,vite.config.ts}, apps/web/src/{main.tsx,CheckIn.tsx,lib/api.ts,lib/telegram.ts}
```

---

### Task 1: Scaffold del monorepo y CI

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`, `.nvmrc`, `.github/workflows/ci.yml`

**Interfaces:** Produces: scripts raíz `pnpm test`, `pnpm typecheck` que corren en todos los paquetes.

- [ ] **Step 1: Crear rama y archivos base**

```bash
cd /c/Users/karlo/source/repos/attendance-core && git checkout -b feat/fase-0-1
```

`package.json`:
```json
{
  "name": "attendance-core",
  "private": true,
  "packageManager": "pnpm@9.12.0",
  "scripts": {
    "test": "pnpm -r --if-present test",
    "typecheck": "pnpm -r --if-present typecheck"
  },
  "devDependencies": { "typescript": "^5.5.4", "vitest": "^2.1.0" }
}
```
`pnpm-workspace.yaml`:
```yaml
packages:
  - "apps/*"
  - "packages/*"
```
`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler",
    "strict": true, "noUncheckedIndexedAccess": true, "skipLibCheck": true,
    "esModuleInterop": true, "resolveJsonModule": true, "lib": ["ES2022", "DOM"]
  }
}
```
`.gitignore`: `node_modules`, `dist`, `.wrangler`, `.dev.vars`, `*.log`. `.nvmrc`: `20`.

- [ ] **Step 2: CI**

`.github/workflows/ci.yml`:
```yaml
name: ci
on: { pull_request: {}, push: { branches: [main, develop] } }
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version-file: .nvmrc, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm test
```

- [ ] **Step 3: Instalar y commit**

Run: `pnpm install` → Expected: crea `pnpm-lock.yaml` sin errores.
```bash
git add -A && git commit -m "chore: scaffold monorepo pnpm y CI"
```

---

### Task 2: `packages/shared` — contrato Zod

**Files:**
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/src/punch.ts`, `packages/shared/src/index.ts`, `packages/shared/src/punch.test.ts`

**Interfaces:** Produces: `PunchType`, `Flag`, `PunchInput` (Zod) y tipos `PunchTypeT`, `FlagT`, `PunchInputT`.

- [ ] **Step 1: package.json y tsconfig**

```json
{ "name": "@attendance/shared", "version": "0.0.0", "type": "module",
  "main": "src/index.ts", "types": "src/index.ts",
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit" },
  "dependencies": { "zod": "^3.23.8" } }
```
`tsconfig.json`: `{ "extends": "../../tsconfig.base.json", "include": ["src"] }`. Run `pnpm install`.

- [ ] **Step 2: Test que falla** — `packages/shared/src/punch.test.ts`

```ts
import { describe, test, expect } from 'vitest';
import { PunchInput } from './punch';

const base = { employeeId: 'e1', type: 'in', lat: 20.5, lng: -100.4, accuracy: 12, source: 'tg_miniapp' };

describe('PunchInput', () => {
  test('acepta un registro válido', () => {
    expect(PunchInput.safeParse(base).success).toBe(true);
  });
  test('rechaza latitud fuera de rango', () => {
    expect(PunchInput.safeParse({ ...base, lat: 91 }).success).toBe(false);
  });
  test('rechaza tipo desconocido', () => {
    expect(PunchInput.safeParse({ ...base, type: 'lunch' }).success).toBe(false);
  });
  test('rechaza sha256 mal formado', () => {
    expect(PunchInput.safeParse({ ...base, photoKey: 'k', photoSha256: 'zz' }).success).toBe(false);
  });
});
```
Run: `pnpm --filter @attendance/shared test` → Expected: FAIL (módulo `./punch` no existe).

- [ ] **Step 3: Implementar** — `src/punch.ts`

```ts
import { z } from 'zod';

export const PunchType = z.enum(['in', 'out', 'break_start', 'break_end']);
export const Flag = z.enum(['low_accuracy', 'outside_zone', 'teleport', 'static_coords', 'stamp_mismatch', 'manual_edit']);

export const PunchInput = z.object({
  employeeId: z.string().min(1),
  type: PunchType,
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().nonnegative(),
  photoKey: z.string().min(1).optional(),
  photoSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  source: z.enum(['web', 'tg_bot', 'tg_miniapp']),
});

export type PunchTypeT = z.infer<typeof PunchType>;
export type FlagT = z.infer<typeof Flag>;
export type PunchInputT = z.infer<typeof PunchInput>;
```
`src/index.ts`: `export * from './punch';`

- [ ] **Step 4: Verificar y commit**

Run: `pnpm --filter @attendance/shared test` → PASS (4 tests).
```bash
git add -A && git commit -m "feat(shared): contrato Zod de registros"
```

---

### Task 3: `packages/evidence-camera` — sello generalizado

Extrae `drawOverlay` de `Agrovid/miniapp-camera/src/camera.ts` y lo generaliza: el sello recibe `extraLines` (en vez de campos fijos de Agrovid) y un logotipo opcional.

**Files:**
- Create: `packages/evidence-camera/package.json`, `tsconfig.json`, `src/overlay.ts`, `src/index.ts`, `src/__tests__/overlay.test.ts`

**Interfaces:** Produces:
```ts
export interface OverlayData { timestamp: string; lat?: number; lng?: number; accuracy?: number; extraLines?: string[]; }
export interface OverlayLogo { image: CanvasImageSource; width: number; height: number; }
export function buildOverlayLines(data: OverlayData): string[];
export function drawOverlay(ctx: OverlayCtx, width: number, height: number, data: OverlayData, logo?: OverlayLogo): void;
```

- [ ] **Step 1: package.json** (`name: @attendance/evidence-camera`, `main/types: src/index.ts`, scripts `test`/`typecheck` como en shared, devDependency `vitest`), `tsconfig.json` igual al de shared. `pnpm install`.

- [ ] **Step 2: Test que falla** — `src/__tests__/overlay.test.ts` (portado del test de Agrovid + logotipo y extraLines)

```ts
import { describe, test, expect, vi } from 'vitest';
import { drawOverlay, buildOverlayLines } from '../overlay';

function makeCtx() {
  return { fillStyle: '', font: '', fillRect: vi.fn(), fillText: vi.fn(), drawImage: vi.fn() };
}
const textsOf = (ctx: ReturnType<typeof makeCtx>) => ctx.fillText.mock.calls.map((c) => c[0] as string);

describe('overlay', () => {
  test('sin lat/lng muestra "Ubicación no disponible"', () => {
    expect(buildOverlayLines({ timestamp: 't' })).toContain('Ubicación no disponible');
  });
  test('con lat/lng formatea a 6 decimales y precisión', () => {
    expect(buildOverlayLines({ timestamp: 't', lat: 22.123456789, lng: -98.987654321, accuracy: 12.4 }))
      .toContain('22.123457, -98.987654 (±12m)');
  });
  test('sin accuracy no agrega paréntesis', () => {
    expect(buildOverlayLines({ timestamp: 't', lat: 1, lng: 2 })).toContain('1.000000, 2.000000');
  });
  test('agrega extraLines al final', () => {
    const lines = buildOverlayLines({ timestamp: 't', extraLines: ['Juan Pérez #0012', 'ENTRADA'] });
    expect(lines.slice(-2)).toEqual(['Juan Pérez #0012', 'ENTRADA']);
  });
  test('la barra crece con el número de líneas', () => {
    const a = makeCtx(); drawOverlay(a, 800, 600, { timestamp: 't' });
    const b = makeCtx(); drawOverlay(b, 800, 600, { timestamp: 't', extraLines: ['x', 'y'] });
    expect((b.fillRect.mock.calls[0] as number[])[3]).toBeGreaterThan((a.fillRect.mock.calls[0] as number[])[3]!);
  });
  test('dibuja el logotipo solo si se provee', () => {
    const logo = { image: {} as CanvasImageSource, width: 100, height: 50 };
    const withLogo = makeCtx(); drawOverlay(withLogo, 800, 600, { timestamp: 't' }, logo);
    expect(withLogo.drawImage).toHaveBeenCalledTimes(1);
    const without = makeCtx(); drawOverlay(without, 800, 600, { timestamp: 't' });
    expect(without.drawImage).not.toHaveBeenCalled();
  });
  test('el logotipo no excede 48 px de alto y conserva proporción', () => {
    const ctx = makeCtx();
    drawOverlay(ctx, 800, 600, { timestamp: 't' }, { image: {} as CanvasImageSource, width: 200, height: 100 });
    const [, , , w, h] = ctx.drawImage.mock.calls[0] as unknown[] as number[];
    // args: image, x, y, w, h
    expect(h).toBeLessThanOrEqual(48);
    expect(w! / h!).toBeCloseTo(2);
  });
});
```
Run: `pnpm --filter @attendance/evidence-camera test` → Expected: FAIL (módulo no existe).

- [ ] **Step 3: Implementar** — `src/overlay.ts`

```ts
export interface OverlayData {
  timestamp: string;
  lat?: number;
  lng?: number;
  accuracy?: number;
  extraLines?: string[];
}
export interface OverlayLogo { image: CanvasImageSource; width: number; height: number; }
export type OverlayCtx = Pick<CanvasRenderingContext2D, 'fillRect' | 'fillText' | 'fillStyle' | 'font' | 'drawImage'>;

const LINE_HEIGHT = 22;
const MAX_LOGO_H = 48;

export function buildOverlayLines(data: OverlayData): string[] {
  const lines = [data.timestamp];
  lines.push(
    data.lat != null && data.lng != null
      ? `${data.lat.toFixed(6)}, ${data.lng.toFixed(6)}${data.accuracy != null ? ` (±${Math.round(data.accuracy)}m)` : ''}`
      : 'Ubicación no disponible',
  );
  if (data.extraLines) lines.push(...data.extraLines);
  return lines;
}

export function drawOverlay(
  ctx: OverlayCtx, width: number, height: number, data: OverlayData, logo?: OverlayLogo,
): void {
  const lines = buildOverlayLines(data);
  const barHeight = lines.length * LINE_HEIGHT + 12;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.fillRect(0, height - barHeight, width, barHeight);

  ctx.fillStyle = '#ffffff';
  ctx.font = '16px sans-serif';
  lines.forEach((line, i) => ctx.fillText(line, 12, height - barHeight + 20 + i * LINE_HEIGHT));

  if (logo) {
    const h = Math.min(MAX_LOGO_H, logo.height);
    const w = (logo.width / logo.height) * h;
    ctx.drawImage(logo.image, width - w - 12, height - barHeight + 6, w, h);
  }
}
```
`src/index.ts`: `export * from './overlay';`

- [ ] **Step 4: Verificar y commit**

Run: `pnpm --filter @attendance/evidence-camera test` → PASS (7 tests).
```bash
git add -A && git commit -m "feat(evidence-camera): sello de foto con logotipo y líneas extra (extraído de Agrovid)"
```

---

### Task 4: `apps/api` — Worker, D1, Drizzle y arnés de pruebas

**Files:**
- Create: `apps/api/package.json`, `tsconfig.json`, `wrangler.toml`, `vitest.config.ts`, `drizzle.config.ts`, `src/env.ts`, `src/db/schema.ts`, `src/index.ts`, `test/setup.ts`, `test/health.test.ts`, `migrations/` (generado)

**Interfaces:** Produces: `Env` (Bindings: `DB: D1Database`, `PHOTOS: R2Bucket`, `JWT_SECRET: string`, `BOT_TOKEN: string`), tablas Drizzle `tenants, apiKeys, employees, zones, employeeZones, punches`, `app` Hono exportado por defecto.

- [ ] **Step 1: Dependencias**

```bash
cd apps/api && pnpm init >/dev/null
pnpm add hono drizzle-orm zod @attendance/shared@workspace:*
pnpm add -D wrangler drizzle-kit vitest @cloudflare/vitest-pool-workers @cloudflare/workers-types typescript
```
`package.json`: `"name":"@attendance/api"`, `"type":"module"`, scripts `test: vitest run`, `typecheck: tsc --noEmit`, `db:generate: drizzle-kit generate`, `dev: wrangler dev`. `tsconfig.json`: extends base, `"types": ["@cloudflare/workers-types", "@cloudflare/vitest-pool-workers"]`, include `src`, `test`.

- [ ] **Step 2: `wrangler.toml`**

```toml
name = "attendance-api"
main = "src/index.ts"
compatibility_date = "2024-11-01"
compatibility_flags = ["nodejs_compat"]

[[d1_databases]]
binding = "DB"
database_name = "attendance-dev"
database_id = "00000000-0000-0000-0000-000000000000"   # reemplazar con `wrangler d1 create attendance-dev`
migrations_dir = "migrations"

[[r2_buckets]]
binding = "PHOTOS"
bucket_name = "attendance-photos-dev"
```

- [ ] **Step 3: Esquema** — `src/db/schema.ts`

```ts
import { sqliteTable, text, integer, real, index, uniqueIndex, primaryKey } from 'drizzle-orm/sqlite-core';

export const tenants = sqliteTable('tenants', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  timezone: text('timezone').notNull().default('America/Mexico_City'),
  logoKey: text('logo_key'),
  selfiePolicy: text('selfie_policy', { enum: ['off', 'required', 'random'] }).notNull().default('required'),
});

export const apiKeys = sqliteTable('api_keys', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  keyHash: text('key_hash').notNull().unique(),
  scopes: text('scopes').notNull(), // lista separada por comas, ej. "admin,punches:write"
});

export const employees = sqliteTable('employees', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  number: text('number').notNull(),
  name: text('name').notNull(),
  role: text('role', { enum: ['admin', 'employee'] }).notNull().default('employee'),
  geofenceOn: integer('geofence_on', { mode: 'boolean' }).notNull().default(false),
  telegramUserId: integer('telegram_user_id'),
}, (t) => ({
  numPerTenant: uniqueIndex('employees_tenant_number').on(t.tenantId, t.number),
  tg: uniqueIndex('employees_tg').on(t.telegramUserId),
}));

export const zones = sqliteTable('zones', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  name: text('name').notNull(),
  lat: real('lat').notNull(),
  lng: real('lng').notNull(),
  radiusM: integer('radius_m').notNull(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
});

export const employeeZones = sqliteTable('employee_zones', {
  tenantId: text('tenant_id').notNull(),
  employeeId: text('employee_id').notNull(),
  zoneId: text('zone_id').notNull(),
}, (t) => ({ pk: primaryKey({ columns: [t.employeeId, t.zoneId] }) }));

export const punches = sqliteTable('punches', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  employeeId: text('employee_id').notNull(),
  type: text('type', { enum: ['in', 'out', 'break_start', 'break_end'] }).notNull(),
  serverTs: integer('server_ts').notNull(), // epoch ms UTC
  lat: real('lat').notNull(),
  lng: real('lng').notNull(),
  accuracy: real('accuracy').notNull(),
  zoneId: text('zone_id'),
  photoKey: text('photo_key'),
  photoSha256: text('photo_sha256'),
  source: text('source', { enum: ['web', 'tg_bot', 'tg_miniapp'] }).notNull(),
  flags: text('flags').notNull().default('[]'), // JSON string[]
  idempotencyKey: text('idempotency_key').notNull(),
}, (t) => ({
  idem: uniqueIndex('punches_idem').on(t.tenantId, t.idempotencyKey),
  byEmp: index('punches_emp_ts').on(t.tenantId, t.employeeId, t.serverTs),
}));
```
`drizzle.config.ts`: `export default { schema: './src/db/schema.ts', out: './migrations', dialect: 'sqlite' };`
Run: `pnpm db:generate` → Expected: crea `migrations/0000_*.sql`.

- [ ] **Step 4: Env y app mínima**

`src/env.ts`:
```ts
export type Env = { DB: D1Database; PHOTOS: R2Bucket; JWT_SECRET: string; BOT_TOKEN: string };
```
`src/index.ts`:
```ts
import { Hono } from 'hono';
import type { Env } from './env';

const app = new Hono<{ Bindings: Env }>();
app.get('/health', (c) => c.json({ ok: true }));
export default app;
```

- [ ] **Step 5: Arnés de pruebas**

`vitest.config.ts`:
```ts
import path from 'node:path';
import { defineWorkersConfig, readD1Migrations } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig(async () => {
  const migrations = await readD1Migrations(path.join(__dirname, 'migrations'));
  return {
    test: {
      setupFiles: ['./test/setup.ts'],
      poolOptions: {
        workers: {
          wrangler: { configPath: './wrangler.toml' },
          miniflare: {
            bindings: { TEST_MIGRATIONS: migrations, JWT_SECRET: 'test-secret', BOT_TOKEN: '123:TEST' },
          },
        },
      },
    },
  };
});
```
`test/setup.ts`:
```ts
import { applyD1Migrations, env } from 'cloudflare:test';
await applyD1Migrations(env.DB, (env as any).TEST_MIGRATIONS);
```
`test/health.test.ts`:
```ts
import { SELF } from 'cloudflare:test';
import { test, expect } from 'vitest';
test('GET /health', async () => {
  const res = await SELF.fetch('http://x/health');
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});
```

- [ ] **Step 6: Verificar y commit**

Run: `pnpm --filter @attendance/api test` → Expected: PASS (1 test). Si la configuración del pool falla por diferencia de versión, ajustar según la documentación vigente de `@cloudflare/vitest-pool-workers` (D1 migrations) manteniendo el mismo resultado.
```bash
git add -A && git commit -m "feat(api): Worker Hono, esquema D1/Drizzle y arnés de pruebas Miniflare"
```

---

### Task 5: Dominio puro — geofence, máquina de estados, flags

**Files:**
- Create: `apps/api/src/domain/geofence.ts`, `state.ts`, `flags.ts`; `apps/api/test/domain.test.ts`

**Interfaces:** Produces:
```ts
type Point = { lat: number; lng: number };
type ZoneLite = { id: string; lat: number; lng: number; radiusM: number };
haversineMeters(a: Point, b: Point): number
findZone(p: Point, zones: ZoneLite[]): ZoneLite | null
isAllowed(last: PunchTypeT | null, next: PunchTypeT): boolean
computeFlags(i: { accuracy: number; point: Point; nowMs: number; prev?: { point: Point; tsMs: number } }): FlagT[]
```

- [ ] **Step 1: Test que falla** — `test/domain.test.ts`

```ts
import { describe, test, expect } from 'vitest';
import { haversineMeters, findZone } from '../src/domain/geofence';
import { isAllowed } from '../src/domain/state';
import { computeFlags } from '../src/domain/flags';

const A = { lat: 19.4326, lng: -99.1332 };

describe('geofence', () => {
  test('distancia a sí mismo es 0', () => expect(haversineMeters(A, A)).toBe(0));
  test('~111 m por 0.001° de latitud', () => {
    expect(haversineMeters(A, { lat: A.lat + 0.001, lng: A.lng })).toBeCloseTo(111.2, 0);
  });
  test('findZone devuelve la zona que contiene el punto', () => {
    const z = { id: 'z1', ...A, radiusM: 100 };
    expect(findZone({ lat: A.lat + 0.0005, lng: A.lng }, [z])?.id).toBe('z1');
    expect(findZone({ lat: A.lat + 0.01, lng: A.lng }, [z])).toBeNull();
  });
});

describe('state machine', () => {
  test.each([
    [null, 'in', true], [null, 'out', false],
    ['in', 'in', false], ['in', 'break_start', true], ['in', 'out', true],
    ['break_start', 'break_end', true], ['break_start', 'out', false],
    ['break_end', 'break_start', true], ['break_end', 'out', true],
    ['out', 'in', true], ['out', 'out', false],
  ] as const)('%s → %s = %s', (last, next, ok) => expect(isAllowed(last, next)).toBe(ok));
});

describe('flags', () => {
  const now = 1_700_000_000_000;
  test('sin anomalías no hay flags', () => {
    expect(computeFlags({ accuracy: 10, point: A, nowMs: now })).toEqual([]);
  });
  test('precisión > 100 m → low_accuracy', () => {
    expect(computeFlags({ accuracy: 150, point: A, nowMs: now })).toContain('low_accuracy');
  });
  test('~111 km en 1 minuto → teleport', () => {
    const f = computeFlags({ accuracy: 5, point: { lat: A.lat + 1, lng: A.lng }, nowMs: now, prev: { point: A, tsMs: now - 60_000 } });
    expect(f).toContain('teleport');
  });
  test('mismas coordenadas exactas que el registro previo → static_coords', () => {
    expect(computeFlags({ accuracy: 5, point: A, nowMs: now, prev: { point: A, tsMs: now - 3_600_000 } })).toContain('static_coords');
  });
  test('desplazamiento razonable no es teleport', () => {
    const f = computeFlags({ accuracy: 5, point: { lat: A.lat + 0.01, lng: A.lng }, nowMs: now, prev: { point: A, tsMs: now - 3_600_000 } });
    expect(f).not.toContain('teleport');
  });
});
```
Run: `pnpm --filter @attendance/api test` → Expected: FAIL (módulos no existen).

- [ ] **Step 2: Implementar**

`domain/geofence.ts`:
```ts
export type Point = { lat: number; lng: number };
export type ZoneLite = { id: string; lat: number; lng: number; radiusM: number };

const R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

export function haversineMeters(a: Point, b: Point): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function findZone(p: Point, zones: ZoneLite[]): ZoneLite | null {
  return zones.find((z) => haversineMeters(p, z) <= z.radiusM) ?? null;
}
```
`domain/state.ts`:
```ts
import type { PunchTypeT } from '@attendance/shared';

const NEXT: Record<string, PunchTypeT[]> = {
  none: ['in'],
  in: ['break_start', 'out'],
  break_start: ['break_end'],
  break_end: ['break_start', 'out'],
  out: ['in'],
};

export function isAllowed(last: PunchTypeT | null, next: PunchTypeT): boolean {
  return NEXT[last ?? 'none']!.includes(next);
}
```
`domain/flags.ts`:
```ts
import type { FlagT } from '@attendance/shared';
import { haversineMeters, type Point } from './geofence';

const MAX_SPEED_MS = 200 / 3.6; // 200 km/h en m/s

export function computeFlags(i: {
  accuracy: number; point: Point; nowMs: number; prev?: { point: Point; tsMs: number };
}): FlagT[] {
  const flags: FlagT[] = [];
  if (i.accuracy > 100) flags.push('low_accuracy');
  if (i.prev) {
    const dist = haversineMeters(i.prev.point, i.point);
    if (dist === 0) flags.push('static_coords');
    const dt = Math.max((i.nowMs - i.prev.tsMs) / 1000, 1);
    if (dist > 200 && dist / dt > MAX_SPEED_MS) flags.push('teleport');
  }
  return flags;
}
```

- [ ] **Step 3: Verificar y commit**

Run: `pnpm --filter @attendance/api test` → PASS.
```bash
git add -A && git commit -m "feat(api): dominio puro (geofence, estados, flags anti-fraude)"
```

---

### Task 6: Auth — `initData` de Telegram, JWT y API key

**Files:**
- Create: `apps/api/src/auth/jwt.ts`, `telegram.ts`, `apikey.ts`; `apps/api/test/auth.test.ts`

**Interfaces:** Produces:
```ts
signJwt(payload: { tid: string; eid: string; role: 'admin'|'employee' }, secret: string, ttlSec: number, nowSec: number): Promise<string>
verifyJwt(token: string, secret: string, nowSec: number): Promise<{ tid: string; eid: string; role: 'admin'|'employee' } | null>
verifyInitData(initData: string, botToken: string, nowSec: number, maxAgeSec?: number): Promise<{ ok: true; userId: number } | { ok: false; reason: string }>
signInitData(params: Record<string,string>, botToken: string): Promise<string>   // helper de pruebas y de la fase 2
sha256Hex(s: string): Promise<string>
```

- [ ] **Step 1: Test que falla** — `test/auth.test.ts`

```ts
import { describe, test, expect } from 'vitest';
import { signJwt, verifyJwt } from '../src/auth/jwt';
import { verifyInitData, signInitData } from '../src/auth/telegram';

const BOT = '123:TEST';
const now = 1_700_000_000;
const user = JSON.stringify({ id: 777, first_name: 'Ana' });

describe('jwt', () => {
  test('ida y vuelta', async () => {
    const t = await signJwt({ tid: 't1', eid: 'e1', role: 'employee' }, 's', 900, now);
    expect(await verifyJwt(t, 's', now + 10)).toMatchObject({ tid: 't1', eid: 'e1' });
  });
  test('expira', async () => {
    const t = await signJwt({ tid: 't1', eid: 'e1', role: 'employee' }, 's', 900, now);
    expect(await verifyJwt(t, 's', now + 901)).toBeNull();
  });
  test('rechaza firma con otro secreto', async () => {
    const t = await signJwt({ tid: 't1', eid: 'e1', role: 'employee' }, 's', 900, now);
    expect(await verifyJwt(t, 'otro', now)).toBeNull();
  });
});

describe('initData', () => {
  test('acepta datos válidos recientes', async () => {
    const d = await signInitData({ user, auth_date: String(now - 60) }, BOT);
    expect(await verifyInitData(d, BOT, now)).toEqual({ ok: true, userId: 777 });
  });
  test('rechaza hash adulterado', async () => {
    const d = (await signInitData({ user, auth_date: String(now) }, BOT)).replace(/hash=.{4}/, 'hash=0000');
    expect((await verifyInitData(d, BOT, now)).ok).toBe(false);
  });
  test('rechaza auth_date viejo (> 5 min)', async () => {
    const d = await signInitData({ user, auth_date: String(now - 301) }, BOT);
    expect(await verifyInitData(d, BOT, now)).toEqual({ ok: false, reason: 'expired' });
  });
  test('rechaza token de bot distinto', async () => {
    const d = await signInitData({ user, auth_date: String(now) }, BOT);
    expect((await verifyInitData(d, '999:OTRO', now)).ok).toBe(false);
  });
});
```
Run → FAIL.

- [ ] **Step 2: Implementar**

`auth/jwt.ts`:
```ts
const enc = new TextEncoder();
const b64u = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function key(secret: string) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export type Claims = { tid: string; eid: string; role: 'admin' | 'employee' };

export async function signJwt(p: Claims, secret: string, ttlSec: number, nowSec: number): Promise<string> {
  const head = b64u(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = b64u(enc.encode(JSON.stringify({ ...p, iat: nowSec, exp: nowSec + ttlSec })));
  const sig = await crypto.subtle.sign('HMAC', await key(secret), enc.encode(`${head}.${body}`));
  return `${head}.${body}.${b64u(sig)}`;
}

export async function verifyJwt(token: string, secret: string, nowSec: number): Promise<Claims | null> {
  const [h, b, s] = token.split('.');
  if (!h || !b || !s) return null;
  const ok = await crypto.subtle.verify('HMAC', await key(secret), fromB64u(s), enc.encode(`${h}.${b}`));
  if (!ok) return null;
  const p = JSON.parse(new TextDecoder().decode(fromB64u(b)));
  if (typeof p.exp !== 'number' || p.exp <= nowSec) return null;
  return { tid: p.tid, eid: p.eid, role: p.role };
}
```
`auth/telegram.ts`:
```ts
const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

async function hmac(keyBytes: ArrayBuffer | Uint8Array, msg: string) {
  const k = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, enc.encode(msg));
}

async function hashFor(params: Record<string, string>, botToken: string) {
  const dcs = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('\n');
  const secret = await hmac(enc.encode('WebAppData'), botToken);
  return hex(await hmac(secret, dcs));
}

export async function signInitData(params: Record<string, string>, botToken: string): Promise<string> {
  const hash = await hashFor(params, botToken);
  return new URLSearchParams({ ...params, hash }).toString();
}

export async function verifyInitData(initData: string, botToken: string, nowSec: number, maxAgeSec = 300):
  Promise<{ ok: true; userId: number } | { ok: false; reason: string }> {
  const sp = new URLSearchParams(initData);
  const hash = sp.get('hash');
  if (!hash) return { ok: false, reason: 'no_hash' };
  sp.delete('hash');
  const params = Object.fromEntries(sp.entries());
  if ((await hashFor(params, botToken)) !== hash) return { ok: false, reason: 'bad_hash' };
  if (nowSec - Number(params.auth_date) > maxAgeSec) return { ok: false, reason: 'expired' };
  try { return { ok: true, userId: JSON.parse(params.user ?? '{}').id }; }
  catch { return { ok: false, reason: 'bad_user' }; }
}
```
`auth/apikey.ts`:
```ts
export async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
```

- [ ] **Step 3: Verificar y commit**

Run: `pnpm --filter @attendance/api test` → PASS.
```bash
git add -A && git commit -m "feat(api): verificación de initData de Telegram, JWT HS256 y hash de API key"
```

---

### Task 7: Repositorio con tenant, rutas de auth y administración

**Files:**
- Create: `apps/api/src/db/repo.ts`, `apps/api/src/routes/auth.ts`, `apps/api/src/routes/admin.ts`, `apps/api/test/helpers.ts`, `apps/api/test/admin-auth.test.ts`
- Modify: `apps/api/src/index.ts`

**Interfaces:** Produces (`db/repo.ts`, **todas** reciben `tenantId` primero salvo `findEmployeeByTelegram` y `findApiKey`):
```ts
makeRepo(d1: D1Database): {
  findApiKey(hash: string): Promise<{ tenantId: string; scopes: string[] } | null>;
  findEmployeeByTelegram(tgUserId: number): Promise<{ id: string; tenantId: string; role: 'admin'|'employee' } | null>;
  getEmployee(tenantId: string, id: string): Promise<EmployeeRow | null>;
  createEmployee(tenantId: string, e: { number: string; name: string; geofenceOn?: boolean; telegramUserId?: number }): Promise<string>;
  createZone(tenantId: string, z: { name: string; lat: number; lng: number; radiusM: number }): Promise<string>;
  assignZone(tenantId: string, employeeId: string, zoneId: string): Promise<void>;
  zonesForEmployee(tenantId: string, employeeId: string): Promise<ZoneLite[]>;
  lastPunch(tenantId: string, employeeId: string): Promise<{ type: PunchTypeT; serverTs: number; lat: number; lng: number } | null>;
  findPunchByIdem(tenantId: string, key: string): Promise<PunchRow | null>;
  insertPunch(tenantId: string, p: NewPunch): Promise<PunchRow>;
}
```
Rutas: `POST /v1/auth/telegram {initData}` → `{ token }`; `POST /v1/employees` y `POST /v1/zones` y `POST /v1/employees/:id/zones/:zoneId` (Bearer API key con scope `admin`; `tenantId` de la key). Produces en tests: `helpers.ts` con `seedTenant(id)`, `seedEmployee(tenantId, opts)`, `jwtFor(tid, eid)`.

- [ ] **Step 1: Test que falla** — `test/admin-auth.test.ts`

```ts
import { SELF, env } from 'cloudflare:test';
import { describe, test, expect } from 'vitest';
import { seedTenant, seedApiKey } from './helpers';
import { signInitData } from '../src/auth/telegram';

const json = (b: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });

describe('admin con API key', () => {
  test('sin Bearer → 401', async () => {
    expect((await SELF.fetch('http://x/v1/zones', json({}))).status).toBe(401);
  });
  test('crea empleado y zona en el tenant de la key, ignorando tenantId del body', async () => {
    await seedTenant('tA'); await seedTenant('tB');
    const key = await seedApiKey('tA', 'admin');
    const h = { 'content-type': 'application/json', authorization: `Bearer ${key}` };
    const r = await SELF.fetch('http://x/v1/employees', { method: 'POST', headers: h, body: JSON.stringify({ number: '0001', name: 'Ana', tenantId: 'tB' }) });
    expect(r.status).toBe(201);
    const { id } = await r.json() as { id: string };
    const row = await env.DB.prepare('select tenant_id from employees where id=?').bind(id).first<{ tenant_id: string }>();
    expect(row?.tenant_id).toBe('tA');
  });
});

describe('POST /v1/auth/telegram', () => {
  test('empleado vinculado recibe JWT; no vinculado recibe 403', async () => {
    await seedTenant('tC');
    const key = await seedApiKey('tC', 'admin');
    const h = { 'content-type': 'application/json', authorization: `Bearer ${key}` };
    await SELF.fetch('http://x/v1/employees', { method: 'POST', headers: h, body: JSON.stringify({ number: '0002', name: 'Beto', telegramUserId: 4242 }) });
    const now = Math.floor(Date.now() / 1000);
    const ok = await signInitData({ user: JSON.stringify({ id: 4242 }), auth_date: String(now) }, env.BOT_TOKEN);
    const r1 = await SELF.fetch('http://x/v1/auth/telegram', json({ initData: ok }));
    expect(r1.status).toBe(200);
    expect(typeof (await r1.json() as { token: string }).token).toBe('string');
    const other = await signInitData({ user: JSON.stringify({ id: 9999 }), auth_date: String(now) }, env.BOT_TOKEN);
    expect((await SELF.fetch('http://x/v1/auth/telegram', json({ initData: other }))).status).toBe(403);
  });
});
```
`test/helpers.ts` (Create):
```ts
import { env } from 'cloudflare:test';
import { sha256Hex } from '../src/auth/apikey';
import { signJwt } from '../src/auth/jwt';

export async function seedTenant(id: string) {
  await env.DB.prepare('insert or ignore into tenants (id, name) values (?, ?)').bind(id, id).run();
}
export async function seedApiKey(tenantId: string, scopes: string): Promise<string> {
  const raw = `ak_${crypto.randomUUID()}`;
  await env.DB.prepare('insert into api_keys (id, tenant_id, key_hash, scopes) values (?,?,?,?)')
    .bind(crypto.randomUUID(), tenantId, await sha256Hex(raw), scopes).run();
  return raw;
}
export async function jwtFor(tid: string, eid: string, role: 'admin' | 'employee' = 'employee') {
  return signJwt({ tid, eid, role }, env.JWT_SECRET, 900, Math.floor(Date.now() / 1000));
}
```
Run → FAIL.

- [ ] **Step 2: Implementar `db/repo.ts`** con Drizzle (`drizzle(d1)`), `and(eq(table.tenantId, tenantId), …)` en **cada** consulta. Ejemplo representativo (el resto sigue el mismo patrón y las firmas de arriba):

```ts
import { drizzle } from 'drizzle-orm/d1';
import { and, eq, desc, inArray } from 'drizzle-orm';
import * as s from './schema';

export function makeRepo(d1: D1Database) {
  const db = drizzle(d1, { schema: s });
  return {
    async findApiKey(hash: string) {
      const r = await db.select().from(s.apiKeys).where(eq(s.apiKeys.keyHash, hash)).get();
      return r ? { tenantId: r.tenantId, scopes: r.scopes.split(',') } : null;
    },
    async findEmployeeByTelegram(tg: number) {
      const r = await db.select().from(s.employees).where(eq(s.employees.telegramUserId, tg)).get();
      return r ? { id: r.id, tenantId: r.tenantId, role: r.role } : null;
    },
    async getEmployee(tenantId: string, id: string) {
      return (await db.select().from(s.employees)
        .where(and(eq(s.employees.tenantId, tenantId), eq(s.employees.id, id))).get()) ?? null;
    },
    async createEmployee(tenantId: string, e: { number: string; name: string; geofenceOn?: boolean; telegramUserId?: number }) {
      const id = crypto.randomUUID();
      await db.insert(s.employees).values({ id, tenantId, number: e.number, name: e.name, geofenceOn: e.geofenceOn ?? false, telegramUserId: e.telegramUserId });
      return id;
    },
    async createZone(tenantId: string, z: { name: string; lat: number; lng: number; radiusM: number }) {
      const id = crypto.randomUUID();
      await db.insert(s.zones).values({ id, tenantId, ...z });
      return id;
    },
    async assignZone(tenantId: string, employeeId: string, zoneId: string) {
      await db.insert(s.employeeZones).values({ tenantId, employeeId, zoneId });
    },
    async zonesForEmployee(tenantId: string, employeeId: string) {
      const links = await db.select().from(s.employeeZones)
        .where(and(eq(s.employeeZones.tenantId, tenantId), eq(s.employeeZones.employeeId, employeeId))).all();
      if (links.length === 0) {
        // sin selección específica = todas las zonas activas del tenant
        return (await db.select().from(s.zones).where(and(eq(s.zones.tenantId, tenantId), eq(s.zones.active, true))).all())
          .map((z) => ({ id: z.id, lat: z.lat, lng: z.lng, radiusM: z.radiusM }));
      }
      return (await db.select().from(s.zones)
        .where(and(eq(s.zones.tenantId, tenantId), eq(s.zones.active, true), inArray(s.zones.id, links.map((l) => l.zoneId)))).all())
        .map((z) => ({ id: z.id, lat: z.lat, lng: z.lng, radiusM: z.radiusM }));
    },
    async lastPunch(tenantId: string, employeeId: string) {
      return (await db.select().from(s.punches)
        .where(and(eq(s.punches.tenantId, tenantId), eq(s.punches.employeeId, employeeId)))
        .orderBy(desc(s.punches.serverTs)).limit(1).get()) ?? null;
    },
    async findPunchByIdem(tenantId: string, key: string) {
      return (await db.select().from(s.punches)
        .where(and(eq(s.punches.tenantId, tenantId), eq(s.punches.idempotencyKey, key))).get()) ?? null;
    },
    async insertPunch(tenantId: string, p: Omit<typeof s.punches.$inferInsert, 'id' | 'tenantId'>) {
      const row = { ...p, id: crypto.randomUUID(), tenantId };
      await db.insert(s.punches).values(row);
      return row;
    },
  };
}
export type Repo = ReturnType<typeof makeRepo>;
```

- [ ] **Step 3: Rutas** — `routes/auth.ts`, `routes/admin.ts` y montaje en `index.ts`

`routes/auth.ts`:
```ts
import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../env';
import { makeRepo } from '../db/repo';
import { verifyInitData } from '../auth/telegram';
import { signJwt } from '../auth/jwt';

export const authRoutes = new Hono<{ Bindings: Env }>();

authRoutes.post('/auth/telegram', async (c) => {
  const body = z.object({ initData: z.string() }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'bad_request' }, 400);
  const now = Math.floor(Date.now() / 1000);
  const v = await verifyInitData(body.data.initData, c.env.BOT_TOKEN, now);
  if (!v.ok) return c.json({ error: v.reason }, 401);
  const emp = await makeRepo(c.env.DB).findEmployeeByTelegram(v.userId);
  if (!emp) return c.json({ error: 'not_linked' }, 403);
  const token = await signJwt({ tid: emp.tenantId, eid: emp.id, role: emp.role }, c.env.JWT_SECRET, 900, now);
  return c.json({ token });
});
```
`routes/admin.ts`:
```ts
import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../env';
import { makeRepo } from '../db/repo';
import { sha256Hex } from '../auth/apikey';

type Vars = { tenantId: string };
export const adminRoutes = new Hono<{ Bindings: Env; Variables: Vars }>();

adminRoutes.use('*', async (c, next) => {
  const m = /^Bearer (.+)$/.exec(c.req.header('authorization') ?? '');
  if (!m) return c.json({ error: 'unauthorized' }, 401);
  const key = await makeRepo(c.env.DB).findApiKey(await sha256Hex(m[1]!));
  if (!key || !key.scopes.includes('admin')) return c.json({ error: 'unauthorized' }, 401);
  c.set('tenantId', key.tenantId);
  await next();
});

adminRoutes.post('/employees', async (c) => {
  const b = z.object({ number: z.string(), name: z.string(), geofenceOn: z.boolean().optional(), telegramUserId: z.number().int().optional() })
    .safeParse(await c.req.json().catch(() => null));
  if (!b.success) return c.json({ error: 'bad_request' }, 400);
  return c.json({ id: await makeRepo(c.env.DB).createEmployee(c.get('tenantId'), b.data) }, 201);
});

adminRoutes.post('/zones', async (c) => {
  const b = z.object({ name: z.string(), lat: z.number(), lng: z.number(), radiusM: z.number().int().positive() })
    .safeParse(await c.req.json().catch(() => null));
  if (!b.success) return c.json({ error: 'bad_request' }, 400);
  return c.json({ id: await makeRepo(c.env.DB).createZone(c.get('tenantId'), b.data) }, 201);
});

adminRoutes.post('/employees/:id/zones/:zoneId', async (c) => {
  await makeRepo(c.env.DB).assignZone(c.get('tenantId'), c.req.param('id'), c.req.param('zoneId'));
  return c.json({ ok: true }, 201);
});
```
`index.ts` (modificar): después de `/health` añadir
```ts
import { authRoutes } from './routes/auth';
import { adminRoutes } from './routes/admin';
app.route('/v1', authRoutes);
app.route('/v1', adminRoutes);
```
(`adminRoutes.use('*')` se limita a su propio subárbol porque se monta tras `authRoutes`; si el middleware interfiere con `/v1/auth/telegram`, montar `adminRoutes` en `/v1/admin-scope` equivalente y ajustar las URLs de los tests de forma consistente.)

- [ ] **Step 4: Verificar y commit**

Run: `pnpm --filter @attendance/api test` → PASS.
```bash
git add -A && git commit -m "feat(api): repo con tenantId, auth de Telegram y endpoints admin por API key"
```

---

### Task 8: Subida de foto a R2 y `POST /v1/punches`

**Files:**
- Create: `apps/api/src/routes/photo.ts`, `apps/api/src/routes/punches.ts`, `apps/api/src/auth/middleware.ts`, `apps/api/test/punches.test.ts`
- Modify: `apps/api/src/index.ts`

**Interfaces:** Consumes: `makeRepo`, `isAllowed`, `findZone`, `computeFlags`, `verifyJwt`, `PunchInput`. Produces:
- `jwtAuth` middleware Hono que pone `tenantId`, `employeeId`, `role` en el contexto (desde `Authorization: Bearer <jwt>`).
- `PUT /v1/punches/photo` (body `image/jpeg`, ≤ 500 KB) → `{ photoKey, photoSha256 }`. Clave `t/<tid>/<eid>/<YYYY-MM-DD>/<uuid>.jpg`; guarda `sha256` en `customMetadata`. *(Desviación del spec §6: subida por el Worker en vez de URL prefirmada; las fotos pesan ~150 KB y así no se necesitan credenciales S3 de R2.)*
- `POST /v1/punches` (header `Idempotency-Key` obligatorio) → 201 `{ id, serverTs, type, flags, zoneId }`; 200 con el mismo cuerpo si la clave ya existe; 400/403/409/422 según el caso.

- [ ] **Step 1: Test que falla** — `test/punches.test.ts`

```ts
import { SELF, env } from 'cloudflare:test';
import { describe, test, expect } from 'vitest';
import { seedTenant, seedApiKey, jwtFor } from './helpers';

const CDMX = { lat: 19.4326, lng: -99.1332 };

async function setup(tid: string, geofenceOn = false) {
  await seedTenant(tid);
  const key = await seedApiKey(tid, 'admin');
  const h = { 'content-type': 'application/json', authorization: `Bearer ${key}` };
  const e = await (await SELF.fetch('http://x/v1/employees', { method: 'POST', headers: h, body: JSON.stringify({ number: '1', name: 'Ana', geofenceOn }) })).json() as { id: string };
  const z = await (await SELF.fetch('http://x/v1/zones', { method: 'POST', headers: h, body: JSON.stringify({ name: 'Oficina', ...CDMX, radiusM: 100 }) })).json() as { id: string };
  return { eid: e.id, zid: z.id, token: await jwtFor(tid, e.id) };
}
const punch = (token: string, eid: string, type: string, idem: string, over: Record<string, unknown> = {}) =>
  SELF.fetch('http://x/v1/punches', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'idempotency-key': idem },
    body: JSON.stringify({ employeeId: eid, type, ...CDMX, accuracy: 10, source: 'tg_miniapp', ...over }),
  });

describe('POST /v1/punches', () => {
  test('sin Idempotency-Key → 400', async () => {
    const { eid, token } = await setup('p1');
    const r = await SELF.fetch('http://x/v1/punches', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ employeeId: eid, type: 'in', ...CDMX, accuracy: 5, source: 'web' }) });
    expect(r.status).toBe(400);
  });
  test('entrada válida → 201 con serverTs del servidor', async () => {
    const { eid, token } = await setup('p2');
    const before = Date.now();
    const r = await punch(token, eid, 'in', 'k1', { clientTs: 1 });
    expect(r.status).toBe(201);
    const b = await r.json() as { serverTs: number };
    expect(b.serverTs).toBeGreaterThanOrEqual(before);
  });
  test('misma Idempotency-Key no duplica', async () => {
    const { eid, token } = await setup('p3');
    const a = await punch(token, eid, 'in', 'same');
    const b = await punch(token, eid, 'in', 'same');
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect((await a.json() as { id: string }).id).toBe((await b.json() as { id: string }).id);
  });
  test('salida sin entrada previa → 409', async () => {
    const { eid, token } = await setup('p4');
    expect((await punch(token, eid, 'out', 'k')).status).toBe(409);
  });
  test('geofence activo y fuera de zona → 422 outside_zone', async () => {
    const { eid, token } = await setup('p5', true);
    const r = await punch(token, eid, 'in', 'k', { lat: 20.5, lng: -100 });
    expect(r.status).toBe(422);
    expect((await r.json() as { error: string }).error).toBe('outside_zone');
  });
  test('geofence activo y dentro de zona → 201 con zoneId', async () => {
    const { eid, token, zid } = await setup('p6', true);
    const r = await punch(token, eid, 'in', 'k');
    expect(r.status).toBe(201);
    expect((await r.json() as { zoneId: string }).zoneId).toBe(zid);
  });
  test('precisión baja registra el flag sin rechazar', async () => {
    const { eid, token } = await setup('p7');
    const r = await punch(token, eid, 'in', 'k', { accuracy: 300 });
    expect(r.status).toBe(201);
    expect((await r.json() as { flags: string[] }).flags).toContain('low_accuracy');
  });
  test('AISLAMIENTO: JWT del tenant A no puede registrar para un empleado del tenant B', async () => {
    const a = await setup('isoA');
    const b = await setup('isoB');
    const r = await punch(a.token, b.eid, 'in', 'k');
    expect(r.status).toBe(404);
    const rows = await env.DB.prepare('select count(*) n from punches where employee_id=?').bind(b.eid).first<{ n: number }>();
    expect(rows?.n).toBe(0);
  });
  test('un empleado con rol employee no puede registrar por otro empleado de su mismo tenant', async () => {
    const a = await setup('same1');
    const key = await seedApiKey('same1', 'admin');
    const other = await (await SELF.fetch('http://x/v1/employees', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify({ number: '2', name: 'Otro' }) })).json() as { id: string };
    expect((await punch(a.token, other.id, 'in', 'k')).status).toBe(403);
  });
});

describe('PUT /v1/punches/photo', () => {
  test('guarda en R2 bajo el prefijo del tenant/empleado y devuelve sha256', async () => {
    const { eid, token } = await setup('ph1');
    const bytes = new Uint8Array([0xff, 0xd8, 1, 2, 3]);
    const r = await SELF.fetch('http://x/v1/punches/photo', { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'image/jpeg' }, body: bytes });
    expect(r.status).toBe(201);
    const { photoKey, photoSha256 } = await r.json() as { photoKey: string; photoSha256: string };
    expect(photoKey.startsWith(`t/ph1/${eid}/`)).toBe(true);
    expect(photoSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(await env.PHOTOS.head(photoKey)).not.toBeNull();
  });
  test('rechaza > 500 KB con 413', async () => {
    const { token } = await setup('ph2');
    const r = await SELF.fetch('http://x/v1/punches/photo', { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'image/jpeg' }, body: new Uint8Array(500_001) });
    expect(r.status).toBe(413);
  });
  test('POST /punches rechaza photoKey de otro tenant/empleado (stamp_mismatch no aplica: 422 bad_photo)', async () => {
    const a = await setup('ph3a'); const b = await setup('ph3b');
    const up = await SELF.fetch('http://x/v1/punches/photo', { method: 'PUT', headers: { authorization: `Bearer ${b.token}`, 'content-type': 'image/jpeg' }, body: new Uint8Array([1, 2, 3]) });
    const { photoKey, photoSha256 } = await up.json() as { photoKey: string; photoSha256: string };
    const r = await punch(a.token, a.eid, 'in', 'k', { photoKey, photoSha256 });
    expect(r.status).toBe(422);
  });
});
```
Run → FAIL.

- [ ] **Step 2: Implementar**

`auth/middleware.ts`:
```ts
import type { MiddlewareHandler } from 'hono';
import type { Env } from '../env';
import { verifyJwt } from './jwt';

export type JwtVars = { tenantId: string; employeeId: string; role: 'admin' | 'employee' };

export const jwtAuth: MiddlewareHandler<{ Bindings: Env; Variables: JwtVars }> = async (c, next) => {
  const m = /^Bearer (.+)$/.exec(c.req.header('authorization') ?? '');
  const claims = m ? await verifyJwt(m[1]!, c.env.JWT_SECRET, Math.floor(Date.now() / 1000)) : null;
  if (!claims) return c.json({ error: 'unauthorized' }, 401);
  c.set('tenantId', claims.tid);
  c.set('employeeId', claims.eid);
  c.set('role', claims.role);
  await next();
};
```
`routes/photo.ts`:
```ts
import { Hono } from 'hono';
import type { Env } from '../env';
import { jwtAuth, type JwtVars } from '../auth/middleware';

const MAX_BYTES = 500_000;
export const photoRoutes = new Hono<{ Bindings: Env; Variables: JwtVars }>();

photoRoutes.put('/punches/photo', jwtAuth, async (c) => {
  const buf = await c.req.arrayBuffer();
  if (buf.byteLength === 0) return c.json({ error: 'empty' }, 400);
  if (buf.byteLength > MAX_BYTES) return c.json({ error: 'too_large' }, 413);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  const sha = [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
  const day = new Date().toISOString().slice(0, 10);
  const key = `t/${c.get('tenantId')}/${c.get('employeeId')}/${day}/${crypto.randomUUID()}.jpg`;
  await c.env.PHOTOS.put(key, buf, { httpMetadata: { contentType: 'image/jpeg' }, customMetadata: { sha256: sha } });
  return c.json({ photoKey: key, photoSha256: sha }, 201);
});
```
`routes/punches.ts`:
```ts
import { Hono } from 'hono';
import type { Env } from '../env';
import { PunchInput } from '@attendance/shared';
import { jwtAuth, type JwtVars } from '../auth/middleware';
import { makeRepo } from '../db/repo';
import { isAllowed } from '../domain/state';
import { findZone } from '../domain/geofence';
import { computeFlags } from '../domain/flags';

export const punchRoutes = new Hono<{ Bindings: Env; Variables: JwtVars }>();

const view = (p: { id: string; serverTs: number; type: string; flags: string; zoneId: string | null }) =>
  ({ id: p.id, serverTs: p.serverTs, type: p.type, flags: JSON.parse(p.flags) as string[], zoneId: p.zoneId });

punchRoutes.post('/punches', jwtAuth, async (c) => {
  const idem = c.req.header('idempotency-key');
  if (!idem) return c.json({ error: 'idempotency_key_required' }, 400);
  const parsed = PunchInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad_request' }, 400);
  const input = parsed.data;
  const tid = c.get('tenantId');
  const repo = makeRepo(c.env.DB);

  const existing = await repo.findPunchByIdem(tid, idem);
  if (existing) return c.json(view(existing), 200);

  if (input.employeeId !== c.get('employeeId') && c.get('role') !== 'admin') return c.json({ error: 'forbidden' }, 403);
  const emp = await repo.getEmployee(tid, input.employeeId);
  if (!emp) return c.json({ error: 'not_found' }, 404);

  if (input.photoKey) {
    const prefix = `t/${tid}/${emp.id}/`;
    const head = input.photoKey.startsWith(prefix) ? await c.env.PHOTOS.head(input.photoKey) : null;
    if (!head || head.customMetadata?.sha256 !== input.photoSha256) return c.json({ error: 'bad_photo' }, 422);
  }

  const last = await repo.lastPunch(tid, emp.id);
  if (!isAllowed(last?.type ?? null, input.type)) return c.json({ error: 'invalid_transition' }, 409);

  const point = { lat: input.lat, lng: input.lng };
  const zones = await repo.zonesForEmployee(tid, emp.id);
  const zone = findZone(point, zones);
  if (emp.geofenceOn && !zone) return c.json({ error: 'outside_zone' }, 422);

  const now = Date.now();
  const flags = computeFlags({
    accuracy: input.accuracy, point, nowMs: now,
    prev: last ? { point: { lat: last.lat, lng: last.lng }, tsMs: last.serverTs } : undefined,
  });

  const row = await repo.insertPunch(tid, {
    employeeId: emp.id, type: input.type, serverTs: now,
    lat: input.lat, lng: input.lng, accuracy: input.accuracy, zoneId: zone?.id ?? null,
    photoKey: input.photoKey ?? null, photoSha256: input.photoSha256 ?? null,
    source: input.source, flags: JSON.stringify(flags), idempotencyKey: idem,
  });
  return c.json(view({ ...row, zoneId: row.zoneId ?? null }), 201);
});
```
`index.ts`: añadir `app.route('/v1', photoRoutes); app.route('/v1', punchRoutes);` **antes** de montar `adminRoutes` (para que el middleware de API key del admin no capture estas rutas); si Hono aplica el `use('*')` de admin a todo `/v1`, mover las rutas admin bajo `/v1/admin` y ajustar `admin-auth.test.ts` en consecuencia en el mismo commit.

- [ ] **Step 3: Verificar y commit**

Run: `pnpm --filter @attendance/api test` → PASS (todos, incluido aislamiento entre tenants).
```bash
git add -A && git commit -m "feat(api): subida de foto a R2 y POST /v1/punches con geofence, estados, flags e idempotencia"
```

---

### Task 9: MiniApp de registro (`apps/web`)

**Files:**
- Create: `apps/web/package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.tsx`, `src/lib/telegram.ts`, `src/lib/api.ts`, `src/CheckIn.tsx`, `src/lib/api.test.ts`

**Interfaces:** Consumes: `drawOverlay`/`OverlayData` de `@attendance/evidence-camera`, `PunchTypeT` de `@attendance/shared`, endpoints `/v1/auth/telegram`, `/v1/punches/photo`, `/v1/punches`. Produces: `createApi(base, fetchImpl?)` con `{ login(initData), uploadPhoto(token, blob), punch(token, input, idemKey) }`.

- [ ] **Step 1: Dependencias**

```bash
cd apps/web && pnpm init >/dev/null
pnpm add react react-dom @attendance/shared@workspace:* @attendance/evidence-camera@workspace:*
pnpm add -D vite @vitejs/plugin-react typescript vitest @types/react @types/react-dom
```
Scripts: `dev: vite`, `build: tsc --noEmit && vite build`, `test: vitest run`, `typecheck: tsc --noEmit`. `.env.example`: `VITE_API_BASE_URL=http://127.0.0.1:8787`.

- [ ] **Step 2: Test del cliente API (falla primero)** — `src/lib/api.test.ts`

```ts
import { test, expect, vi } from 'vitest';
import { createApi } from './api';

test('punch envía Idempotency-Key y Bearer', async () => {
  const f = vi.fn(async () => new Response(JSON.stringify({ id: 'p1' }), { status: 201 }));
  const api = createApi('http://api', f as unknown as typeof fetch);
  await api.punch('tok', { employeeId: 'e', type: 'in', lat: 1, lng: 2, accuracy: 3, source: 'tg_miniapp' }, 'idem-1');
  const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe('http://api/v1/punches');
  expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe('idem-1');
  expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
});

test('errores de la API se propagan con su código', async () => {
  const f = vi.fn(async () => new Response(JSON.stringify({ error: 'outside_zone' }), { status: 422 }));
  const api = createApi('http://api', f as unknown as typeof fetch);
  await expect(api.punch('t', { employeeId: 'e', type: 'in', lat: 1, lng: 2, accuracy: 3, source: 'tg_miniapp' }, 'k')).rejects.toThrow('outside_zone');
});
```
Run → FAIL.

- [ ] **Step 3: Implementar `lib/api.ts` y `lib/telegram.ts`**

```ts
// src/lib/api.ts
import type { PunchInputT } from '@attendance/shared';

async function parse(r: Response) {
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((body as { error?: string }).error ?? `http_${r.status}`);
  return body;
}

export function createApi(base: string, f: typeof fetch = fetch) {
  return {
    async login(initData: string): Promise<{ token: string }> {
      return parse(await f(`${base}/v1/auth/telegram`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ initData }) }));
    },
    async uploadPhoto(token: string, blob: Blob): Promise<{ photoKey: string; photoSha256: string }> {
      return parse(await f(`${base}/v1/punches/photo`, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'content-type': 'image/jpeg' }, body: blob }));
    },
    async punch(token: string, input: PunchInputT, idemKey: string) {
      return parse(await f(`${base}/v1/punches`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json', 'Idempotency-Key': idemKey }, body: JSON.stringify(input) }));
    },
  };
}
```
```ts
// src/lib/telegram.ts
declare global { interface Window { Telegram?: { WebApp: { initData: string; ready(): void; expand(): void } } } }
export function initTelegram(): string {
  const wa = window.Telegram?.WebApp;
  wa?.ready(); wa?.expand();
  return wa?.initData ?? '';
}
```
`index.html`: `<script src="https://telegram.org/js/telegram-web-app.js"></script>` antes del script de `main.tsx`, `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`.

- [ ] **Step 4: `CheckIn.tsx`** — pantalla única, mobile-first: video de cámara trasera/frontal, 4 botones grandes (Entrada, Salida, Pausa, Fin pausa), estado y errores en texto claro.

```tsx
import { useEffect, useRef, useState } from 'react';
import { drawOverlay } from '@attendance/evidence-camera';
import type { PunchTypeT } from '@attendance/shared';
import { createApi } from './lib/api';
import { initTelegram } from './lib/telegram';

const api = createApi(import.meta.env.VITE_API_BASE_URL);
const LABEL: Record<PunchTypeT, string> = { in: 'ENTRADA', out: 'SALIDA', break_start: 'INICIO DE PAUSA', break_end: 'FIN DE PAUSA' };
const ERR: Record<string, string> = {
  outside_zone: 'Estás fuera de tu zona de trabajo.', invalid_transition: 'Ese registro no corresponde ahora.',
  not_linked: 'Tu cuenta de Telegram no está vinculada. Pide tu código al administrador.',
};

function getPosition(): Promise<GeolocationPosition> {
  return new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 15000 }));
}

export function CheckIn() {
  const video = useRef<HTMLVideoElement>(null);
  const [token, setToken] = useState<string>();
  const [employee, setEmployee] = useState<{ id: string; name: string }>();
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { token, employee } = await api.login(initTelegram()) as { token: string; employee?: { id: string; name: string } };
        setToken(token); setEmployee(employee);
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
        if (video.current) video.current.srcObject = stream;
      } catch (e) { setMsg(ERR[(e as Error).message] ?? 'No se pudo iniciar. Revisa permisos de cámara y ubicación.'); }
    })();
  }, []);

  async function register(type: PunchTypeT) {
    if (!token || !employee || !video.current) return;
    setBusy(true); setMsg('');
    try {
      const pos = await getPosition();
      const v = video.current;
      const canvas = document.createElement('canvas');
      canvas.width = v.videoWidth; canvas.height = v.videoHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(v, 0, 0);
      drawOverlay(ctx, canvas.width, canvas.height, {
        timestamp: new Date().toISOString(),
        lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy,
        extraLines: [employee.name, LABEL[type]],
      });
      const blob: Blob = await new Promise((r) => canvas.toBlob((b) => r(b!), 'image/jpeg', 0.8));
      const { photoKey, photoSha256 } = await api.uploadPhoto(token, blob);
      await api.punch(token, {
        employeeId: employee.id, type, lat: pos.coords.latitude, lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy, photoKey, photoSha256, source: 'tg_miniapp',
      }, crypto.randomUUID());
      setMsg(`✓ ${LABEL[type]} registrada`);
    } catch (e) { setMsg(ERR[(e as Error).message] ?? 'No se pudo registrar. Intenta de nuevo.'); }
    finally { setBusy(false); }
  }

  return (
    <main style={{ padding: 16, display: 'grid', gap: 12 }}>
      <video ref={video} autoPlay playsInline muted style={{ width: '100%', borderRadius: 12, background: '#000' }} />
      <p aria-live="polite">{msg}</p>
      {(['in', 'out', 'break_start', 'break_end'] as PunchTypeT[]).map((t) => (
        <button key={t} disabled={busy || !token} onClick={() => register(t)} style={{ padding: 18, fontSize: 18, borderRadius: 12 }}>{LABEL[t]}</button>
      ))}
    </main>
  );
}
```
Para que `login` devuelva `employee`, **modificar `routes/auth.ts`** (Tarea 7) para responder `{ token, employee: { id, name } }` leyendo el nombre con `repo.getEmployee(emp.tenantId, emp.id)`, y añadir el aserto correspondiente en `admin-auth.test.ts`. `main.tsx`: `createRoot(document.getElementById('root')!).render(<CheckIn />)`.

- [ ] **Step 5: Verificar y commit**

Run: `pnpm --filter @attendance/web test && pnpm --filter @attendance/web typecheck && pnpm --filter @attendance/api test` → todo PASS.
```bash
git add -A && git commit -m "feat(web): MiniApp de registro con cámara, GPS y foto sellada"
```

---

### Task 10: Despliegue a qa y checklist manual en dispositivo

**Files:**
- Create: `apps/api/scripts/create-tenant.mjs`, `docs/checklist-fase-1.md`, `.github/workflows/deploy-qa.yml`

- [ ] **Step 1: Script de alta de tenant**

`create-tenant.mjs` genera `tenantId`, una API key `ak_…` y su hash SHA-256 e imprime el SQL (`insert into tenants … ; insert into api_keys …`) para `wrangler d1 execute attendance-qa --remote --command "<sql>"`. La clave en claro se imprime una sola vez.

- [ ] **Step 2: Recursos de qa**

```bash
cd apps/api
npx wrangler d1 create attendance-qa      # copiar database_id a wrangler.toml [env.qa]
npx wrangler r2 bucket create attendance-photos-qa
npx wrangler secret put JWT_SECRET --env qa
npx wrangler secret put BOT_TOKEN --env qa
npx wrangler d1 migrations apply attendance-qa --remote
npx wrangler deploy --env qa
```
Crear el bot con @BotFather, apuntar su Menu Button / Web App a la URL de Pages de `apps/web` (`pnpm --filter @attendance/web build` + `npx wrangler pages deploy apps/web/dist`).

- [ ] **Step 3: Workflow de despliegue**

`.github/workflows/deploy-qa.yml`: en push a `develop`, job que instala, corre tests, aplica migraciones D1 remotas y luego `wrangler deploy --env qa`, con `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID` como secretos del repo.

- [ ] **Step 4: Checklist manual** — `docs/checklist-fase-1.md` (ejecutar en un celular real, dentro de Telegram, y marcar cada punto)

```
- [ ] La MiniApp abre desde el menú del bot y muestra la cámara frontal
- [ ] Permiso de ubicación solicitado y concedido; con permiso negado aparece mensaje claro
- [ ] ENTRADA dentro de la zona → "✓ ENTRADA registrada"
- [ ] La foto en R2 trae el sello: fecha/hora, lat/lng con precisión, nombre del empleado, tipo y logotipo
- [ ] SALIDA sin pausa pendiente → registrada; SALIDA repetida → "Ese registro no corresponde ahora"
- [ ] Con geofence activo y fuera de zona → "Estás fuera de tu zona de trabajo"
- [ ] Doble toque rápido al botón no crea dos registros
- [ ] Cuenta no vinculada → mensaje de vinculación
- [ ] Android e iOS probados (anotar modelos y versión de Telegram)
```

- [ ] **Step 5: Commit y PR**

```bash
git add -A && git commit -m "chore: despliegue qa, script de alta de tenant y checklist de Fase 1"
git push -u origin feat/fase-0-1   # requiere remoto configurado; abrir PR hacia develop
```
Criterio de cierre de Fase 1: tests en verde en CI y checklist completo en un dispositivo real.

---

## Self-Review

**Cobertura del spec (Fases 0–1):** monorepo y CI (T1), contrato Zod (T2), `evidence-camera` con logotipo y líneas extra (T3), esquema D1 y Miniflare (T4), geofence/estados/flags `low_accuracy`/`teleport`/`static_coords` (T5), `initData`/JWT/API key (T6), aislamiento por `tenantId` y alta de tenant/empleado/zona (T7, T8), foto en R2 con sha256 e idempotencia (T8), MiniApp con foto quemada (T9), qa y checklist en dispositivo (T10). `stamp_mismatch` y la comprobación servidor-vs-sello quedan para la Fase 3 (el flag está en el contrato pero aún no se calcula); el bot, panel admin, vinculación por código y webhooks son Fases 2–4 y tendrán su propio plan.

**Desviaciones deliberadas del spec:** subida de foto por el Worker en vez de URL prefirmada (T8); alta inicial de tenant por script SQL en vez de panel (T10).

**Consistencia de tipos:** `PunchTypeT`/`PunchInputT`/`FlagT` (T2) se usan igual en T5, T8 y T9; `makeRepo` define las firmas usadas en T7–T8; `Claims {tid, eid, role}` coincide entre `signJwt`, `verifyJwt` y `jwtAuth`; `drawOverlay(ctx, w, h, data, logo?)` es idéntico en T3 y T9. El logotipo del tenant aún no se carga en la MiniApp (T9 no pasa `logo`); se añade en la Fase 2 junto con la configuración del tenant.
