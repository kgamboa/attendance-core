# Benchmark de WhatsTime y otros competidores de asistencia

> Fecha: 2026-11-14 · Estado: análisis, sin código
> Alcance: qué hace WhatsTime (secciones 1 a 11) y qué hacen otros cuatro competidores (sección 12), dónde son débiles y cómo construir algo mejor para **cualquier negocio**. Complementa `2026-11-14-nucleo-compartido-limites-y-puertos-design.md` (cómo se construye) con el qué y el por qué.

## 0. Método y límites

- **Fuente:** solo la página pública, su HTML (JSON-LD incluido) y su JavaScript público, descargados el 2026-11-14. No se inició sesión, no se tocó nada privado y no se copió código: aquí solo se describe lo que hace.
- **Lo que se vio** (hecho): textos, precios, rutas, bloques de datos estructurados, nombres de módulos y de funciones que el navegador invoca, y a qué servicios externos llama la página.
- **Lo que se infiere** (hipótesis): cómo funciona su servidor, qué tan bien reconoce y qué guarda. Está marcado como *inferido*.
- **Cifras de ellos** ("más de 500 empresas", 4.8 de 127 valoraciones): son afirmaciones suyas, no verificadas.
- **Cómo se leyó:** `WebFetch` no resolvía el dominio; se usó `curl` por el proxy de la sesión, tras permitir `whatstime.app` en un entorno personal nuevo ("Agrovid y attendance-core (asistencia)").

## 1. Qué es

Reloj checador en la nube para empresas pequeñas y medianas de México y Latinoamérica (Guadalajara, español y moneda local). Se vende con tres ideas: **registrar sin instalar nada** (WhatsApp), **cumplir la reforma laboral de 2026** y **conectar la asistencia con asistentes de IA**.

## 2. Inventario de funciones

| Área | Lo que ofrecen | Observación |
|---|---|---|
| Registro | WhatsApp con ubicación; reloj web con marca (número de empleado, foto y ubicación); reconocimiento facial en kiosko; app Android para empleados | WhatsApp: dos o tres mensajes por registro; el aviso al administrador solo llega si escribió al bot en las últimas 24 horas |
| Rostro | Enrolamiento por enlace enviado por correo; "prueba de vida" por parpadeo; "100 % en el navegador, solo un vector" | Ver sección 4 |
| Horarios | Por colaborador; retardos con tolerancia; turnos nocturnos | |
| Ubicación | GPS en cada registro, zonas y geocercas, mapa de registros | |
| Reportes | Dashboard, calendario, exportación a Excel, CSV y PDF, nómina con horas extra | |
| Permisos | Solicitudes de vacaciones y permisos con aprobación; "olvidos de checada" resueltos con confirmación del empleado y aprobación | |
| Cumplimiento | Informe por empleado y periodo con folio y huella SHA-256, aceptación del medio por empleado, correcciones con el valor original, conservación de registros | Palanca comercial central |
| IA | Resúmenes y tendencias (Gemini); conector MCP para ChatGPT o Claude, de solo lectura y sin fotos, ubicaciones exactas, teléfonos ni sueldos | El conector se vende aparte |
| Marketplace | 12 complementos sobre el mismo padrón: guardias y rondines, pase de lista escolar, apertura y cierre de sucursal, visitantes, bitácora de obra, entregas, acuses firmados, freelancers, cobertura por cliente, rutinas de limpieza, olvidos de checada | Va hacia plataforma operativa, no solo checador |
| Canales de panel | Web, PWA instalable en Windows y Mac, app Android con widgets | |
| Mercadotecnia | Páginas por giro (restaurantes, construcción, retail), blog, diagnóstico gratis de la reforma, PDF de "30 preguntas" para IA, preguntas frecuentes con datos estructurados | Mucho posicionamiento en buscadores |

## 3. Modelo de negocio

| Concepto | Precio |
|---|---|
| Plan base | $0 al mes, colaboradores ilimitados |
| Registro por reloj o web | $0.025 USD por registro |
| Registro por WhatsApp | $0.035 USD por registro, desde el 15 de noviembre de 2026 |
| Saldo de bienvenida | $5 USD, sin tarjeta |
| Complementos | Desde $199 MXN al mes por app |
| Conector de IA | $399 MXN al mes por empresa |

Pago por uso, sin mensualidad ni contrato. A $0.025 por registro, una persona con entrada y salida diarias cuesta cerca de $1.10 USD al mes; con WhatsApp, cerca de $1.50.

## 4. Cómo hacen el reconocimiento facial (inferido del JavaScript público)

| Pieza | Lo que se ve | Lectura |
|---|---|---|
| Modelos en el navegador | TensorFlow.js con `face-api` de vladmandic y MediaPipe Face Landmarker (de jsDelivr y de Google Storage; copias propias para la app nativa) | El teléfono calcula el vector |
| Prueba de vida | MediaPipe, y su propio texto: "detección de parpadeo para evitar fotos o videos falsos" | Solo parpadeo: un video con parpadeo puede pasarla |
| Alta | Funciones `faceEnroll` (recibe el administrador, el empleado, los vectores y una "prueba"), `faceDelete`, `sendFaceEnrollInviteEmail`, `resolveFaceEnrollToken` | Autoenrolamiento por correo; el servidor recibe vectores |
| Búsqueda | Función `faceMatch` (recibe el administrador y un vector) y un índice de enrolados en Realtime Database | **La comparación ocurre en su servidor.** El vector sí viaja a la nube |
| Datos | Cada empleado cuelga del administrador: `users/<admin>/empleados/<id>/faceEnrollment` | Modelo de una cuenta por administrador, sin empresas ni grupos como entidad aparte (inferido) |

**Contradicción en su mensaje:** la página dice "el rostro se procesa en el dispositivo; nada se sube a la nube" y a la vez la función `faceMatch` recibe el vector en la nube. La imagen no se sube, pero el vector sí. Además llama "irreversible" a un vector facial, lo cual no es seguro (hay técnicas que reconstruyen un rostro aproximado desde él) y sigue siendo dato biométrico.

## 5. Debilidades

1. **El servidor confía en el teléfono.** Recibe el vector ya calculado, con una "prueba" cuyo contenido no se vio. Un cliente modificado podría mandar un vector inventado o de otra persona.
2. **Prueba de vida débil:** parpadeo. No frena un video ni una máscara.
3. **Sin evidencia en el registro facial:** al guardar solo un vector no hay foto que respalde una disputa laboral (el reloj web con foto sí la guarda).
4. **Precisión sin medir** (inferido): los modelos de `face-api` son ligeros y suelen rendir menos que un servicio gestionado, sobre todo con sol, sombrero o poca luz.
5. **Peso y dependencia:** el módulo de rostro pesa más de 1 MB y descarga modelos desde CDN externos.
6. **WhatsApp como canal de registro:** costo creciente, ventana de 24 horas para los avisos, ubicación compartida por chat fácil de falsear, y dependencia de las reglas de Meta.
7. **Costo difícil de predecir** para el cliente (por registro).
8. **Enfoque de oficina, comercio y sucursales**: no se ve pase de lista por cuadrilla con un supervisor ni confirmaciones de rostro dudoso.
9. **Mensajes legales de venta:** "hace prueba plena" y "cumple la ley" se presentan como beneficio; ellos mismos aclaran que es orientativo y no asesoría legal.

## 6. Qué tienen que nos falta

| Función | Estado en Agrovid y el núcleo |
|---|---|
| Informe por persona y periodo con folio y huella SHA-256 | Falta (tenemos registros inmutables y hash de foto) |
| Aceptación del medio por empleado, versionada | Parcial: consentimiento firmado y versionado, no ligado a un informe |
| Correcciones con valor original | Falta |
| Permisos, vacaciones y olvidos de checada con aprobación | Falta (solo "justificado" con motivo) |
| Horarios por persona o grupo y turnos nocturnos | Falta (hay un horario por empresa) |
| Pausas y horas extra | Falta |
| Reloj web con marca para kiosko, y app para empleados | Falta (Mini App de Telegram) |
| Enrolamiento por enlace | Falta |
| Conector MCP para asistentes de IA | Falta |
| Marketplace de complementos | Fuera de alcance por ahora |
| Posicionamiento por giro y herramientas de captación | Falta (es de producto, no de código) |

## 7. Qué tenemos que ellos no (por lo visto)

- **Verificación en el servidor** con un servicio gestionado y **foto sellada** (hora del servidor, ubicación y lugar) como evidencia.
- **Geocerca que bloquea** y avisos de fuera de zona al canal de soporte.
- **Pase de lista por cuadrilla** con hasta 3 personas por foto, nombres en vivo, confirmación del supervisor y personas extra.
- **Detección de rostro duplicado** al enrolar y rotación con pre-baja.
- **Borrado biométrico con comprobante**, consentimiento firmado y retención por empresa.
- **Supervisión por Telegram** de cada responsable.
- **Cruce posible con nómina y costo por lote** (pendiente de construir).

## 8. Estrategia de diferenciación

1. **Rostro en dos capas.** El teléfono revisa calidad y parpadeo (MediaPipe es público y gratuito) y el servidor verifica con Rekognition, con la foto como evidencia. Cierra las debilidades 1, 2 y 3 y reduce el costo de enviar fotos malas.
2. **Cumplimiento laboral de serie.** Informe con folio y huella, aceptación del medio versionada y bitácora de correcciones. Es lo que más vende hoy en México y tenemos buena parte de los cimientos.
3. **Campo y cuadrillas primero.** Es el hueco del mercado: obra, agro, limpieza, seguridad, logística. Con supervisión, geocerca y pase de lista grupal.
4. **Enrolamiento por enlace, mejorado.** Enlace por correo o mensaje con consentimiento firmado, control de calidad y detección de duplicados.
5. **Precio predecible.** Por empleado activo al mes, con registros incluidos. Cada búsqueda nos cuesta del orden de 0.001 USD, así que hay margen frente a $0.025 por registro.
6. **IA con cifras exactas.** Un conector MCP de solo lectura y resúmenes en los que el código calcula los números y la IA solo redacta.
7. **Mensaje honesto de privacidad.** Decir con precisión qué se guarda (vector, foto, ubicación) y por cuánto tiempo; es una ventaja frente a "nada se sube a la nube".

## 9. Plan de arquitectura

Sobre la base del documento de límites y puertos. **No cambia la F1**; lo siguiente son puertos y módulos posteriores.

| Puerto o módulo nuevo | Para qué | Datos principales |
|---|---|---|
| `ScheduleStore` | Horarios por grupo o persona, descansos, días laborales, turno nocturno | grupo o persona, días, inicio, fin, pausas, tolerancia, vigencia |
| `LeaveStore` | Permisos, vacaciones, incapacidades y olvidos de checada | persona, tipo, rango, estado, aprobador, motivo |
| `CorrectionLedger` | Correcciones sin perder el original | registro, valor original, valor nuevo, quién, cuándo, motivo |
| `ReportFolio` | Informe con folio y huella | folio, persona, periodo, huella SHA-256, quién y cuándo |
| `MediumAgreement` | Aceptación del medio de registro | persona, texto y versión, medio, fecha |
| `UsageMeter` | Cobro por empleado activo y topes por cliente | cliente, mes, empleados activos, búsquedas |
| Capa de captura | Calidad y parpadeo en el teléfono antes de enviar | umbrales de calidad, resultado de la prueba de vida |
| Canal reloj web | Kiosko con marca | marca, dispositivo, sitio |
| Enlace de enrolamiento | Alta sin pasar por RH | token, persona, vigencia, consentimiento |

**Orden sugerido:** informe con folio y correcciones; horarios y permisos; capa de captura con prueba de vida; reloj web con marca; enrolamiento por enlace; conector MCP.

## 10. Correcciones a documentos anteriores

El documento `2026-11-14-asistencia-comparativa-whatstime.md` de Agrovid tiene errores que este análisis corrige:

1. Trató la promesa "fichan con solo mirar la cámara… guardamos un vector, nunca la foto" como de **"otro producto"**. Es de WhatsTime.
2. Dijo que los textos de WhatsTime **no mencionaban el rostro**. Sí lo tiene (nuevo, con enrolamiento por enlace).
3. Subestimó su enfoque de cumplimiento (informe con folio y huella) y su conector para IA, que ya venden.
4. En `2026-11-14-asistencia-retencion-de-fotos-design.md` se descartó reconocer en el navegador. La conclusión de fondo se mantiene (el servidor no debe confiar en un vector que calcula el teléfono) pero conviene matizar: la **detección y la prueba de vida en el teléfono sí valen la pena como primera capa**, y un vector calculado en el teléfono también puede servir si el servidor lo verifica con la imagen.

## 11. Preguntas abiertas

1. ¿El informe con folio y huella es prioridad antes que horarios y permisos? (Recomendación: sí, por el calendario de la reforma.)
2. ¿Se quiere un kiosko con marca como primer canal nuevo, o primero la prueba de vida en el teléfono?
3. ¿El conector MCP es parte del producto base o un complemento de pago?
4. ¿Se compite en precio por registro o por empleado?
5. ¿Qué dice legal sobre ofrecer "cumple la reforma" y sobre el aviso de privacidad del reconocimiento facial?

## 12. Otros competidores

Los cuatro salen de anuncios patrocinados en Google (captura de Karlo, 2026-11-14). **Qué se pudo leer:** de Alpacca y Bizneo, sus páginas oficiales; de Sesame HR, solo la página de captación (la ruta del anuncio devolvía 404); de Buk, solo resultados de búsqueda (su sitio redirige a un dominio que no estaba permitido). Lo de Sesame y Buk es por tanto de **segunda mano** y se marca como tal. Los precios de Sesame vienen de un comparador de terceros.

| | Sesame HR | Bizneo | Alpacca | Buk |
|---|---|---|---|---|
| **Tipo** | Suite de RR. HH. (origen español, creciendo en México) | Suite de RR. HH. con módulos que se contratan por separado (origen español) | Checador y turnos para negocio pequeño (EE. UU., en inglés y español) | Suite de RR. HH. y nómina (origen chileno) |
| **Asistencia** | Control horario, turnos, vacaciones y ausencias; app móvil. Anuncia "100 % online" | "Checador 5 en 1": QR, NFC, biométrico y app; "funciona sin internet"; fichaje web, app o NFC; "válido ante inspección STPS" (texto del anuncio) | Tableta en la puerta (el empleado toca su nombre y pone su PIN) o el teléfono; ubicación en cada registro; faltas, retardos y horas extra | Módulo de asistencia dentro de la plataforma: relojes biométricos de huella, quioscos de reconocimiento facial y app móvil con geocercas |
| **Turnos** | Sí | Sí; las ausencias condicionan los turnos | **Núcleo del producto**: se publica la semana una vez y se manda por WhatsApp | Sí (inferido) |
| **Cierre y nómina** | Incidencias de nómina adaptadas a México | **Prenómina** con horas, ausencias e incidencias lista para varios sistemas de nómina | **Cierre de periodo**: se corrigen faltantes, se aprueban horas y se manda **un Excel al contador**. No corre nómina | Asistencia integrada con su nómina |
| **IA** | No se vio | Detección de patrones de puntualidad y fichajes irregulares | "Tu app de IA" (sin detalle) | "RR. HH. impulsado con IA" (marketing) |
| **Aprobaciones** | Vacaciones y ausencias | Flujos automáticos: ausencias, correcciones y horas extra, con alertas | Permisos y saldos de vacaciones | Sí (inferido) |
| **Integraciones** | — | API y "más de 1,000" integraciones (ERP, nómina, control de accesos, firma electrónica) | Exporta a Excel | Relojes y quioscos de terceros |
| **Precio** | Desde unos $70 MXN por empleado al mes con contrato anual, o $90 mensual, con mínimo de 15 empleados (comparador de terceros; confirmar) | Por empleado y mes en suscripción anual, más barato con más herramientas y más plantilla; cotización | **Precio plano por negocio** según tamaño: $12.99 USD al mes hasta 10 personas, $24.99 hasta 25, $49.99 hasta 75; todas las funciones; 14 días gratis; horario gratis hasta 5 personas sin cuenta | Configurador de precios; cotización |
| **Mensaje** | "Menos 20 % de ausentismo, 50 % menos tiempo administrativo" | Cumplir la ley y automatizar; "solo revisas las excepciones" | "Horas exactas para cada día de pago"; "no se cobra por empleado" | "60 % menos tiempo administrativo" |
| **Captación** | Formulario con el sector (incluye agricultura y construcción) | Demo y 15 días gratis; páginas por tema | Demo sin cuenta; guías | Blog, rankings y comparativas contra otros (por ejemplo "Buk vs Worky") |

**Patrones comunes**

1. **Todos venden cumplimiento de la reforma laboral.** Bizneo lo pone en el título del anuncio ("cumple la LFT desde 2027") y WhatsTime lo convierte en su argumento central.
2. **Dos estrategias:** suites que meten el checador dentro de todo RR. HH. (Sesame, Bizneo, Buk) y especialistas que hacen una cosa muy bien y barata (WhatsTime, Alpacca).
3. **Cuatro formas de cobrar:** por empleado (Sesame, Bizneo), por registro (WhatsTime), plano por negocio y tamaño (Alpacca) y por configurador o cotización (Buk).
4. **El cierre del periodo hacia la nómina** (Alpacca, Bizneo, Buk) es tan importante como el registro: prenómina o un archivo para el contador.
5. **Las aprobaciones con alertas** (correcciones, horas extra, ausencias) son estándar.
6. **El quiosco compartido** aparece en WhatsTime, Alpacca y Bizneo: no todos tienen teléfono propio.
7. **Funcionar sin internet** lo anuncia Bizneo (con su aparato); WhatsTime y Alpacca no lo dicen.

**Debilidades que se ven**

- **Las suites** son pesadas y se cotizan: no son para una cuadrilla de 12 personas en campo.
- **Alpacca** está pensado para turnos de comercio, y su registro es PIN o teléfono, **sin verificación facial ni foto** (no se vio); su cobro plano termina en 75 personas.
- **Bizneo** depende de hardware propio para el modo sin internet y se orienta a España (su texto cita la normativa española).
- **Ninguno** muestra pase de lista por cuadrilla con supervisor, geocerca que bloquea ni foto sellada como evidencia.

## 13. Qué podemos enriquecer (consolidado)

Cruza WhatsTime y los cuatro. "Qué hay" se refiere a Agrovid y el núcleo hoy.

| # | Idea | De quién | Qué hay hoy | Valor | Esfuerzo |
|---|---|---|---|---|---|
| 1 | **Informe de jornada con folio y huella SHA-256**, aceptación del medio versionada y correcciones con valor original | WhatsTime; Bizneo (informes para la inspección) | Registros inmutables, consentimiento firmado y hash de foto; faltan informe, folio y correcciones | Muy alto en México por la reforma | Medio |
| 2 | **Cierre de periodo**: corregir faltantes, aprobar horas, exportar prenómina (horas, horas extra, domingos y festivos, vacaciones) | Alpacca; Bizneo | Excel con retardos y horas; no hay cierre ni aprobación | Alto: es el momento que el cliente paga | Medio |
| 3 | **Flujos de aprobación** (ausencias, correcciones, horas extra) con alertas | Bizneo; WhatsTime | Solo "justificado" con motivo | Alto | Medio |
| 4 | **Horarios por grupo o persona**, turnos nocturnos y **horario semanal publicado** (por Telegram) | Alpacca; WhatsTime; Bizneo | Un horario por empresa | Alto | Medio |
| 5 | **Quiosco compartido** (tableta con rostro o PIN) | WhatsTime; Alpacca; Bizneo | Mini App de Telegram; caseta con rostro | Alto para quien no tiene teléfono | Medio |
| 6 | **Precio**: plano por negocio y tamaño, o por empleado activo | Alpacca; Sesame | Sin definir | Alto: elimina el miedo a la factura variable | Bajo (decisión) |
| 7 | **Nivel gratis de captación** (horario sin cuenta, o saldo de prueba) | Alpacca; WhatsTime | No | Medio | Bajo |
| 8 | **Prueba de vida y calidad en el teléfono** antes de enviar | WhatsTime (parpadeo) | Planeado, sin construir | Alto: más difícil de falsear | Medio |
| 9 | **Modo sin internet** | Bizneo (anuncio) | Diseño #1049 | Alto en campo | Alto |
| 10 | **API, webhooks y exportaciones** a sistemas de nómina | Bizneo; WhatsTime (MCP) | Diseño de octubre las preveía | Medio | Medio |
| 11 | **Conector de IA de solo lectura** y detección de patrones de puntualidad | WhatsTime; Bizneo | No | Medio | Medio |
| 12 | **Posicionamiento**: páginas por giro, comparativas, diagnóstico de la reforma, formulario por sector | WhatsTime; Buk; Sesame | No (es de producto) | Alto para vender | Bajo a medio |
| 13 | **Lector de relojes biométricos existentes** (importar sus registros) | Buk; Bizneo | No | Medio: quien ya compró hardware | Alto; solo si lo piden |

**Dónde nos queremos diferenciar de los cinco:** pase de lista por cuadrilla con supervisor, **foto sellada y geocerca que bloquea** como evidencia, privacidad medible (borrado, retención, consentimiento) y campo primero. Ningún competidor muestra esas cuatro cosas juntas.

**Orden sugerido (actualiza el de la sección 9):** 1, 2 y 3 (la ley y el cierre) primero; luego 4, 6 y 8; después 5; 9 cuando se decida el alcance; 10 a 13 según lo pida el mercado.

## 14. Preguntas abiertas adicionales

1. ¿Precio plano por negocio, por empleado activo o mixto? Referencias: Alpacca $13 a $50 USD al mes según tamaño; Sesame $70 a $90 MXN por empleado; WhatsTime cerca de $1.10 USD por empleado al mes con una entrada y una salida diarias.
2. ¿Hay un nivel gratis? ¿Cuál (horario, prueba por días o saldo)?
3. ¿Se quiere cubrir el cierre de periodo con prenómina antes de pensar en nómina propia?
4. ¿Queremos confirmar con las páginas oficiales de Sesame y Buk? Hace falta permitir `www.buk.mx` y la ruta real de Sesame.
