# Install Pluma PDF

Pluma PDF is imported as a development plugin in **Figma Desktop**. You do not need a paid plugin, a Community publication, or a compression account. Keep the entire folder in a fixed location: Figma reads the plugin from that folder.

These instructions describe release **1.0.2**. The plugin interface remains in Spanish; the instructions below preserve its actual labels and explain them in English.

## Before you start

You need Figma Desktop and **Node.js 22.13.0 or later**, with npm. You can use a compatible LTS version from the [official Node.js installer](https://nodejs.org/en/download). The first installation downloads npm dependencies and requires internet access. After that, the engine processes PDFs on your computer.

For the packaged installation, download the `PlumaPDF-1.0.2.zip` release asset. It includes the prebuilt `dist/code.js` and `dist/ui.html` bundles. Extract the entire archive and keep the folder somewhere stable, such as Documents. On Windows, use **Extract all** before opening `.cmd` files. Do not run the plugin from inside the ZIP. Do not copy `node_modules` from another computer: Sharp needs the binary for your operating system and processor.

A source checkout or GitHub's automatic **Source code** download does not include `dist/`, which is generated output ignored by Git. You can use the same installation steps: the installer downloads dependencies and builds the bundles from source. Finish installation before importing `manifest.json` into Figma.

The manifest remains at the extracted folder's root. Platform launchers are under `scripts/macos/` and `scripts/windows/`.

## macOS

1. Open `scripts/macos/install.command`. It installs the versions in `package-lock.json` with `npm ci` and prepares the plugin. Wait for the installation-complete message.
2. Open `scripts/macos/start-engine.command`. Keep that window open while using "Inteligente" (Smart).
3. Open a design file in Figma Desktop. Choose **Plugins → Development → Import plugin from manifest…** and select `manifest.json` at the extracted folder's root.
4. Open **Plugins → Development → Pluma PDF · Local**. Select frames or choose "Página" (Page), then click "Analizar y previsualizar" (Analyze and preview).

If macOS does not open a `.command` file, open Terminal, type `zsh ` with a trailing space, drag the file into Terminal, and press Return. If a download requires authorization, check its origin and use macOS opening options; you do not need to disable system protections.

## Windows

1. Double-click `scripts/windows/install.cmd`. Wait for the installation-complete message.
2. Open `scripts/windows/start-engine.cmd`. Keep that window open while using "Inteligente" (Smart).
3. In Figma Desktop, choose **Plugins → Development → Import plugin from manifest…** and select `manifest.json` at the extracted folder's root.
4. Open **Plugins → Development → Pluma PDF · Local** and analyze your frames with "Analizar y previsualizar" (Analyze and preview).

If you just installed Node.js and the launcher cannot find it, close that window and open a new one. Administrator privileges are not required. The Windows launchers share the same installation and checking code as macOS; the workflow has not yet been tested manually on a real Windows computer. Windows ARM64 also depends on Sharp's experimental support for that architecture.

Importing from a manifest follows the [official Figma procedure](https://help.figma.com/hc/en-us/articles/360042786733-Create-a-classic-plugin-for-development). The exact menu wording may vary with Figma's language.

## Daily use

Open `scripts/macos/start-engine.command` or `scripts/windows/start-engine.cmd`, then open the plugin in Figma. Startup checks the manifest entry points and rebuilds missing or invalid bundles before starting or reusing the engine. If the engine is already running and its version matches, the launcher reuses it and displays a notice. You can close the second window; keep the original engine window open. To stop the engine, press **Ctrl+C** in its window.

The engine exposes `http://127.0.0.1:3847/health`. The plugin connects to `http://localhost:3847`. "Original" and "Compacto" (Compact) can export without this engine; "Inteligente" and local deduplication require it.

`scripts/macos/preview.command` or `scripts/windows/preview.cmd` opens a browser demo with synthetic pages. To work with your own design, open the plugin inside Figma. The accepted plugin panel is **460 × 800**; a wider browser demo is not a substitute for checking the actual panel.

If you move or rename the folder, reimport `manifest.json` from its new location. To update, close the engine and plugin, extract the new release, run its installer, and reimport its manifest.

## Troubleshooting

### Figma's plugin environment error

If Figma displays **"An error occurred while loading the plugin environment"**, check the files referenced by `manifest.json`. Its `main` and `ui` entries point to `dist/code.js` and `dist/ui.html`. Those generated files can be absent after downloading source code or updating a checkout; an engine that is already connected does not prove that Figma can load them.

From a terminal in the plugin folder, run:

```sh
npm start
```

This prepares dependencies and rebuilds missing or invalid manifest targets before starting or reusing the engine. You can also use `scripts/macos/start-engine.command` or `scripts/windows/start-engine.cmd`. Wait for startup to finish, then reopen **Pluma PDF · Local** in Figma. If you moved the plugin folder, reimport `manifest.json` from the new location.

To rebuild the bundles without starting the engine, use:

```sh
npm run build
```

If dependencies are missing, run `npm run install:local` or the platform installer first. To inspect readiness without building or starting a service, use:

```sh
npm run doctor
```

The doctor checks the manifest's actual entry points and reports an error with a nonzero exit status if a bundle is missing, empty, unreadable, or invalid. It also reports the local engine's status. A connected engine and ready plugin bundles are separate checks. After repairing the files, run the doctor again before reopening the plugin.

### Other installation issues

| Message or symptom | What to do |
| --- | --- |
| Node is missing or older than 22.13 | Install a compatible version from Node.js and reopen the launcher. |
| Dependency download fails | Check internet access or your network proxy, then rerun `scripts/macos/install.command` or `scripts/windows/install.cmd`. The installer does not change the lockfile. |
| Sharp fails to load | Run the installer on that computer. Do not reuse `node_modules` from another system or architecture. Installation includes the optional dependencies needed for its binaries. |
| Port 3847 is occupied | The launcher reports when the service is not a compatible Pluma engine. Close the application using that port and retry; Pluma does not stop unrelated processes. |
| Figma cannot load the plugin | Follow the plugin environment recovery steps above. Check that you selected the correct `manifest.json` and that its folder is still in place. |
| The plugin reports that the engine is disconnected | Keep the engine launcher window open. Check that `/health` responds and that Figma Desktop can access the local server. |

The direct equivalent of `npm run doctor`, from a terminal in the repository folder, is:

```sh
node scripts/local.mjs check
```

The terminal equivalents of the installer and engine launchers are the same on macOS and Windows:

```sh
node scripts/local.mjs install
node scripts/local.mjs engine
```

The build and demo entry points are `scripts/build.mjs` and `scripts/preview.mjs`. Their npm commands remain `npm run build` and `npm run preview`.

## Create a ZIP to share

For project maintainers, run the following locally from the repository folder. Validation uses `npm run check`; the repository does not include a GitHub Actions workflow.

```sh
npm ci
npm run check
node scripts/package.mjs
```

The packager does not run another build: it distributes the bundles that were already checked. For version 1.0.2, it generates `release/PlumaPDF-1.0.2.zip`, its SHA-256, and an inventory containing each file's hash. It also accepts `node scripts/package.mjs --out /path/to/another/folder`.

The installable release archive includes the manifest, prebuilt `dist/` bundles, engine, source, platform launchers, instructions, licenses, and locked dependency files. These bundles remain outside Git and its automatic source archives. The packager uses an explicit list of files and extensions; it excludes `node_modules`, `.git`, working directories, and PDFs. The ZIP works as a portable folder, although each computer must install Node.js and download its own dependencies.

Reproducible installation uses [`npm ci`](https://docs.npmjs.com/cli/v10/commands/npm-ci), which requires `package.json` and the lockfile to agree and does not update them. Binaries are selected for each platform according to the [Sharp installation documentation](https://sharp.pixelplumbing.com/install/).
