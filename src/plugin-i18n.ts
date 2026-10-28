export type PluginLocale = 'en' | 'es' | 'pt';
export type LanguagePreference = 'auto' | PluginLocale;

const en = {
  cancelled: 'Export cancelled.',
  replyTimeout: 'The interface took too long to respond. Try exporting again.',
  pageCount: 'Choose between 1 and {max} pages to export.',
  invalidMode: 'Select a valid export mode.',
  invalidScale: 'Scale must be greater than 0 and no greater than 8.',
  invalidQuality: 'Quality must be a whole percentage between 40 and 100.',
  invalidJobId: 'Invalid export identifier.',
  busy: 'An export is already in progress. Wait for it to finish or cancel it.',
  missingLayer: 'A layer no longer exists or does not belong to this page. Refresh the selection.',
  removedLayer: 'A layer was deleted during export.',
  exporting: 'Exporting {name}',
  rasterLimit: 'Large pages were limited to 8192 pixels per side and 24 megapixels.',
  auditTimeout: 'The review reached the ten-second limit. Try fewer pages.',
  auditBusy: 'Wait for the export to finish before reviewing layers.',
  auditPageCount: 'Select between 1 and 200 pages to review their images.',
  auditMissingPage: 'A page is no longer available. Refresh the list and try the review again.',
  auditPartial: 'The time limit was reached; this review is partial.',
  auditNodeLimit: 'At most 10,000 nodes were reviewed; select fewer pages to complete the analysis.',
  auditCandidateLimit: 'A review limit was reached; at most 200 matches are shown.',
  auditSourceTimeout: 'Some source images could not be checked within the available time.',
  auditSameAsset: 'They share the same source image and overlap; this does not prove that either layer is invisible.',
  auditOverlap: 'The images overlap and have a very similar position or area. Review both before excluding either one.',
  auditCovered: 'The upper image is a fully opaque JPEG and covers the entire visible area of the lower image, with the same clipping and no effects. This is a geometric check; the exported pixels still need to be compared.',
  widthPositive: 'Width must be a positive number.',
  heightPositive: 'Height must be a positive number.',
  scalePositive: 'Scale must be a positive number.',
  edgePositive: 'The side limit must be a positive number.',
  pixelsPositive: 'The pixel limit must be a positive number.',
} as const;

export type PluginTextKey = keyof typeof en;

const es: Record<PluginTextKey, string> = {
  cancelled: 'Exportación cancelada.',
  replyTimeout: 'La interfaz tardó demasiado en responder. Vuelve a intentar la exportación.',
  pageCount: 'Elige entre 1 y {max} páginas para exportar.',
  invalidMode: 'Selecciona un modo de exportación válido.',
  invalidScale: 'La escala debe ser mayor que 0 y menor o igual a 8.',
  invalidQuality: 'La calidad debe ser un porcentaje entero entre 40 y 100.',
  invalidJobId: 'Identificador de exportación inválido.',
  busy: 'Ya hay una exportación en curso. Espera a que termine o cancélala.',
  missingLayer: 'Una capa ya no existe o no pertenece a esta página. Actualiza la selección.',
  removedLayer: 'Una capa fue eliminada durante la exportación.',
  exporting: 'Exportando {name}',
  rasterLimit: 'Se ajustó la resolución de páginas grandes al límite de 8192 px por lado y 24 megapíxeles.',
  auditTimeout: 'La revisión alcanzó el límite de diez segundos. Prueba con menos páginas.',
  auditBusy: 'Espera a que termine la exportación para revisar las capas.',
  auditPageCount: 'Selecciona entre 1 y 200 páginas para revisar sus imágenes.',
  auditMissingPage: 'Una página ya no está disponible. Actualiza la lista y vuelve a revisar.',
  auditPartial: 'Se alcanzó el límite de tiempo; la revisión es parcial.',
  auditNodeLimit: 'Se revisaron como máximo 10.000 nodos; usa una selección menor para completar el análisis.',
  auditCandidateLimit: 'Se alcanzó un límite de revisión; se muestran como máximo 200 coincidencias.',
  auditSourceTimeout: 'Algunas fuentes no pudieron comprobarse dentro del tiempo disponible.',
  auditSameAsset: 'Comparten la misma imagen fuente y se superponen; esto no demuestra que una capa sea invisible.',
  auditOverlap: 'Las imágenes se superponen y tienen una posición o área muy similar. Revisa ambas antes de excluir una.',
  auditCovered: 'La imagen superior es un JPEG opaco al 100 % y cubre toda el área visible de la inferior, con el mismo recorte y sin efectos. Es una comprobación geométrica; falta comparar los píxeles exportados.',
  widthPositive: 'El ancho debe ser un número positivo.',
  heightPositive: 'El alto debe ser un número positivo.',
  scalePositive: 'La escala debe ser un número positivo.',
  edgePositive: 'El límite de lado debe ser un número positivo.',
  pixelsPositive: 'El límite de píxeles debe ser un número positivo.',
};

const pt: Record<PluginTextKey, string> = {
  cancelled: 'Exportação cancelada.',
  replyTimeout: 'A interface demorou demais para responder. Tente exportar novamente.',
  pageCount: 'Escolha entre 1 e {max} páginas para exportar.',
  invalidMode: 'Selecione um modo de exportação válido.',
  invalidScale: 'A escala deve ser maior que 0 e menor ou igual a 8.',
  invalidQuality: 'A qualidade deve ser uma porcentagem inteira entre 40 e 100.',
  invalidJobId: 'Identificador de exportação inválido.',
  busy: 'Já existe uma exportação em andamento. Aguarde a conclusão ou cancele-a.',
  missingLayer: 'Uma camada não existe mais ou não pertence a esta página. Atualize a seleção.',
  removedLayer: 'Uma camada foi excluída durante a exportação.',
  exporting: 'Exportando {name}',
  rasterLimit: 'A resolução de páginas grandes foi limitada a 8192 pixels por lado e 24 megapixels.',
  auditTimeout: 'A revisão atingiu o limite de dez segundos. Tente menos páginas.',
  auditBusy: 'Aguarde a conclusão da exportação antes de revisar as camadas.',
  auditPageCount: 'Selecione entre 1 e 200 páginas para revisar suas imagens.',
  auditMissingPage: 'Uma página não está mais disponível. Atualize a lista e tente revisar novamente.',
  auditPartial: 'O limite de tempo foi atingido; esta revisão é parcial.',
  auditNodeLimit: 'Foram revisados no máximo 10.000 nós; selecione menos páginas para concluir a análise.',
  auditCandidateLimit: 'Um limite de revisão foi atingido; são exibidas no máximo 200 correspondências.',
  auditSourceTimeout: 'Algumas imagens de origem não puderam ser verificadas no tempo disponível.',
  auditSameAsset: 'Elas compartilham a mesma imagem de origem e se sobrepõem; isso não prova que alguma camada seja invisível.',
  auditOverlap: 'As imagens se sobrepõem e têm uma posição ou área muito semelhante. Revise ambas antes de excluir uma delas.',
  auditCovered: 'A imagem superior é um JPEG totalmente opaco e cobre toda a área visível da imagem inferior, com o mesmo recorte e sem efeitos. Esta é uma verificação geométrica; ainda é necessário comparar os pixels exportados.',
  widthPositive: 'A largura deve ser um número positivo.',
  heightPositive: 'A altura deve ser um número positivo.',
  scalePositive: 'A escala deve ser um número positivo.',
  edgePositive: 'O limite de lado deve ser um número positivo.',
  pixelsPositive: 'O limite de pixels deve ser um número positivo.',
};

export const pluginMessages: Record<PluginLocale, Readonly<Record<PluginTextKey, string>>> = { en, es, pt };

export function isPluginLocale(value: unknown): value is PluginLocale {
  return value === 'en' || value === 'es' || value === 'pt';
}

export function isLanguagePreference(value: unknown): value is LanguagePreference {
  return value === 'auto' || isPluginLocale(value);
}

export function isPluginTextKey(value: unknown): value is PluginTextKey {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(en, value);
}

export function pluginText(locale: PluginLocale, key: PluginTextKey, values: Record<string, string | number> = {}): string {
  return pluginMessages[locale][key].replace(/\{(\w+)\}/g, (token, name: string) => values[name] === undefined ? token : String(values[name]));
}

// Geometry and the read-only audit still return fixed diagnostic strings.
// Translate known product messages at the controller boundary. Keep opaque
// Figma/UI errors intact instead of guessing at their language or meaning.
const knownMessages = new Map<string, PluginTextKey>();
for (const messages of Object.values(pluginMessages)) {
  for (const key of Object.keys(en) as PluginTextKey[]) knownMessages.set(messages[key], key);
}

export function translateKnownPluginMessage(locale: PluginLocale, message: string): string {
  const key = knownMessages.get(message);
  if (key) return pluginText(locale, key);
  for (const messages of Object.values(pluginMessages)) {
    const [start, end] = messages.pageCount.split('{max}');
    if (!message.startsWith(start) || !message.endsWith(end)) continue;
    const max = message.slice(start.length, message.length - end.length);
    if (/^\d+$/.test(max)) return pluginText(locale, 'pageCount', { max });
  }
  return message;
}
