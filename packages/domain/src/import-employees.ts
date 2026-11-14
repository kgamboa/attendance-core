/**
 * attendance-import.service.ts — Importar el padrón de personal desde una hoja de cálculo.
 *
 * Diseñado con adaptadores: hoy `parseEmployeeRows` recibe filas ya leídas (Excel vía exceljs en
 * el handler). Otro origen (CSV, Google Sheets, una API) solo necesita producir las mismas filas.
 * Los encabezados se reconocen por sinónimos; `columnMap` permite indicar columnas a mano
 * cuando el archivo de RH usa otros nombres.
 */
import { normalizeName } from './model';

export type EmployeeField = 'name' | 'employeeNumber' | 'group' | 'externalId';

const SYNONYMS: Record<EmployeeField, string[]> = {
  name: ['nombre', 'nombre completo', 'empleado', 'trabajador', 'name', 'full name', 'employee'],
  employeeNumber: ['numero', 'numero de empleado', 'no empleado', 'no. empleado', 'num empleado', 'clave', 'employee number', 'id empleado'],
  group: ['cuadrilla', 'equipo', 'grupo', 'crew', 'team'],
  externalId: ['id externo', 'external id', 'curp', 'rfc', 'nss', 'imss'],
};

export type ColumnMap = Partial<Record<EmployeeField, number>>;

export interface ParsedRow {
  row: number;
  name: string;
  employeeNumber?: string;
  groupName?: string;
  externalId?: string;
}
export interface ImportIssue { row: number; message: string }
export interface ParseResult { rows: ParsedRow[]; errors: ImportIssue[]; columnMap: ColumnMap }

const clean = (v: unknown) => (v === undefined || v === null ? '' : String(v).trim());

export function detectColumns(header: unknown[]): ColumnMap {
  const map: ColumnMap = {};
  header.forEach((cell, i) => {
    const h = normalizeName(clean(cell)).replace(/\./g, '');
    for (const field of Object.keys(SYNONYMS) as EmployeeField[]) {
      if (map[field] === undefined && SYNONYMS[field].some((s) => normalizeName(s).replace(/\./g, '') === h)) map[field] = i;
    }
  });
  return map;
}

/** `matrix[0]` es el encabezado. Fila 1 del archivo = encabezado; los datos empiezan en la 2. */
export function parseEmployeeRows(matrix: unknown[][], override?: ColumnMap): ParseResult {
  const errors: ImportIssue[] = [];
  if (!matrix.length) return { rows: [], errors: [{ row: 1, message: 'El archivo está vacío' }], columnMap: {} };
  const columnMap = { ...detectColumns(matrix[0]), ...override };
  if (columnMap.name === undefined) {
    return { rows: [], errors: [{ row: 1, message: 'No se encontró la columna del nombre (Nombre, Empleado o Trabajador)' }], columnMap };
  }

  const rows: ParsedRow[] = [];
  const seen = new Set<string>();
  for (let i = 1; i < matrix.length; i++) {
    const line = matrix[i];
    const rowNo = i + 1;
    const name = clean(line[columnMap.name]);
    if (!name && line.every((c) => !clean(c))) continue; // fila vacía
    if (name.split(/\s+/).length < 2) { errors.push({ row: rowNo, message: `Nombre incompleto: "${name}" (se necesita nombre y apellido)` }); continue; }
    const get = (f: EmployeeField) => (columnMap[f] === undefined ? undefined : clean(line[columnMap[f]!]) || undefined);
    const employeeNumber = get('employeeNumber');
    const externalId = get('externalId');
    const key = externalId ?? employeeNumber ?? normalizeName(name);
    if (seen.has(key)) { errors.push({ row: rowNo, message: `Repetido en el archivo: ${name}` }); continue; }
    seen.add(key);
    rows.push({ row: rowNo, name, employeeNumber, groupName: get('group'), externalId });
  }
  return { rows, errors, columnMap };
}

export interface ExistingEmployee { employeeId: string; nameNormalized: string; employeeNumber?: string; externalId?: string }
export interface GroupRef { groupId: string; name: string; aliases: string[] }

export interface ImportPlan {
  create: (ParsedRow & { groupId?: string })[];
  skipExisting: ParsedRow[];
  warnings: ImportIssue[];
}

/** Decide qué se crea y qué ya existe (por clave externa, número o nombre). */
export interface PlanImportOptions {
  /** Cómo se llama un grupo en el texto de las advertencias ("cuadrilla", "equipo", "turno"…). */
  groupLabel?: string;
}

export function planImport(rows: ParsedRow[], existing: ExistingEmployee[], groups: GroupRef[], opts: PlanImportOptions = {}): ImportPlan {
  const label = opts.groupLabel ?? 'grupo';
  const cap = label.charAt(0).toUpperCase() + label.slice(1);
  const byExternal = new Set(existing.map((e) => e.externalId).filter(Boolean));
  const byNumber = new Set(existing.map((e) => e.employeeNumber).filter(Boolean));
  const byName = new Set(existing.map((e) => e.nameNormalized));
  const groupIndex = new Map<string, string>();
  for (const c of groups) for (const n of [c.name, ...c.aliases]) groupIndex.set(normalizeName(n), c.groupId);

  const plan: ImportPlan = { create: [], skipExisting: [], warnings: [] };
  for (const r of rows) {
    // El nombre solo identifica cuando el archivo no trae número ni clave: así los homónimos no se pierden.
    const hasKey = !!(r.externalId || r.employeeNumber);
    const exists = (r.externalId && byExternal.has(r.externalId))
      || (r.employeeNumber && byNumber.has(r.employeeNumber))
      || (!hasKey && byName.has(normalizeName(r.name)));
    if (exists) { plan.skipExisting.push(r); continue; }
    let groupId: string | undefined;
    if (r.groupName) {
      groupId = groupIndex.get(normalizeName(r.groupName));
      if (!groupId) plan.warnings.push({ row: r.row, message: `${cap} "${r.groupName}" no existe; se importa sin ${label}` });
    }
    plan.create.push({ ...r, groupId });
  }
  return plan;
}
