# Pluma PDF Privacy Policy

Last updated: 28 October 2026

This policy describes the Pluma PDF classic Figma plugin and its optional local Node.js engine, maintained by [charliezstong](https://github.com/charliezstong). It covers the software distributed from the [Pluma PDF repository](https://github.com/charliezstong/pluma-pdf).

## Data used to provide the plugin

Pluma reads the frames you choose from your selection or the current Figma page. It uses frame and layer names, identifiers, dimensions, and positions to display and order pages and provide overlap diagnostics. It requests native PNG previews and PDF exports from Figma to show your design, compare results, and create the PDF you download. Exported PDFs can contain your document's text, images, fonts, and other embedded resources.

Pluma does not require an additional Pluma account. The plugin and engine contain no analytics, advertising trackers, or automatic remote error reporting, and do not automatically upload your design or exported files to the maintainer or an optimization service.

## Local processing and network access

The plugin renders previews, merges PDFs, and performs Original and Compact exports inside its interface. Smart mode sends exported PDF bytes to the engine running on your own computer for image optimization and resource deduplication. The engine responds with processed bytes and size and image-count statistics.

The plugin connects to `http://localhost:3847`. The supplied engine listens on the loopback address `127.0.0.1`, not on your network's public interfaces. The interface may check the engine's health in any mode; those checks exchange the engine name and version without document content. Original and Compact exports do not send document bytes to the engine.

Pluma does not operate a remote document-processing service. Opening the engine download or support link takes you to GitHub in your browser; it does not attach your document.

## Memory, saved preferences, and downloads

Document bytes, preview images, and comparison results are held in session memory. Pluma's engine does not save input files or processed files to disk and has no document database. Refreshing the frame list discards the interface's document caches; closing the plugin ends that interface session. The engine does not keep a document history. Memory allocation and release remain subject to Figma, Node.js, and your operating system; this is not a promise of secure memory erasure.

The plugin stores your language choice (`auto`, `en`, `es`, or `pt`) using Figma's `clientStorage`. Choosing Automatic replaces the manual override. The standalone browser demo uses browser `localStorage` for the same preference when available. Document content and exported bytes are not stored in either preference store.

Clicking **Download PDF** creates a local file through Figma's or your browser's download behavior. The destination depends on your download settings. You control the resulting file, including its deletion, backup, and subsequent sharing.

## Source design and diagnostic output

Analysis and export do not change your Figma document's layers, images, masks, visibility, positions, or dimensions. **View layer in Figma** changes the selection and viewport only when you request that action.

The engine does not implement HTTP access logs or log request bodies. Startup and installation tools print status and error messages locally, which can include installation paths. If you explicitly enable `PLUMA_DEBUG_PDF=1`, skipped-image diagnostics print PDF object references and error messages to the terminal. Review diagnostic output before sharing it. Pluma does not automatically transmit these messages.

## Installation and other services

The first installation downloads Node.js dependencies and platform-specific binaries through npm and its configured download sources. Those providers receive the network requests needed to distribute their software. This installation traffic is separate from document processing and does not include your Figma document or exported PDFs.

Figma provides the host application, accounts, document storage, and plugin storage under its own terms and privacy practices. GitHub, npm, Node.js download providers, your browser, and your operating system also have their own practices. This policy describes what Pluma itself does; it does not replace those services' policies.

## Support and policy changes

Contact the maintainer through [GitHub Issues](https://github.com/charliezstong/pluma-pdf/issues). Issues and attachments there are public. Do not post private PDFs, client screenshots, credentials, or confidential document details. Use a synthetic example and remove personal paths or sensitive details from logs.

Updates to the software or this policy may change these practices. The current policy is maintained in this repository with its update date.
