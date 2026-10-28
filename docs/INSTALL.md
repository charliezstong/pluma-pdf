# Instalar Pluma PDF

Pluma PDF se importa como plugin de desarrollo en **Figma Desktop**. No hace falta pagar otro plugin, publicar en Community ni tener una cuenta de compresión. Conserva toda la carpeta en una ubicación fija: Figma lee el plugin desde ella.

## Antes de empezar

Necesitas Figma Desktop y **Node.js 22.13.0 o posterior**, con npm. Puedes usar una versión LTS compatible del [instalador oficial de Node.js](https://nodejs.org/en/download). La primera instalación descarga dependencias de npm y necesita internet. Después, el motor procesa tus PDFs en tu equipo.

Descarga el ZIP de la versión de Pluma PDF, extráelo completo y guarda la carpeta, por ejemplo, en Documentos. En Windows, usa **Extraer todo** antes de abrir los archivos `.cmd`. No ejecutes el plugin desde dentro del ZIP. No copies `node_modules` desde otro ordenador: Sharp necesita el binario de tu sistema y procesador.

## macOS

1. Abre **Instalar Pluma PDF.command**. Instala las versiones del archivo `package-lock.json` con `npm ci` y prepara el plugin. Espera el mensaje de instalación completa.
2. Abre **Iniciar motor.command**. Deja esa ventana abierta mientras usas el modo Inteligente.
3. En Figma Desktop abre un archivo de diseño. En el menú **Plugins → Development → Import plugin from manifest…**, selecciona el `manifest.json` de esta carpeta.
4. Abre **Plugins → Development → Pluma PDF · Local**. Selecciona frames o cambia a Página y pulsa **Analizar y previsualizar**.

Si macOS no permite abrir un `.command`, abre Terminal, escribe `zsh ` con un espacio, arrastra el archivo a Terminal y pulsa Intro. Si una descarga requiere autorización, revisa su origen y usa las opciones de apertura de macOS; no es necesario desactivar las protecciones del sistema.

## Windows

1. Abre **Instalar Pluma PDF.cmd** con doble clic. Espera el mensaje de instalación completa.
2. Abre **Iniciar motor.cmd**. Deja esa ventana abierta mientras usas Inteligente.
3. En Figma Desktop, **Plugins → Development → Import plugin from manifest…**, elige el `manifest.json` de la carpeta extraída.
4. Abre **Plugins → Development → Pluma PDF · Local** y analiza tus frames.

Si acabas de instalar Node.js y el lanzador todavía no lo encuentra, cierra esa ventana y abre otra. No hace falta ejecutar como administrador. Los lanzadores Windows comparten el mismo código de instalación y comprobación que macOS; no se han probado todavía en un equipo Windows real. Windows ARM64 depende además del soporte experimental de Sharp para esa arquitectura.

La importación desde el manifiesto sigue el [procedimiento oficial de Figma](https://help.figma.com/hc/en-us/articles/360042786733-Create-a-classic-plugin-for-development). El nombre exacto del menú puede variar según el idioma de Figma.

## En el uso diario

Abre **Iniciar motor** y después el plugin en Figma. Si el motor ya está abierto y su versión coincide, el lanzador lo reutiliza y muestra un aviso. La segunda ventana puede cerrarse; conserva abierta la ventana original del motor. Para detenerlo, pulsa **Ctrl+C** en su ventana.

El motor usa `http://127.0.0.1:3847/health`. El plugin conecta a `http://localhost:3847`. Original y Compacto pueden exportar sin este motor; Inteligente y la deduplicación local lo necesitan. **Ver interfaz.command / Ver interfaz.cmd** abre una demo con páginas sintéticas en el navegador; para trabajar con tu diseño, abre el plugin dentro de Figma.

Si mueves o renombras la carpeta, vuelve a importar su `manifest.json` desde la nueva ubicación. Para actualizar, cierra el motor y el plugin, extrae la nueva versión, ejecuta su instalador y vuelve a importar su manifiesto.

## Si algo falla

| Mensaje o síntoma | Qué hacer |
| --- | --- |
| Node no aparece o es anterior a 22.13 | Instala una versión compatible desde Node.js y vuelve a abrir el lanzador. |
| Falla la descarga de dependencias | Comprueba internet o el proxy de tu red y vuelve a abrir **Instalar Pluma PDF**. No modifica el archivo de versiones fijadas. |
| Sharp no carga | Ejecuta el instalador en ese equipo. No reutilices `node_modules` de otro sistema o arquitectura. Se incluyen las dependencias opcionales necesarias para sus binarios. |
| Puerto 3847 ocupado | Si no es un motor Pluma compatible, el lanzador lo indica. Cierra la aplicación que ocupa ese puerto y reintenta; Pluma no detiene procesos ajenos. |
| Figma no carga el plugin | Comprueba que elegiste `manifest.json`, que la carpeta sigue en su sitio y que existen `dist/code.js` y `dist/ui.html`. Ejecuta el instalador si faltan. |
| El plugin indica motor desconectado | Mantén abierto **Iniciar motor**. Comprueba que `/health` responde y que Figma Desktop tiene permiso para acceder al servidor local. |

Desde una terminal en la carpeta puedes comprobar el estado sin iniciar ni detener nada:

```sh
node scripts/local.mjs check
```

Los pasos equivalentes al doble clic son los mismos en macOS y Windows:

```sh
node scripts/local.mjs install
node scripts/local.mjs engine
```

## Crear un ZIP para compartir

Para quien mantiene el proyecto, desde la carpeta del repositorio:

```sh
npm ci
npm run check
node scripts/package.mjs
```

El empaquetador no ejecuta un nuevo build: distribuye los bundles ya comprobados. Genera `release/PlumaPDF-<versión>.zip`, su SHA-256 y un inventario con el hash de cada archivo. También admite `node scripts/package.mjs --out /ruta/a/otra/carpeta`.

Incluye manifiesto, bundles, motor, fuentes, instaladores, instrucciones, licencias y archivos de dependencias fijadas. Usa una lista explícita de archivos y extensiones; excluye `node_modules`, `.git`, carpetas de trabajo y PDFs. El ZIP funciona como carpeta portable, aunque cada equipo debe instalar Node.js y descargar sus propias dependencias.

La instalación reproducible usa [`npm ci`](https://docs.npmjs.com/cli/v10/commands/npm-ci), que exige coherencia entre `package.json` y el lockfile y no los actualiza. Los binarios se eligen para cada plataforma siguiendo la [documentación de Sharp](https://sharp.pixelplumbing.com/install/).
