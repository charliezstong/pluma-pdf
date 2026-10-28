export type Bounds = { x: number; y: number; width: number; height: number };
export type AuditPaint = { type: string; visible?: boolean; opacity?: number; blendMode?: string; imageHash?: string | null; scaleMode?: string; rotation?: number; filters?: object };
export interface AuditNode {
  id: string; name: string; type: string; visible?: boolean; opacity?: number; blendMode?: string;
  width?: number; height?: number; absoluteBoundingBox?: Bounds | null;
  absoluteTransform?: readonly (readonly number[])[]; fills?: readonly AuditPaint[] | symbol;
  strokes?: readonly unknown[] | symbol; effects?: readonly { visible?: boolean }[];
  children?: readonly AuditNode[]; isMask?: boolean; maskType?: string; clipsContent?: boolean;
  cornerRadius?: number | symbol; topLeftRadius?: number; topRightRadius?: number; bottomLeftRadius?: number; bottomRightRadius?: number;
}
interface Context { id: string; bounds: Bounds; safe: boolean }
export interface ImageLayer {
  id: string; name: string; frameId: string; frameName: string; parentId: string;
  bounds: Bounds; visibleBounds: Bounds; paintOrder: number; imageHash: string;
  maskKey: string; masksSafe: boolean; rectangular: boolean; ancestorsSafe: boolean;
  nodeSafe: boolean; coverPaintSafe: boolean;
}
export interface LayerCandidate {
  id: string; coverId: string; frameId: string; frameName: string; name: string; coverName: string;
  reason: string; confidence: 'possible' | 'geometry-covered'; bounds: Bounds; coverBounds: Bounds;
  visibleBounds: Bounds; coverVisibleBounds: Bounds; iou: number; intersectionRatio: number;
  dx: number; dy: number; sameAsset: boolean; sameMask: boolean; paintOrder: number; coverPaintOrder: number;
}
export interface AuditOptions {
  maxNodes?: number; maxCandidates?: number; deadline?: number; jpegDeadline?: number;
  checkCurrent?: () => void; isJpegOpaque?: (hash: string, deadline: number) => Promise<boolean>;
}

function validBounds(value: Bounds | null | undefined): value is Bounds {
  return Boolean(value && [value.x, value.y, value.width, value.height].every(Number.isFinite) && value.width > 0 && value.height > 0);
}
function intersection(a: Bounds, b: Bounds): Bounds | undefined {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const width = Math.min(a.x + a.width, b.x + b.width) - x, height = Math.min(a.y + a.height, b.y + b.height) - y;
  return width > 0 && height > 0 ? { x, y, width, height } : undefined;
}
function contains(outer: Bounds, inner: Bounds): boolean {
  const epsilon = 1e-6;
  return outer.x <= inner.x + epsilon && outer.y <= inner.y + epsilon
    && outer.x + outer.width >= inner.x + inner.width - epsilon && outer.y + outer.height >= inner.y + inner.height - epsilon;
}
function visiblePaints(node: AuditNode): readonly AuditPaint[] {
  return Array.isArray(node.fills) ? node.fills.filter(paint => paint.visible !== false) : [];
}
function noEffects(node: AuditNode): boolean { return !(node.effects ?? []).some(effect => effect.visible !== false); }
function normal(node: AuditNode): boolean { return (node.opacity ?? 1) === 1 && ['NORMAL', 'PASS_THROUGH'].includes(node.blendMode ?? 'NORMAL') && noEffects(node); }
function translationOnly(node: AuditNode): boolean {
  const t = node.absoluteTransform;
  return Boolean(t && t.length === 2 && t[0].length === 3 && t[1].length === 3
    && Math.abs(t[0][0] - 1) < 1e-8 && Math.abs(t[1][1] - 1) < 1e-8 && Math.abs(t[0][1]) < 1e-8 && Math.abs(t[1][0]) < 1e-8);
}
function rectangular(node: AuditNode): boolean {
  return node.type === 'RECTANGLE' && translationOnly(node) && (node.cornerRadius === 0
    || [node.topLeftRadius, node.topRightRadius, node.bottomLeftRadius, node.bottomRightRadius].every(radius => radius === 0));
}
function safeMask(node: AuditNode): boolean {
  const paints = visiblePaints(node);
  return node.type === 'RECTANGLE' && translationOnly(node) && normal(node) && node.maskType === 'ALPHA'
    && paints.length === 1 && paints[0].type === 'SOLID' && (paints[0].opacity ?? 1) === 1;
}
function safeImagePaint(node: AuditNode, paints: readonly AuditPaint[]): boolean {
  if (paints.length !== 1 || paints[0].type !== 'IMAGE') return false;
  const paint = paints[0];
  return normal(node) && (node.strokes === undefined || (Array.isArray(node.strokes) && node.strokes.length === 0))
    && (paint.opacity ?? 1) === 1 && (paint.blendMode ?? 'NORMAL') === 'NORMAL' && paint.scaleMode === 'FILL'
    && (paint.rotation ?? 0) % 360 === 0 && (!paint.filters || Object.values(paint.filters).every(value => value === 0));
}

/** Read geometry only. Mask clipping is an upper bound, never a pixel proof. */
export function collectImageLayers(roots: readonly AuditNode[], options: AuditOptions = {}): { layers: ImageLayer[]; scannedImages: number; scannedNodes: number; warnings: string[] } {
  const maxNodes = Math.min(10_000, options.maxNodes ?? 10_000), deadline = options.deadline ?? Date.now() + 10_000;
  const warnings: string[] = [], layers: ImageLayer[] = [];
  let scannedNodes = 0, scannedImages = 0, paintOrder = 0;
  type Entry = { node: AuditNode; frame: AuditNode; parentId: string; clips: Context[]; masks: Context[]; safeAncestors: boolean; maskContent: boolean };
  const stack: Entry[] = roots.map(frame => ({ node: frame, frame, parentId: '', clips: [], masks: [], safeAncestors: true, maskContent: false })).reverse();
  while (stack.length) {
    options.checkCurrent?.();
    if (Date.now() >= deadline) { warnings.push('Se alcanzó el límite de tiempo; la revisión es parcial.'); break; }
    if (scannedNodes >= maxNodes) { warnings.push('Se revisaron como máximo 10.000 nodos; usa una selección menor para completar el análisis.'); break; }
    const entry = stack.pop()!, node = entry.node; scannedNodes++; paintOrder++;
    if (node.visible === false || entry.maskContent) continue;
    let clips = entry.clips;
    if (node.clipsContent && validBounds(node.absoluteBoundingBox)) clips = [...clips, { id: node.id, bounds: node.absoluteBoundingBox, safe: translationOnly(node) }];
    const paints = visiblePaints(node), imagePaints = paints.filter(paint => paint.type === 'IMAGE' && paint.imageHash);
    scannedImages += imagePaints.length;
    if (imagePaints.length && validBounds(node.absoluteBoundingBox) && !node.isMask) {
      const bounds = { ...node.absoluteBoundingBox };
      let visibleBounds: Bounds | undefined = bounds;
      for (const context of [...clips, ...entry.masks]) { if (visibleBounds) visibleBounds = intersection(visibleBounds, context.bounds); }
      if (visibleBounds) layers.push({
        id: node.id, name: node.name, frameId: entry.frame.id, frameName: entry.frame.name, parentId: entry.parentId,
        bounds, visibleBounds, paintOrder, imageHash: imagePaints[0].imageHash!,
        maskKey: [...clips, ...entry.masks].map(context => context.id).join('|'),
        masksSafe: [...clips, ...entry.masks].every(context => context.safe), rectangular: rectangular(node),
        ancestorsSafe: entry.safeAncestors, nodeSafe: normal(node), coverPaintSafe: safeImagePaint(node, paints),
      });
    }
    if (node.children) {
      const children: Entry[] = []; let siblingMask: Context | undefined, uncertainSiblingMask = false;
      for (const child of node.children) {
        if (child.isMask) {
          // A hidden/invalid mask can change where a previous sibling mask
          // stops. Do not infer opaque coverage from that ambiguous context.
          uncertainSiblingMask = child.visible === false || !validBounds(child.absoluteBoundingBox);
          siblingMask = !uncertainSiblingMask ? { id: child.id, bounds: child.absoluteBoundingBox!, safe: safeMask(child) } : undefined;
          children.push({ node: child, frame: entry.frame, parentId: node.id, clips, masks: entry.masks, safeAncestors: false, maskContent: true });
        } else children.push({ node: child, frame: entry.frame, parentId: node.id, clips,
          masks: siblingMask ? [...entry.masks, siblingMask] : entry.masks, safeAncestors: entry.safeAncestors && normal(node) && !uncertainSiblingMask, maskContent: false });
      }
      for (let index = children.length - 1; index >= 0; index--) stack.push(children[index]);
    }
  }
  return { layers, scannedImages, scannedNodes, warnings };
}

/** Build review candidates; identical image hashes do not establish occlusion. */
export async function findLayerCandidates(layers: readonly ImageLayer[], options: AuditOptions = {}): Promise<{ candidates: LayerCandidate[]; warnings: string[] }> {
  const maxCandidates = Math.min(200, options.maxCandidates ?? 200), deadline = options.deadline ?? Date.now() + 10_000;
  const candidates: LayerCandidate[] = [], warnings: string[] = [];
  const groups = new Map<string, ImageLayer[]>();
  for (const layer of layers) { const group = groups.get(layer.frameId) ?? []; group.push(layer); groups.set(layer.frameId, group); }
  let comparisons = 0, stopped = false;
  for (const group of groups.values()) {
    for (let index = 0; index < group.length && !stopped; index++) {
      const lower = group[index];
      for (let upperIndex = index + 1; upperIndex < group.length; upperIndex++) {
        options.checkCurrent?.(); comparisons++;
        if (comparisons > 1_000_000 || Date.now() >= deadline || candidates.length >= maxCandidates) { stopped = true; break; }
        const upper = group[upperIndex];
        if (lower.id === upper.id) continue;
        const overlap = intersection(lower.visibleBounds, upper.visibleBounds);
        if (!overlap) continue;
        const area = overlap.width * overlap.height, lowArea = lower.visibleBounds.width * lower.visibleBounds.height, upArea = upper.visibleBounds.width * upper.visibleBounds.height;
        const iou = area / (lowArea + upArea - area), intersectionRatio = area / Math.min(lowArea, upArea);
        const dx = Math.abs(lower.visibleBounds.x - upper.visibleBounds.x), dy = Math.abs(lower.visibleBounds.y - upper.visibleBounds.y);
        const tolerance = Math.max(8, .02 * Math.max(lower.visibleBounds.width, lower.visibleBounds.height, upper.visibleBounds.width, upper.visibleBounds.height));
        if (!(iou >= .75 || (intersectionRatio > .9 && dx <= tolerance && dy <= tolerance))) continue;
        const sameAsset = lower.imageHash === upper.imageHash, sameMask = lower.maskKey === upper.maskKey;
        candidates.push({
          id: lower.id, coverId: upper.id, frameId: lower.frameId, frameName: lower.frameName, name: lower.name, coverName: upper.name,
          reason: sameAsset ? 'Comparten la misma imagen fuente y se superponen; esto no demuestra que una capa sea invisible.' : 'Las imágenes se superponen y tienen una posición o área muy similar. Revisa ambas antes de excluir una.',
          confidence: 'possible', bounds: lower.bounds, coverBounds: upper.bounds, visibleBounds: lower.visibleBounds, coverVisibleBounds: upper.visibleBounds,
          iou, intersectionRatio, dx, dy, sameAsset, sameMask, paintOrder: lower.paintOrder, coverPaintOrder: upper.paintOrder,
        });
      }
    }
  }
  if (stopped) warnings.push('Se alcanzó un límite de revisión; se muestran como máximo 200 coincidencias.');
  const jpegDeadline = Math.min(deadline, options.jpegDeadline ?? Date.now() + 2000);
  for (const candidate of candidates) {
    options.checkCurrent?.();
    if (Date.now() >= jpegDeadline) { warnings.push('Algunas fuentes no pudieron comprobarse dentro del tiempo disponible.'); break; }
    const lower = layers.find(layer => layer.id === candidate.id)!, upper = layers.find(layer => layer.id === candidate.coverId)!;
    const geometrySafe = sameContext(lower, upper) && lower.nodeSafe && lower.ancestorsSafe && upper.nodeSafe && upper.ancestorsSafe
      && lower.masksSafe && upper.masksSafe && upper.rectangular && upper.coverPaintSafe && contains(upper.bounds, lower.visibleBounds);
    if (geometrySafe && options.isJpegOpaque && await options.isJpegOpaque(upper.imageHash, jpegDeadline)) {
      candidate.confidence = 'geometry-covered';
      candidate.reason = 'La imagen superior es un JPEG opaco al 100 % y cubre toda el área visible de la inferior, con el mismo recorte y sin efectos. Es una comprobación geométrica; falta comparar los píxeles exportados.';
    }
  }
  return { candidates, warnings };
}
function sameContext(lower: ImageLayer, upper: ImageLayer): boolean { return lower.parentId === upper.parentId && lower.maskKey === upper.maskKey; }

export async function auditImageLayers(roots: readonly AuditNode[], options: AuditOptions = {}): Promise<{ candidates: LayerCandidate[]; scannedImages: number; scannedNodes: number; warnings: string[] }> {
  const deadline = options.deadline ?? Date.now() + 10_000;
  const collected = collectImageLayers(roots, { ...options, deadline });
  const compared = await findLayerCandidates(collected.layers, { ...options, deadline });
  return { candidates: compared.candidates, scannedImages: collected.scannedImages, scannedNodes: collected.scannedNodes, warnings: [...collected.warnings, ...compared.warnings] };
}
