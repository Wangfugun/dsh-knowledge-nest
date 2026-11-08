/**
 * 真的调用插件的 apply()，用最小 ctx 模拟宿主。
 *
 * 为什么需要这个：smoke-client.mjs 只证明 factory 能执行，
 * 但 apply 里的 try/catch 会把错误吞掉——外观入口没挂上也不报错。
 * 这个脚本把 apply 跑起来，并且专门检查 look-fab 有没有真的落到 DOM 上。
 */

import { readFileSync } from 'node:fs';

const code = readFileSync('D:\\dsh-workspace\\knest-v2\\client.js', 'utf8');

/* ── 最小 DOM ─────────────────────────────────────────────── */
const made = [];
const mkEl = (tag) => {
  const node = {
    tagName: String(tag).toUpperCase(),
    children: [],
    style: { setProperty() {}, removeProperty() {}, getPropertyValue: () => '' },
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    attributes: {},
    textContent: '',
    innerHTML: '',
    offsetWidth: 300,
    offsetHeight: 200,
    isConnected: true,
    parentNode: null,
    setAttribute(k, v) { this.attributes[k] = String(v); },
    getAttribute(k) { return this.attributes[k] ?? null; },
    removeAttribute(k) { delete this.attributes[k]; },
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
    append(...cs) { for (const c of cs) this.appendChild(c); },
    removeChild(c) { this.children = this.children.filter((x) => x !== c); return c; },
    remove() { this.isConnected = false; },
    insertBefore(c) { this.children.push(c); c.parentNode = this; return c; },
    addEventListener() {},
    removeEventListener() {},
    querySelector: () => null,
    querySelectorAll: (sel) => {
      /* 够用就行：按 class 或 id 找自己造过的东西 */
      const key = sel.replace(/^[.#]/, '').split(/[\s,>]/)[0];
      const all = [];
      const walk = (n) => { all.push(n); for (const c of n.children) walk(c); };
      for (const n of made) walk(n);
      return all.filter((n) => n.attributes?.class?.includes?.(key) || n.attributes?.id === key || n.attributes?.['class'] === key);
    },
    contains: () => false,
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 300, bottom: 200, width: 300, height: 200 }),
    getContext: () => null,
    click() {},
    focus() {},
    closest: () => null,
    attachShadow() { return mkEl('shadow'); },
  };
  made.push(node);
  return node;
};

const body = mkEl('body');
const head = mkEl('head');
const html = mkEl('html');

const doc = {
  body, head, documentElement: html,
  createElement: (t) => mkEl(t),
  createElementNS: (_n, t) => mkEl(t),
  createTextNode: (t) => ({ nodeType: 3, textContent: t }),
  createDocumentFragment: () => mkEl('fragment'),
  getElementById: (id) => made.find((n) => n.attributes?.id === id) ?? null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
  removeEventListener() {},
  fonts: { ready: Promise.resolve() },
};

const store = new Map();
const win = {
  document: doc,
  innerWidth: 1600, innerHeight: 900, devicePixelRatio: 1,
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  requestAnimationFrame: (fn) => setTimeout(fn, 0),
  cancelAnimationFrame: () => {},
  setTimeout, clearTimeout,
  addEventListener() {}, removeEventListener() {},
  localStorage: {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
  MutationObserver: class { observe() {} disconnect() {} },
  ResizeObserver: class { observe() {} disconnect() {} },
  IntersectionObserver: class { observe() {} disconnect() {} },
  CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
  dispatchEvent() { return true; },
  CSS: { escape: (s) => s },
  location: { href: 'http://127.0.0.1:61801/' },
  navigator: { userAgent: 'node' },
};
win.window = win;
win.self = win;
win.globalThis = win;

/* ── 拦 factory ───────────────────────────────────────────── */
let plugin = null;
let factoryError = null;
win.__ModuleLoader__ = {
  load({ factory }) {
    try {
      plugin = factory((name) => {
        if (name === 'react') {
          const h = () => null;
          return { createElement: h, useState: (v) => [v, () => {}], useEffect: () => {}, useRef: () => ({ current: null }), Fragment: 'F' };
        }
        return {};
      });
    } catch (e) { factoryError = e; }
  },
};

const run = new Function(
  'window', 'document', 'globalThis', 'navigator', 'localStorage',
  'MutationObserver', 'ResizeObserver', 'IntersectionObserver', 'CSS', 'CustomEvent',
  'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle', 'matchMedia', 'location',
  code,
);
run(win, doc, win, win.navigator, win.localStorage,
    win.MutationObserver, win.ResizeObserver, win.IntersectionObserver, win.CSS, win.CustomEvent,
    win.requestAnimationFrame, win.cancelAnimationFrame, win.getComputedStyle, win.matchMedia, win.location);

if (factoryError) {
  console.log('factory 抛错：', factoryError.message);
  process.exit(1);
}
console.log('factory ok，导出：', Object.keys(plugin ?? {}).join(', '));

if (typeof plugin?.apply !== 'function') {
  console.log('没有 apply');
  process.exit(1);
}

/* ── 最小 ctx ─────────────────────────────────────────────── */
const disposers = [];
const ctx = {
  effect(fn) { try { const d = fn(); if (typeof d === 'function') disposers.push(d); } catch (e) { console.log('  [effect 内抛错]', e.message); } },
  get() { return undefined; },
  on() {},
  logger: { info() {}, warn: (m) => console.log('  [warn]', m), error: (m) => console.log('  [error]', m) },
  slots: {
    inject() {},
    register() { return () => {}; },
  },
  webServer: {
    register(route, handler) { return () => {}; },
  },
  fs: {
    resolve: (p) => p,
    readText: () => '',
  },
};

/* ── 跑 apply ─────────────────────────────────────────────── */
console.log('\n调用 apply()…');
let applyError = null;
try {
  const r = plugin.apply(ctx);
  if (r && typeof r.then === 'function') {
    await r.catch((e) => { applyError = e; });
  }
} catch (e) {
  applyError = e;
}

if (applyError) {
  console.log('apply 抛错：', applyError.message);
  console.log(applyError.stack?.split('\n').slice(0, 6).join('\n'));
  process.exit(1);
}
console.log('apply 没抛错');

/* ── 关键：look-fab 到底挂上没有 ───────────────────────────── */
const fab = made.find((n) => n.attributes?.id === 'knest-look-fab');
const logoBtns = made.filter((n) => (n.attributes?.class ?? '').includes('knest-logo-btn'));
const panels = made.filter((n) => (n.attributes?.class ?? '').includes('knest-look-panel'));
const styleTags = made.filter((n) => n.tagName === 'STYLE');

console.log('\n结果：');
console.log('  #knest-look-fab      ', fab ? '有' : '缺 ← 右下角入口没挂上');
console.log('  .knest-logo-btn      ', logoBtns.length, '个');
console.log('  .knest-look-panel    ', panels.length, '个');
console.log('  <style>              ', styleTags.length, '个');
console.log('  html[data-knest-lang]', html.getAttribute('data-knest-lang'));

const css = styleTags.map((s) => s.innerHTML || s.textContent || '').join('');
console.log('  样式里有国旗         ', css.includes('knest-flag') ? '有' : '缺');
console.log('  样式里有面板定位     ', css.includes('.knest-look-panel') ? '有' : '缺');

/* body 上挂了什么 */
console.log('\nbody 的子节点：');
for (const c of body.children) {
  console.log('  -', c.tagName, c.attributes?.id || c.attributes?.class || '');
}

const ok = fab && logoBtns.length > 0 && html.getAttribute('data-knest-lang');
process.exit(ok ? 0 : 1);
