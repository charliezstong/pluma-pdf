import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';

// Compile the pure language module in memory; never rebuild the Figma bundle.
const compiled = await build({ entryPoints: ['src/i18n.ts'], bundle: true, format: 'esm', write: false, platform: 'node' });
const { catalogs, normalizeLocale, resolveLocale, isLanguagePreference, interpolate, t } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const locales = ['en', 'es', 'pt'];
const placeholders = template => [...new Set([...template.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map(match => match[1]))].sort();

test('regional language tags normalize case, whitespace and browser or OS separators', () => {
  for (const [input, expected] of [
    ['en', 'en'], ['en-US', 'en'], [' EN-gb ', 'en'], ['en_AU', 'en'],
    ['es', 'es'], ['es-MX', 'es'], ['ES-419', 'es'], [' es_AR ', 'es'],
    ['pt', 'pt'], ['pt-BR', 'pt'], ['PT-pt', 'pt'], [' pt_BR ', 'pt'],
  ]) assert.equal(normalizeLocale(input), expected, input);
  for (const input of ['', ' ', 'fr-FR', 'de', 'enough', 'espanol', 'portuguese']) {
    assert.equal(normalizeLocale(input), undefined, input);
  }
});

test('automatic selection uses the first supported preference and otherwise falls back to English', () => {
  for (const [preferences, expected] of [
    [[], 'en'], [['fr-FR', 'de-DE'], 'en'],
    [['fr-FR', 'es-419', 'pt-BR'], 'es'],
    [['pt-PT', 'en-US', 'es'], 'pt'],
    [['en-NZ', 'es-MX'], 'en'],
    [['zz', 'pt_BR'], 'pt'],
    [['', 'enough', 'espanol', 'es-ES'], 'es'],
  ]) assert.equal(resolveLocale(preferences), expected, JSON.stringify(preferences));
});

test('a supported manual choice takes priority while auto or unknown choices use preferences', () => {
  const preferences = ['pt-BR', 'en-US'];
  for (const [override, expected] of [
    ['en', 'en'], ['es', 'es'], ['pt', 'pt'], ['es-MX', 'es'], [' EN_gb ', 'en'],
    ['auto', 'pt'], [undefined, 'pt'], ['', 'pt'], ['fr-FR', 'pt'],
  ]) assert.equal(resolveLocale(preferences, override), expected, String(override));
  assert.equal(resolveLocale([], 'pt-BR'), 'pt');
  assert.equal(resolveLocale([], 'auto'), 'en');
});

test('locale detection does not reorder or rewrite the caller preferences', () => {
  const preferences = Object.freeze(['fr-FR', 'PT-br', 'es-MX']);
  assert.equal(resolveLocale(preferences), 'pt');
  assert.equal(resolveLocale(preferences, 'es'), 'es');
  assert.deepEqual(preferences, ['fr-FR', 'PT-br', 'es-MX']);
});

test('persisted language choices accept only canonical supported values and auto', () => {
  for (const value of ['auto', 'en', 'es', 'pt']) assert.equal(isLanguagePreference(value), true, value);
  for (const value of [undefined, null, '', 'fr', 'es-MX', 'pt_BR', 'ES', ' en ', 0, false, {}, ['en']]) {
    assert.equal(isLanguagePreference(value), false, String(value));
  }
});

test('English, Spanish and Portuguese catalogs have the same complete nonempty key set', () => {
  assert.deepEqual(Object.keys(catalogs).sort(), [...locales].sort());
  const keys = Object.keys(catalogs.en).sort();
  assert.ok(keys.length > 0, 'the English source catalog must contain actual interface messages');
  for (const locale of locales) {
    assert.deepEqual(Object.keys(catalogs[locale]).sort(), keys, `${locale}: missing or extra messages`);
    for (const key of keys) {
      assert.equal(typeof catalogs[locale][key], 'string', `${locale}: ${key}`);
      assert.ok(catalogs[locale][key].trim().length > 0, `${locale}: empty translation for ${key}`);
    }
  }
  for (const key of keys) assert.equal(catalogs.en[key], key, `English source key: ${key}`);
  for (const locale of ['es', 'pt']) {
    assert.ok(keys.some(key => catalogs[locale][key] !== catalogs.en[key]), `${locale} must not be an English catalog alias`);
  }
});

test('translations preserve every named interpolation variable', () => {
  let templates = 0;
  for (const key of Object.keys(catalogs.en)) {
    const expected = placeholders(catalogs.en[key]);
    if (expected.length) templates++;
    for (const locale of locales) {
      assert.deepEqual(placeholders(catalogs[locale][key]), expected, `${locale}: variables changed in ${key}`);
    }
  }
  assert.ok(templates > 0, 'exercise real parameterized interface messages');
});

test('interpolation preserves zero, empty strings, repeated tokens and unknown variables', () => {
  assert.equal(interpolate('{name}: {count}/{count}; {missing}', { name: '', count: 0 }), ': 0/0; {missing}');
  assert.equal(interpolate('{missing} is unchanged'), '{missing} is unchanged');
  assert.equal(interpolate('A plain label', { unused: 'value' }), 'A plain label');
});

test('replacement values are literal, not replacement patterns or additional templates', () => {
  assert.equal(interpolate('{value} / {value}', { value: '$&' }), '$& / $&');
  assert.equal(interpolate('{value} / {value}', { value: '{other}', other: 'must not replace inserted text' }), '{other} / {other}');
  assert.equal(interpolate('{value}', { value: 'Photo <A> & "B"' }), 'Photo <A> & "B"');
});

test('unknown variables do not resolve inherited object properties', () => {
  assert.equal(interpolate('{toString} {constructor} {hasOwnProperty}', {}), '{toString} {constructor} {hasOwnProperty}');
});

test('translation lookup selects each catalog and interpolates its real parameterized messages', () => {
  const keys = Object.keys(catalogs.en);
  const plain = keys.find(key => placeholders(key).length === 0 && locales.some(locale => catalogs[locale][key] !== key));
  assert.ok(plain, 'exercise an actual translated label');
  for (const locale of locales) assert.equal(t(locale, plain), catalogs[locale][plain], locale);

  const parameterized = keys.find(key => placeholders(key).length > 0);
  assert.ok(parameterized, 'exercise an actual interpolated message');
  const values = Object.fromEntries(placeholders(parameterized).map((name, index) => [name, index === 0 ? 0 : `sample-${index}`]));
  for (const locale of locales) {
    let expected = catalogs[locale][parameterized];
    for (const [name, value] of Object.entries(values)) expected = expected.split(`{${name}}`).join(String(value));
    assert.equal(t(locale, parameterized, values), expected, locale);
  }
});

test('static interface translation bindings reference real catalog messages', async () => {
  const html = await readFile(new URL('../src/ui.html', import.meta.url), 'utf8');
  const bindings = [...html.matchAll(/\b(data-i18n(?:-[a-z-]+)?)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)];
  const supported = new Set(['data-i18n', 'data-i18n-aria-label', 'data-i18n-title', 'data-i18n-alt', 'data-i18n-placeholder']);
  const entities = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: '\u00a0' };
  const decode = value => value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (_token, entity) => {
    if (entity[0] !== '#') return entities[entity.toLowerCase()];
    return String.fromCodePoint(entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10));
  });

  assert.ok(bindings.length > 0, 'the static interface must expose translation bindings');
  for (const binding of bindings) {
    const attribute = binding[1], key = decode(binding[2] ?? binding[3]);
    const line = html.slice(0, binding.index).split('\n').length;
    assert.ok(supported.has(attribute), `ui.html:${line}: unsupported translation attribute ${attribute}`);
    for (const locale of locales) {
      assert.ok(Object.hasOwn(catalogs[locale], key), `ui.html:${line}: ${attribute} references unknown ${locale} key ${JSON.stringify(key)}`);
    }
  }
});
