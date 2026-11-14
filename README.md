# attendance-core

Núcleo compartido de asistencia por rostro. Lo usan Agrovid y un producto de asistencia para cualquier negocio.

**Estado:** fase F1 (ver `docs/superpowers/specs/2026-11-14-nucleo-compartido-limites-y-puertos-design.md`, sección 13).

## Qué hay

| Ruta | Qué es |
|---|---|
| `packages/domain` | `@kgamboa/attendance-domain`: modelo y lógica pura (decisión de coincidencia, lista y faltantes, rotación, geocerca, reporte, sello de foto, importación). Sin nube ni framework |
| `docs/superpowers/specs` | Diseños: límites y puertos, benchmark de la competencia |

## Reglas

- **El núcleo no depende de nada de afuera.** Solo importa archivos propios y `jpeg-js`, no lee variables de entorno y no menciona servicios de nube. Lo vigila `src/architecture.test.ts`.
- **Vocabulario genérico:** sitio (`siteId`, `areaId`) y grupo (`groupId`). Cada aplicación traduce al suyo en su adaptador.
- **Los datos no se migran:** los nombres de las bases de datos de cada aplicación no cambian.

## Comandos

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

Requiere Node 22 y pnpm 10.

## Publicar una versión

1. Subir la versión en `packages/domain/package.json`.
2. Crear y subir la etiqueta `domain-v<versión>` (por ejemplo `domain-v0.1.0`).
3. El flujo `publish-domain` revisa que la etiqueta coincida con la versión, corre las pruebas y publica en GitHub Packages.

Para instalar el paquete en otro proyecto hace falta un token con permiso `read:packages` y que el paquete dé acceso a ese repositorio.
