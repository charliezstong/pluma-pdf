import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../src/ui.html', import.meta.url), 'utf8');
const source = html.match(/<script data-pluma-startup>([\s\S]*?)<\/script>/)?.[1];
assert.ok(source, 'the safety guard must run before the main UI bundle');

function startup({ reducedMotion = false } = {}) {
  let now = 0, nextTimer = 0;
  const timers = new Map(), listeners = new Map();
  const attributes = new Set(['inert', 'aria-busy']);
  const app = { removeAttribute: name => attributes.delete(name) };
  const classes = new Set();
  const splash = { hidden: false, setAttribute() {}, classList: { add: name => classes.add(name) } };
  const window = {
    addEventListener(type, listener) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(listener); },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    matchMedia: () => ({ matches: reducedMotion }),
  };
  vm.runInNewContext(source, {
    window, document: { getElementById: id => id === 'app-root' ? app : id === 'startup-splash' ? splash : null },
    Date: { now: () => now },
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { at: now + delay, callback }); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  return {
    splash, attributes, classes, timers,
    signal(detail) { this.event('pluma-startup', { detail }); },
    event(type, event = {}) { for (const listener of [...(listeners.get(type) ?? [])]) listener(event); },
    advance(target) {
      for (let step = 0; step < 100; step++) {
        const due = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) { now = target; return; }
        timers.delete(due[0]); now = due[1].at; due[1].callback();
      }
      assert.fail('startup timers did not settle');
    },
  };
}

test('splash waits for actual frames and language, then releases keyboard access after its brief minimum', () => {
  const h = startup();
  h.signal('frames'); h.advance(100);
  assert.equal(h.splash.hidden, false); assert.ok(h.attributes.has('inert'));
  h.signal('language'); h.advance(349);
  assert.ok(h.attributes.has('inert'));
  h.advance(350);
  assert.equal(h.attributes.has('inert'), false); assert.equal(h.attributes.has('aria-busy'), false);
  assert.ok(h.classes.has('is-leaving'));
  h.advance(510); assert.equal(h.splash.hidden, true); assert.equal(h.timers.size, 0);
});

test('language may arrive first and optional engine connection never holds up the splash', () => {
  const h = startup(); h.signal('language'); h.advance(500);
  assert.ok(h.attributes.has('inert'));
  h.signal('frames');
  assert.equal(h.attributes.has('inert'), false, 'ready frames release controls immediately after the minimum');
  h.advance(660); assert.equal(h.splash.hidden, true);
});

test('a missing stored preference falls back to the already detected locale without trapping ready pages', () => {
  const h = startup(); h.signal('frames'); h.advance(899);
  assert.ok(h.attributes.has('inert'));
  h.advance(900); assert.equal(h.attributes.has('inert'), false);
  h.advance(1060); assert.equal(h.splash.hidden, true); assert.equal(h.timers.size, 0);
});

test('missing controller messages or a failed main bundle cannot leave the interface covered', () => {
  const h = startup(); h.signal('language'); h.advance(2799);
  assert.ok(h.attributes.has('inert'));
  h.advance(2800);
  assert.equal(h.splash.hidden, true); assert.equal(h.attributes.has('inert'), false); assert.equal(h.timers.size, 0);
});

test('errors and an active-job dismissal bypass minimum timing; later refresh messages never reopen it', () => {
  for (const event of ['error', 'unhandledrejection', 'pagehide', 'dismiss']) {
    const h = startup(); h.advance(20);
    if (event === 'dismiss') h.signal('dismiss'); else h.event(event);
    assert.equal(h.splash.hidden, true, event); assert.equal(h.attributes.has('inert'), false, event);
    h.signal('frames'); h.signal('language'); h.advance(10_000);
    assert.equal(h.splash.hidden, true, event); assert.equal(h.timers.size, 0, event);
  }
});

test('reduced motion skips the visual fade after initialization', () => {
  const h = startup({ reducedMotion: true }); h.signal('frames'); h.signal('language'); h.advance(350);
  assert.equal(h.splash.hidden, true); assert.equal(h.attributes.has('inert'), false); assert.equal(h.timers.size, 0);
});
