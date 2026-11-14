import { detectColumns, parseEmployeeRows, planImport } from './import-employees';

describe('parseEmployeeRows', () => {
  test('reconoce encabezados por sinónimos y valida nombres', () => {
    const r = parseEmployeeRows([
      ['No. Empleado', 'Trabajador', 'Cuadrilla'],
      ['101', 'Ana López', 'Hermes'],
      ['102', 'Beto', 'Hermes'],
      ['', '', ''],
      ['103', 'Ana López', 'Hermes'],
      ['104', 'Carla Soto Ruiz', ''],
    ]);
    // Dos personas con el mismo nombre y distinto número de empleado son personas distintas.
    expect(r.rows.map((x) => x.name)).toEqual(['Ana López', 'Ana López', 'Carla Soto Ruiz']);
    expect(r.rows[0]).toMatchObject({ employeeNumber: '101', groupName: 'Hermes', row: 2 });
    expect(r.errors.map((e) => e.row)).toEqual([3]);
  });

  test('"Repetido" se detecta por número de empleado', () => {
    const r = parseEmployeeRows([['Nombre', 'Clave'], ['Ana López', '1'], ['Ana López Diaz', '1']]);
    expect(r.rows).toHaveLength(1);
    expect(r.errors[0].message).toMatch(/Repetido/);
  });

  test('sin columna de nombre falla con un mensaje claro y permite indicarla a mano', () => {
    const bad = parseEmployeeRows([['A', 'B'], ['x y', 'z']]);
    expect(bad.errors[0].message).toMatch(/columna del nombre/);
    const ok = parseEmployeeRows([['A', 'B'], ['x', 'Pedro Gil']], { name: 1 });
    expect(ok.rows[0].name).toBe('Pedro Gil');
  });

  test('detectColumns ignora acentos, mayúsculas y puntos', () => {
    expect(detectColumns(['NÚMERO', 'Nombre Completo', 'Cuadrilla'])).toEqual({ employeeNumber: 0, name: 1, group: 2 });
  });
});

describe('planImport', () => {
  const rows = [
    { row: 2, name: 'Ana López', employeeNumber: '1', groupName: 'Hermes' },
    { row: 3, name: 'Beto Ruiz', groupName: 'Inexistente' },
    { row: 4, name: 'Carla Soto' },
  ];
  test('omite existentes, asigna cuadrilla por nombre o alias y avisa de las que no existen', () => {
    const plan = planImport(rows, [{ employeeId: 'e', nameNormalized: 'carla soto' }],
      [{ groupId: 'c1', name: 'Cuadrilla Hermes', aliases: ['Hermes'] }]);
    expect(plan.skipExisting.map((r) => r.name)).toEqual(['Carla Soto']);
    expect(plan.create.find((r) => r.name === 'Ana López')!.groupId).toBe('c1');
    expect(plan.create.find((r) => r.name === 'Beto Ruiz')!.groupId).toBeUndefined();
    expect(plan.warnings).toHaveLength(1);
  });
});

describe('encabezados y mensajes de grupo', () => {
  test('reconoce la columna "Cuadrilla" aunque el núcleo la llame grupo', () => {
    const r = parseEmployeeRows([['Nombre', 'Cuadrilla'], ['Ana López', 'Hermes']]);
    expect(r.rows[0].groupName).toBe('Hermes');
  });

  test('reconoce también "Equipo" y "Grupo"', () => {
    expect(detectColumns(['Nombre', 'Equipo'])).toEqual({ name: 0, group: 1 });
    expect(detectColumns(['Nombre', 'Grupo'])).toEqual({ name: 0, group: 1 });
  });

  test('la advertencia usa la palabra que la aplicación indique', () => {
    const rows = [{ row: 2, name: 'Beto Ruiz', groupName: 'Inexistente' }];
    const dflt = planImport(rows, [], []);
    expect(dflt.warnings[0].message).toBe('Grupo "Inexistente" no existe; se importa sin grupo');
    const crew = planImport(rows, [], [], { groupLabel: 'cuadrilla' });
    expect(crew.warnings[0].message).toBe('Cuadrilla "Inexistente" no existe; se importa sin cuadrilla');
  });
});
