"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __defProps = Object.defineProperties;
  var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
  var __getOwnPropSymbols = Object.getOwnPropertySymbols;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __propIsEnum = Object.prototype.propertyIsEnumerable;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __spreadValues = (a, b) => {
    for (var prop in b || (b = {}))
      if (__hasOwnProp.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    if (__getOwnPropSymbols)
      for (var prop of __getOwnPropSymbols(b)) {
        if (__propIsEnum.call(b, prop))
          __defNormalProp(a, prop, b[prop]);
      }
    return a;
  };
  var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));

  // src/geometry.ts
  var MAX_RASTER_EDGE = 8192;
  var MAX_RASTER_PIXELS = 24e6;
  function positive(value, label) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`${label} debe ser un n\xFAmero positivo.`);
    }
    return value;
  }
  function cappedRasterSize(width, height, requestedScale, maxEdge = MAX_RASTER_EDGE, maxPixels = MAX_RASTER_PIXELS) {
    positive(width, "El ancho");
    positive(height, "El alto");
    positive(requestedScale, "La escala");
    positive(maxEdge, "El l\xEDmite de lado");
    positive(maxPixels, "El l\xEDmite de p\xEDxeles");
    const pixelScale = Math.sqrt(maxPixels) / Math.sqrt(width) / Math.sqrt(height);
    let scale = Math.min(requestedScale, maxEdge / width, maxEdge / height, pixelScale);
    let rasterWidth = Math.max(1, Math.ceil(width * scale));
    let rasterHeight = Math.max(1, Math.ceil(height * scale));
    if (rasterWidth * rasterHeight > maxPixels || rasterWidth > maxEdge || rasterHeight > maxEdge) {
      scale = Math.min(
        scale,
        Math.max(1, Math.floor(width * scale)) / width,
        Math.max(1, Math.floor(height * scale)) / height
      );
      rasterWidth = Math.max(1, Math.ceil(width * scale - 1e-9));
      rasterHeight = Math.max(1, Math.ceil(height * scale - 1e-9));
    }
    return { width: rasterWidth, height: rasterHeight, scale };
  }

  // src/occlusion.ts
  function validBounds(value) {
    return Boolean(value && [value.x, value.y, value.width, value.height].every(Number.isFinite) && value.width > 0 && value.height > 0);
  }
  function intersection(a, b) {
    const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
    const width = Math.min(a.x + a.width, b.x + b.width) - x, height = Math.min(a.y + a.height, b.y + b.height) - y;
    return width > 0 && height > 0 ? { x, y, width, height } : void 0;
  }
  function contains(outer, inner) {
    const epsilon = 1e-6;
    return outer.x <= inner.x + epsilon && outer.y <= inner.y + epsilon && outer.x + outer.width >= inner.x + inner.width - epsilon && outer.y + outer.height >= inner.y + inner.height - epsilon;
  }
  function visiblePaints(node) {
    return Array.isArray(node.fills) ? node.fills.filter((paint) => paint.visible !== false) : [];
  }
  function noEffects(node) {
    var _a;
    return !((_a = node.effects) != null ? _a : []).some((effect) => effect.visible !== false);
  }
  function normal(node) {
    var _a, _b;
    return ((_a = node.opacity) != null ? _a : 1) === 1 && ["NORMAL", "PASS_THROUGH"].includes((_b = node.blendMode) != null ? _b : "NORMAL") && noEffects(node);
  }
  function translationOnly(node) {
    const t = node.absoluteTransform;
    return Boolean(t && t.length === 2 && t[0].length === 3 && t[1].length === 3 && Math.abs(t[0][0] - 1) < 1e-8 && Math.abs(t[1][1] - 1) < 1e-8 && Math.abs(t[0][1]) < 1e-8 && Math.abs(t[1][0]) < 1e-8);
  }
  function rectangular(node) {
    return node.type === "RECTANGLE" && translationOnly(node) && (node.cornerRadius === 0 || [node.topLeftRadius, node.topRightRadius, node.bottomLeftRadius, node.bottomRightRadius].every((radius) => radius === 0));
  }
  function safeMask(node) {
    var _a;
    const paints = visiblePaints(node);
    return node.type === "RECTANGLE" && translationOnly(node) && normal(node) && node.maskType === "ALPHA" && paints.length === 1 && paints[0].type === "SOLID" && ((_a = paints[0].opacity) != null ? _a : 1) === 1;
  }
  function safeImagePaint(node, paints) {
    var _a, _b, _c;
    if (paints.length !== 1 || paints[0].type !== "IMAGE") return false;
    const paint = paints[0];
    return normal(node) && (node.strokes === void 0 || Array.isArray(node.strokes) && node.strokes.length === 0) && ((_a = paint.opacity) != null ? _a : 1) === 1 && ((_b = paint.blendMode) != null ? _b : "NORMAL") === "NORMAL" && paint.scaleMode === "FILL" && ((_c = paint.rotation) != null ? _c : 0) % 360 === 0 && (!paint.filters || Object.values(paint.filters).every((value) => value === 0));
  }
  function collectImageLayers(roots, options = {}) {
    var _a, _b, _c;
    const maxNodes = Math.min(1e4, (_a = options.maxNodes) != null ? _a : 1e4), deadline = (_b = options.deadline) != null ? _b : Date.now() + 1e4;
    const warnings = [], layers = [];
    let scannedNodes = 0, scannedImages = 0, paintOrder = 0;
    const stack = roots.map((frame) => ({ node: frame, frame, parentId: "", clips: [], masks: [], safeAncestors: true, maskContent: false })).reverse();
    while (stack.length) {
      (_c = options.checkCurrent) == null ? void 0 : _c.call(options);
      if (Date.now() >= deadline) {
        warnings.push("Se alcanz\xF3 el l\xEDmite de tiempo; la revisi\xF3n es parcial.");
        break;
      }
      if (scannedNodes >= maxNodes) {
        warnings.push("Se revisaron como m\xE1ximo 10.000 nodos; usa una selecci\xF3n menor para completar el an\xE1lisis.");
        break;
      }
      const entry = stack.pop(), node = entry.node;
      scannedNodes++;
      paintOrder++;
      if (node.visible === false || entry.maskContent) continue;
      let clips = entry.clips;
      if (node.clipsContent && validBounds(node.absoluteBoundingBox)) clips = [...clips, { id: node.id, bounds: node.absoluteBoundingBox, safe: translationOnly(node) }];
      const paints = visiblePaints(node), imagePaints = paints.filter((paint) => paint.type === "IMAGE" && paint.imageHash);
      scannedImages += imagePaints.length;
      if (imagePaints.length && validBounds(node.absoluteBoundingBox) && !node.isMask) {
        const bounds = __spreadValues({}, node.absoluteBoundingBox);
        let visibleBounds = bounds;
        for (const context of [...clips, ...entry.masks]) {
          if (visibleBounds) visibleBounds = intersection(visibleBounds, context.bounds);
        }
        if (visibleBounds) layers.push({
          id: node.id,
          name: node.name,
          frameId: entry.frame.id,
          frameName: entry.frame.name,
          parentId: entry.parentId,
          bounds,
          visibleBounds,
          paintOrder,
          imageHash: imagePaints[0].imageHash,
          maskKey: [...clips, ...entry.masks].map((context) => context.id).join("|"),
          masksSafe: [...clips, ...entry.masks].every((context) => context.safe),
          rectangular: rectangular(node),
          ancestorsSafe: entry.safeAncestors,
          nodeSafe: normal(node),
          coverPaintSafe: safeImagePaint(node, paints)
        });
      }
      if (node.children) {
        const children = [];
        let siblingMask, uncertainSiblingMask = false;
        for (const child of node.children) {
          if (child.isMask) {
            uncertainSiblingMask = child.visible === false || !validBounds(child.absoluteBoundingBox);
            siblingMask = !uncertainSiblingMask ? { id: child.id, bounds: child.absoluteBoundingBox, safe: safeMask(child) } : void 0;
            children.push({ node: child, frame: entry.frame, parentId: node.id, clips, masks: entry.masks, safeAncestors: false, maskContent: true });
          } else children.push({
            node: child,
            frame: entry.frame,
            parentId: node.id,
            clips,
            masks: siblingMask ? [...entry.masks, siblingMask] : entry.masks,
            safeAncestors: entry.safeAncestors && normal(node) && !uncertainSiblingMask,
            maskContent: false
          });
        }
        for (let index = children.length - 1; index >= 0; index--) stack.push(children[index]);
      }
    }
    return { layers, scannedImages, scannedNodes, warnings };
  }
  async function findLayerCandidates(layers, options = {}) {
    var _a, _b, _c, _d, _e, _f;
    const maxCandidates = Math.min(200, (_a = options.maxCandidates) != null ? _a : 200), deadline = (_b = options.deadline) != null ? _b : Date.now() + 1e4;
    const candidates = [], warnings = [];
    const groups = /* @__PURE__ */ new Map();
    for (const layer of layers) {
      const group = (_c = groups.get(layer.frameId)) != null ? _c : [];
      group.push(layer);
      groups.set(layer.frameId, group);
    }
    let comparisons = 0, stopped = false;
    for (const group of groups.values()) {
      for (let index = 0; index < group.length && !stopped; index++) {
        const lower = group[index];
        for (let upperIndex = index + 1; upperIndex < group.length; upperIndex++) {
          (_d = options.checkCurrent) == null ? void 0 : _d.call(options);
          comparisons++;
          if (comparisons > 1e6 || Date.now() >= deadline || candidates.length >= maxCandidates) {
            stopped = true;
            break;
          }
          const upper = group[upperIndex];
          if (lower.id === upper.id) continue;
          const overlap = intersection(lower.visibleBounds, upper.visibleBounds);
          if (!overlap) continue;
          const area = overlap.width * overlap.height, lowArea = lower.visibleBounds.width * lower.visibleBounds.height, upArea = upper.visibleBounds.width * upper.visibleBounds.height;
          const iou = area / (lowArea + upArea - area), intersectionRatio = area / Math.min(lowArea, upArea);
          const dx = Math.abs(lower.visibleBounds.x - upper.visibleBounds.x), dy = Math.abs(lower.visibleBounds.y - upper.visibleBounds.y);
          const tolerance = Math.max(8, 0.02 * Math.max(lower.visibleBounds.width, lower.visibleBounds.height, upper.visibleBounds.width, upper.visibleBounds.height));
          if (!(iou >= 0.75 || intersectionRatio > 0.9 && dx <= tolerance && dy <= tolerance)) continue;
          const sameAsset = lower.imageHash === upper.imageHash, sameMask = lower.maskKey === upper.maskKey;
          candidates.push({
            id: lower.id,
            coverId: upper.id,
            frameId: lower.frameId,
            frameName: lower.frameName,
            name: lower.name,
            coverName: upper.name,
            reason: sameAsset ? "Comparten la misma imagen fuente y se superponen; esto no demuestra que una capa sea invisible." : "Las im\xE1genes se superponen y tienen una posici\xF3n o \xE1rea muy similar. Revisa ambas antes de excluir una.",
            confidence: "possible",
            bounds: lower.bounds,
            coverBounds: upper.bounds,
            visibleBounds: lower.visibleBounds,
            coverVisibleBounds: upper.visibleBounds,
            iou,
            intersectionRatio,
            dx,
            dy,
            sameAsset,
            sameMask,
            paintOrder: lower.paintOrder,
            coverPaintOrder: upper.paintOrder
          });
        }
      }
    }
    if (stopped) warnings.push("Se alcanz\xF3 un l\xEDmite de revisi\xF3n; se muestran como m\xE1ximo 200 coincidencias.");
    const jpegDeadline = Math.min(deadline, (_e = options.jpegDeadline) != null ? _e : Date.now() + 2e3);
    for (const candidate of candidates) {
      (_f = options.checkCurrent) == null ? void 0 : _f.call(options);
      if (Date.now() >= jpegDeadline) {
        warnings.push("Algunas fuentes no pudieron comprobarse dentro del tiempo disponible.");
        break;
      }
      const lower = layers.find((layer) => layer.id === candidate.id), upper = layers.find((layer) => layer.id === candidate.coverId);
      const geometrySafe = sameContext(lower, upper) && lower.nodeSafe && lower.ancestorsSafe && upper.nodeSafe && upper.ancestorsSafe && lower.masksSafe && upper.masksSafe && upper.rectangular && upper.coverPaintSafe && contains(upper.bounds, lower.visibleBounds);
      if (geometrySafe && options.isJpegOpaque && await options.isJpegOpaque(upper.imageHash, jpegDeadline)) {
        candidate.confidence = "geometry-covered";
        candidate.reason = "La imagen superior es un JPEG opaco al 100 % y cubre toda el \xE1rea visible de la inferior, con el mismo recorte y sin efectos. Es una comprobaci\xF3n geom\xE9trica; falta comparar los p\xEDxeles exportados.";
      }
    }
    return { candidates, warnings };
  }
  function sameContext(lower, upper) {
    return lower.parentId === upper.parentId && lower.maskKey === upper.maskKey;
  }
  async function auditImageLayers(roots, options = {}) {
    var _a;
    const deadline = (_a = options.deadline) != null ? _a : Date.now() + 1e4;
    const collected = collectImageLayers(roots, __spreadProps(__spreadValues({}, options), { deadline }));
    const compared = await findLayerCandidates(collected.layers, __spreadProps(__spreadValues({}, options), { deadline }));
    return { candidates: compared.candidates, scannedImages: collected.scannedImages, scannedNodes: collected.scannedNodes, warnings: [...collected.warnings, ...compared.warnings] };
  }

  // src/plugin.ts
  var CancelledError = class extends Error {
    constructor() {
      super("Exportaci\xF3n cancelada.");
      this.name = "CancelledError";
    }
  };
  var MAX_PAGES = 200;
  var REPLY_TIMEOUT_MS = 18e4;
  var MAX_WARNINGS = 16;
  var PAGE_ROOT_TYPES = /* @__PURE__ */ new Set(["FRAME", "GROUP", "INSTANCE", "COMPONENT", "COMPONENT_SET"]);
  var activeJob = null;
  var scope = "selection";
  var activeAuditRequest = null;
  var activeAuditGeneration = 0;
  var pendingFocusSelection = null;
  var jpegOpacityCache = /* @__PURE__ */ new Map();
  figma.showUI(__html__, { width: 460, height: 800, themeColors: true });
  function post(message) {
    figma.ui.postMessage(message);
  }
  function record(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
  function messageError(error) {
    return error instanceof Error ? error.message : String(error);
  }
  function warn(job, warning) {
    if (job.stats.warnings.length < MAX_WARNINGS && !job.stats.warnings.includes(warning)) {
      job.stats.warnings.push(warning);
    }
  }
  function isExportNode(node) {
    return node.type !== "DOCUMENT" && node.type !== "PAGE" && node.type !== "SECTION" && "exportAsync" in node && "absoluteTransform" in node && "width" in node && "height" in node && Number.isFinite(node.width) && Number.isFinite(node.height) && node.width > 0 && node.height > 0;
  }
  function expandSections(nodes, pageScope) {
    const result = [];
    const stack = [...nodes].reverse();
    while (stack.length) {
      const node = stack.pop();
      if (node.removed || pageScope && !node.visible) continue;
      if (node.type === "SECTION") {
        for (let index = node.children.length - 1; index >= 0; index--) stack.push(node.children[index]);
      } else if (isExportNode(node) && (!pageScope || PAGE_ROOT_TYPES.has(node.type))) result.push(node);
    }
    return result;
  }
  function withoutAncestorDuplicates(nodes) {
    const ids = new Set(nodes.map((node) => node.id));
    const emitted = /* @__PURE__ */ new Set();
    return nodes.filter((node) => {
      if (emitted.has(node.id)) return false;
      emitted.add(node.id);
      let parent = node.parent;
      while (parent && parent.type !== "PAGE" && parent.type !== "DOCUMENT") {
        if (ids.has(parent.id)) return false;
        parent = parent.parent;
      }
      return true;
    });
  }
  function canvasPosition(node) {
    const bounds = node.absoluteBoundingBox;
    if (bounds && Number.isFinite(bounds.x) && Number.isFinite(bounds.y)) return { x: bounds.x, y: bounds.y };
    const transform = node.absoluteTransform;
    return { x: transform[0][2], y: transform[1][2] };
  }
  function canvasOrdered(nodes) {
    return nodes.map((node, index) => __spreadValues({ node, index }, canvasPosition(node))).sort((a, b) => a.y - b.y || a.x - b.x || a.index - b.index);
  }
  function publishFrames() {
    if (activeJob) return;
    const nodes = scope === "selection" ? figma.currentPage.selection : figma.currentPage.children;
    const frames = canvasOrdered(withoutAncestorDuplicates(expandSections(nodes, scope === "page")));
    post({
      type: "frames",
      frames: frames.map(({ node, x, y }) => ({ id: node.id, name: node.name, width: node.width, height: node.height, x, y })),
      documentName: figma.root.name,
      pageName: figma.currentPage.name,
      orderPolicy: "canvas-top-to-bottom-left-to-right"
    });
  }
  function ensureActive(job) {
    if (job.cancelled || activeJob !== job) throw new CancelledError();
  }
  function cancel(job) {
    job.cancelled = true;
    for (const pending of job.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new CancelledError());
    }
    job.pending.clear();
  }
  function waitForReply(job, key, outgoing) {
    ensureActive(job);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        job.pending.delete(key);
        reject(new Error("La interfaz tard\xF3 demasiado en responder. Vuelve a intentar la exportaci\xF3n."));
      }, REPLY_TIMEOUT_MS);
      job.pending.set(key, { resolve, reject, timer });
      try {
        post(outgoing);
      } catch (error) {
        clearTimeout(timer);
        job.pending.delete(key);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
  function resolveReply(message) {
    const job = activeJob;
    if (!job || job.cancelled || message.jobId !== job.id) return;
    if (message.type !== "page-ack" || !Number.isInteger(message.index)) return;
    const key = `page:${message.index}`;
    const pending = job.pending.get(key);
    if (!pending) return;
    clearTimeout(pending.timer);
    job.pending.delete(key);
    if (typeof message.error === "string" && message.error.length) pending.reject(new Error(message.error));
    else pending.resolve(message);
  }
  function progress(job, label, current, total) {
    ensureActive(job);
    post({ type: "progress", jobId: job.id, label, current, total });
  }
  function pageOf(node) {
    let current = node;
    while (current && current.type !== "PAGE") current = current.parent;
    return (current == null ? void 0 : current.type) === "PAGE" ? current : null;
  }
  function exportDimensions(node) {
    const bounds = node.absoluteBoundingBox;
    if (bounds && bounds.width > 0 && bounds.height > 0) return { width: bounds.width, height: bounds.height };
    return { width: node.width, height: node.height };
  }
  function validatedRequest(message) {
    if (!Array.isArray(message.ids) || !message.ids.length || message.ids.length > MAX_PAGES || !message.ids.every((id) => typeof id === "string" && id.length > 0 && id.length <= 128)) {
      throw new Error(`Elige entre 1 y ${MAX_PAGES} p\xE1ginas para exportar.`);
    }
    if (message.mode !== "compact" && message.mode !== "hybrid" && message.mode !== "native") {
      throw new Error("Selecciona un modo de exportaci\xF3n v\xE1lido.");
    }
    if (typeof message.scale !== "number" || !Number.isFinite(message.scale) || message.scale <= 0 || message.scale > 8) {
      throw new Error("La escala debe ser mayor que 0 y menor o igual a 8.");
    }
    if (typeof message.quality !== "number" || !Number.isInteger(message.quality) || message.quality < 40 || message.quality > 100) {
      throw new Error("La calidad debe ser un porcentaje entero entre 40 y 100.");
    }
    return { ids: [...new Set(message.ids)], mode: message.mode, scale: message.scale, quality: message.quality };
  }
  async function exportDocument(message) {
    var _a;
    const jobId = typeof message.jobId === "string" ? message.jobId : "";
    if (!jobId || jobId.length > 128) {
      post({ type: "error", jobId, message: "Identificador de exportaci\xF3n inv\xE1lido." });
      return;
    }
    if (activeJob) {
      post({ type: "error", jobId, message: "Ya hay una exportaci\xF3n en curso. Espera a que termine o canc\xE9lala." });
      return;
    }
    const job = {
      id: jobId,
      page: figma.currentPage,
      cancelled: false,
      pending: /* @__PURE__ */ new Map(),
      stats: { optimizedImages: 0, skippedImages: 0, originalImageBytes: 0, optimizedImageBytes: 0, warnings: [] }
    };
    activeJob = job;
    try {
      const { ids, mode, scale } = validatedRequest(message);
      const nodes = [];
      for (const id of ids) {
        ensureActive(job);
        const node = await figma.getNodeByIdAsync(id);
        ensureActive(job);
        if (!node || node.removed || !isExportNode(node) || ((_a = pageOf(node)) == null ? void 0 : _a.id) !== job.page.id) {
          throw new Error("Una capa ya no existe o no pertenece a esta p\xE1gina. Actualiza la selecci\xF3n.");
        }
        nodes.push(node);
      }
      for (let index = 0; index < nodes.length; index++) {
        const node = nodes[index];
        ensureActive(job);
        if (node.removed) throw new Error("Una capa fue eliminada durante la exportaci\xF3n.");
        progress(job, `Exportando ${node.name}`, index + 1, nodes.length);
        const dimensions = exportDimensions(node);
        const size = cappedRasterSize(dimensions.width, dimensions.height, scale);
        if (mode === "compact" && size.scale < scale - 1e-6) {
          warn(job, "Se ajust\xF3 la resoluci\xF3n de p\xE1ginas grandes al l\xEDmite de 8192 px por lado y 24 megap\xEDxeles.");
        }
        const bytes = mode === "compact" ? await node.exportAsync({ format: "PNG", constraint: { type: "SCALE", value: size.scale }, contentsOnly: true, useAbsoluteBounds: true, colorProfile: "SRGB" }) : await node.exportAsync({ format: "PDF", contentsOnly: true, useAbsoluteBounds: true, colorProfile: "SRGB" });
        ensureActive(job);
        await waitForReply(job, `page:${index}`, {
          type: "page",
          jobId: job.id,
          index,
          total: nodes.length,
          id: node.id,
          name: node.name,
          width: dimensions.width,
          height: dimensions.height,
          format: mode === "compact" ? "png" : "pdf",
          bytes
        });
      }
      ensureActive(job);
      post({
        type: "done",
        jobId: job.id,
        stats: job.stats,
        // IDs arrive in the UI's reviewed order. Never sort them during export.
        pageOrder: nodes.map((node, index) => ({ index, id: node.id, name: node.name }))
      });
    } catch (error) {
      if (error instanceof CancelledError || job.cancelled) post({ type: "cancelled", jobId: job.id });
      else post({ type: "error", jobId: job.id, message: messageError(error) });
    } finally {
      for (const pending of job.pending.values()) clearTimeout(pending.timer);
      job.pending.clear();
      if (activeJob === job) activeJob = null;
    }
  }
  async function verifiedJpeg(hash, deadline) {
    if (Date.now() >= deadline) return false;
    let cached = jpegOpacityCache.get(hash);
    if (!cached) {
      cached = (async () => {
        try {
          const image = figma.getImageByHash(hash);
          if (!image) return false;
          const bytes = await image.getBytesAsync();
          return bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
        } catch (e) {
          return false;
        }
      })();
      if (jpegOpacityCache.size >= 256) jpegOpacityCache.delete(jpegOpacityCache.keys().next().value);
      jpegOpacityCache.set(hash, cached);
    }
    let timer;
    try {
      return await Promise.race([cached, new Promise((resolve) => {
        timer = setTimeout(() => resolve(false), Math.max(1, deadline - Date.now()));
      })]);
    } finally {
      if (timer !== void 0) clearTimeout(timer);
    }
  }
  async function auditLayers(message) {
    var _a;
    const requestId = typeof message.requestId === "string" ? message.requestId : "";
    if (!requestId || requestId.length > 128) return;
    const generation = ++activeAuditGeneration;
    activeAuditRequest = requestId;
    const pageId = figma.currentPage.id, deadline = Date.now() + 1e4;
    const checkCurrent = () => {
      if (activeAuditRequest !== requestId || activeAuditGeneration !== generation || figma.currentPage.id !== pageId) throw new CancelledError();
      if (Date.now() >= deadline) throw new Error("La revisi\xF3n alcanz\xF3 el l\xEDmite de diez segundos. Prueba con menos p\xE1ginas.");
    };
    try {
      if (activeJob) throw new Error("Espera a que termine la exportaci\xF3n para revisar las capas.");
      if (!Array.isArray(message.ids) || !message.ids.length || message.ids.length > MAX_PAGES || !message.ids.every((id) => typeof id === "string" && id.length > 0 && id.length <= 128)) {
        throw new Error("Selecciona entre 1 y 200 p\xE1ginas para revisar sus im\xE1genes.");
      }
      const roots = [];
      for (const id of new Set(message.ids)) {
        checkCurrent();
        const node = await figma.getNodeByIdAsync(id);
        checkCurrent();
        if (!node || node.removed || !isExportNode(node) || ((_a = pageOf(node)) == null ? void 0 : _a.id) !== pageId) throw new Error("Una p\xE1gina ya no est\xE1 disponible. Actualiza la lista y vuelve a revisar.");
        roots.push(node);
      }
      const result = await auditImageLayers(roots, { deadline, checkCurrent, isJpegOpaque: verifiedJpeg });
      checkCurrent();
      post(__spreadValues({ type: "layer-audit", requestId }, result));
    } catch (error) {
      if (activeAuditRequest === requestId && activeAuditGeneration === generation && !(error instanceof CancelledError)) {
        post({ type: "layer-audit", requestId, candidates: [], scannedImages: 0, error: messageError(error), warnings: [] });
      }
    } finally {
      if (activeAuditRequest === requestId && activeAuditGeneration === generation) activeAuditRequest = null;
    }
  }
  async function focusNode(message) {
    var _a;
    if (activeJob || typeof message.id !== "string" || message.id.length > 128) return;
    const node = await figma.getNodeByIdAsync(message.id);
    if (!node || node.removed || !isExportNode(node) || ((_a = pageOf(node)) == null ? void 0 : _a.id) !== figma.currentPage.id) return;
    const selected = figma.currentPage.selection;
    if (selected.length !== 1 || selected[0].id !== node.id) {
      pendingFocusSelection = node.id;
      try {
        figma.currentPage.selection = [node];
      } catch (e) {
        pendingFocusSelection = null;
        return;
      }
    }
    figma.viewport.scrollAndZoomIntoView([node]);
  }
  figma.ui.onmessage = (message) => {
    if (!record(message)) return;
    if (message.type === "refresh") {
      activeAuditRequest = null;
      if (message.scope === "selection" || message.scope === "page") scope = message.scope;
      publishFrames();
    } else if (message.type === "export") {
      activeAuditRequest = null;
      void exportDocument(message);
    } else if (message.type === "audit-layers") {
      void auditLayers(message);
    } else if (message.type === "focus-node") {
      void focusNode(message);
    } else if (message.type === "page-ack") {
      resolveReply(message);
    } else if (message.type === "cancel" && activeJob && message.jobId === activeJob.id) {
      cancel(activeJob);
    }
  };
  figma.on("selectionchange", () => {
    if (pendingFocusSelection) {
      const expected = pendingFocusSelection;
      pendingFocusSelection = null;
      if (figma.currentPage.selection.length === 1 && figma.currentPage.selection[0].id === expected) return;
    }
    if (scope === "selection") publishFrames();
  });
  figma.on("currentpagechange", () => {
    activeAuditRequest = null;
    pendingFocusSelection = null;
    if (activeJob) cancel(activeJob);
    else publishFrames();
  });
  figma.on("close", () => {
    activeAuditRequest = null;
    pendingFocusSelection = null;
    if (!activeJob) return;
    cancel(activeJob);
  });
  publishFrames();
})();
