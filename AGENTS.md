# Instrucciones para trabajar en Pluma PDF

Este repositorio contiene un plugin de Figma y un motor Node local. Conserva el flujo actual y realiza cambios pequeños y verificables. Las instrucciones y autorizaciones vigentes del usuario prevalecen sobre este archivo.

## Documentación actual con Context7

Consulta Context7 MCP cuando una tarea trate sobre una biblioteca, framework, SDK, API, herramienta CLI o servicio cloud: sintaxis, configuración, versiones, migración, instalación o errores específicos. Hazlo incluso si crees conocer la respuesta; prefiere Context7 a una búsqueda web para documentación de librerías.

1. Empieza con `resolve-library-id`, indicando el nombre de la biblioteca y qué necesitas consultar. Omite este paso solo cuando el usuario proporcione un ID exacto `/org/project` o una versión de ese ID.
2. Escoge la coincidencia por nombre, relevancia, cobertura de ejemplos, reputación y puntuación. Si la coincidencia es mala, reformula la búsqueda. Respeta la versión solicitada y revisa la versión instalada en el lockfile.
3. Usa `query-docs` con el ID elegido y una pregunta concreta sobre un concepto. Consulta por separado conceptos independientes; combínalos solo si necesitas entender su interacción.
4. Basa la implementación y la explicación en lo consultado.

No hace falta Context7 para refactorización mecánica, scripts escritos desde cero, lógica de negocio, revisión de código general o conceptos de programación que no dependan de una API de biblioteca.

## Invariantes del producto

- **El diseño de Figma permanece intacto.** Exportar o analizar no puede crear clones, cambiar rellenos, máscaras, visibilidad, opacidad, jerarquías, posiciones ni dimensiones. No uses cambios temporales del documento como paso de exportación.
- **Foco es la única excepción de navegación.** La acción explícita de enfocar una capa puede cambiar la selección y el viewport. No puede editar su contenido ni descartar el conjunto de páginas ya revisado. No enfoques durante una exportación activa.
- **Inteligente parte del PDF nativo.** Optimiza imágenes internas del PDF exportado; conserva texto, fuentes e instrucciones vectoriales. No rasterices un frame completo como comportamiento predeterminado. El modo Compacto permite ese compromiso de forma explícita.
- **Original conserva el contenido exportado.** Unir páginas puede cambiar la serialización y las referencias del PDF; no debe volver a codificar sus imágenes ni alterar sus instrucciones de dibujo.
- **Antes y después comparten captura.** Guarda los originales en memoria y compara sus variantes. No presentes mediciones obtenidas de dos exportaciones diferentes como una comparación de la misma captura.
- **JPEG tiene pérdida.** No prometas igualdad de píxeles, calidad de impresión ni un tamaño absoluto. Igualdad RGBA exacta, umbral de diferencias y evaluación visual son resultados distintos.
- **Diagnóstico no elimina capas.** Las superposiciones posibles y la cobertura geométrica verificada deben distinguirse. Una coincidencia de imagen o de posición no demuestra redundancia visual.

## PDF, imágenes y transparencia

- Conserva perfiles ICC y parámetros de interpretación. Si no puedes demostrar compatibilidad, deja ese recurso intacto.
- No adivines `/Decode`, predictores Flate, `ColorTransform`, espacios CMYK/Indexed, `/Matte` ni máscaras complejas.
- Remuestrea color y alpha juntos para evitar halos. El alpha resultante se guarda sin pérdida. Nunca modifiques una máscara compartida: crea otra referencia para la variante y elimina la anterior solo si ya no tiene referencias.
- Solo puedes retirar una máscara opaca después de verificar que todas sus muestras son 255. Tener canal alpha no significa tener transparencia real.
- Deduplica por bytes codificados y diccionario equivalente, incluyendo máscara y perfil. La pasada final `/pdf/deduplicate` no decodifica ni vuelve a comprimir imágenes.
- Una imagen compartida debe cubrir su mayor uso en todo el documento. Al unir alias, un uso desconocido fuerza el límite global. Los grupos o patrones ambiguos mantienen ese comportamiento conservador.
- Conserva los límites de bytes, píxeles, concurrencia y tiempo. No amplíes imágenes pequeñas. Devuelve el original cuando el resultado completo no sea menor.

## Interfaz y protocolo

La interfaz aceptada es vertical, de **460 × 800**. Verifica el ancho real del plugin, el scroll, los textos largos y la lista completa; una captura del demo ancho no sustituye esa comprobación. Evita que el contenido mínimo de grids o elementos flex expanda el panel horizontalmente.

Mantén el protocolo por `jobId`, la entrega secuencial de páginas y los ACK. Una respuesta antigua, un cambio de ajustes o una cancelación no puede publicar un resultado obsoleto. Respeta el límite de caché y libera URLs de blobs, canvases y tareas PDF.js.

No introduzcas solicitudes a CDNs o servicios de optimización. El worker PDF.js se incluye en el bundle. Los bytes del usuario solo deben viajar al motor de localhost, cuando el modo elegido lo necesite.

## Estructura y desarrollo

- `src/plugin.ts`: API de Figma, alcance, orden del canvas, exportación, cancelación, diagnóstico y foco.
- `src/ui.*`: interfaz, caché, variantes, unión y descarga.
- `src/geometry.ts`, `occlusion.ts`, `pdf-preview.ts`, `visual-diff.ts`: geometría, diagnóstico y comparación.
- `engine/`: HTTP en loopback, Sharp, optimización PDF, colocación y deduplicación.
- `tests/`: fixtures sintéticos y pruebas de los límites anteriores.
- `build.mjs` genera `dist/code.js` y `dist/ui.html`. No edites esos resultados a mano.
- `preview.mjs` ofrece el demo local; no controla un documento real de Figma.

Usa Node compatible con `package.json` y `npm ci` para respetar el lockfile. No reestructures el proyecto para una corrección localizada. No reconstruyas o recargues la UI en mitad de una exportación activa; coordina ese trabajo o usa una copia aislada.

## Verificación

Para una validación completa ejecuta `npm run check`: typecheck, build y pruebas. Las pruebas del controlador verifican el bundle que Figma importa, por lo que el build debe corresponder al código fuente. Durante trabajo focalizado puedes compilar el controlador en memoria con `PLUMA_TEST_CONTROLLER_SOURCE=1`.

Las pruebas públicas deben generar sus PDFs y píxeles sintéticos. La regresión de 55 frames utiliza un grid artificial, nombres inversos y un orden de capas diferente del orden visual. Conserva su independencia respecto de documentos de clientes.

`PLUMA_PDF_FIXTURE` permite una prueba privada opcional. Su archivo se proporciona fuera del repositorio; nunca lo copies al árbol publicable. Informa por separado pruebas aprobadas, fallidas y omitidas: una prueba privada omitida no equivale a una aprobada.

Para cambios de optimización, valida contenido y renderizado: páginas, texto, operadores, fuentes, vínculos de imagen, ICC y alpha. Las referencias numéricas pueden cambiar después de `copyPages`; compara sus contenidos semánticos. Inspecciona también regiones con detalle y transparencias, no solo el promedio de una página casi blanca.

## Privacidad y publicación

Publicar este software no autoriza a publicar los documentos utilizados durante su desarrollo. No incluyas PDFs de clientes, capturas, renders, fotos extraídas, nombres de proyectos privados, identificadores de archivos o capas privados de Figma, coordenadas de un canvas real, hashes de documentos privados, rutas personales, credenciales, archivos `.env` ni informes que los contengan.

`work/`, dependencias instaladas, cachés, logs y resultados de validaciones privadas permanecen locales. Mantén los informes del usuario sin borrarlos: exclúyelos del snapshot público o archívalos localmente. Si necesitas una muestra pública, créala con datos sintéticos y documenta su origen.

Antes de crear un commit público, etiqueta o artefacto de release:

1. Revisa la lista completa de archivos que se publicarán, incluidos archivos ocultos y el contenido del ZIP. No confíes únicamente en `.gitignore`.
2. Comprueba los invariantes y ejecuta la validación correspondiente; para una release, `npm run check` debe aprobarse.
3. Genera los bundles desde esa misma revisión, comprueba los destinos del manifest e incluye los avisos y licencias de terceros necesarios. Mantén sincronizada la versión de `package.json`, el lockfile, `/health` y el artefacto de release: los lanzadores verifican esa identidad.
4. Verifica que no se han incorporado datos privados en tests, documentación, screenshots o resultados generados. No atribuyas métricas privadas a un ejemplo sintético.
5. Publica dentro del alcance autorizado. Una publicación en GitHub no autoriza publicar en Figma Community ni subir material de diseño.

Los cambios de código, las muestras públicas y los informes de una validación privada son artefactos distintos. Mantén esa separación sin modificar el documento del usuario.
