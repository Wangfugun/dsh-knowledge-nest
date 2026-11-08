/**
 * 在真实 Node 环境里加载 client.js，模拟最小宿主，确认插件不会一加载就崩。
 *
 * 测试跑的是 mock，测不出「模块被引用但没定义」这类问题——
 * 上一版 DSH 崩就是因为 appearance.js 没进 bundle，所有测试照样全绿。
 */

import { readFileSync } from 'node:fs';

const code = readFileSync('D:\\dsh-workspace\\knest-v2\\client.js', 'utf8');

/* 最小 DOM 桩：够 mountLookFab 和样式注入跑通 */
const made = [];
const el = (tag) => ({
  tagName: String(tag).toUpperCase(),
  children: [],
  style: { setProperty() {}, removeProperty() {} },
  dataset: {},
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  attributes: {},
  textContent: '',
  innerHTML: '',
  offsetWidth: 100,
  offsetHeight: 40,
  isConnected: true,
  setAttribute(k, v) { this.attributes[k] = v; },
  getAttribute(k) { return this.attributes[k] ?? null; },
  removeAttribute(k) { delete this.attributes[k]; },
  appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
  removeChild(c) { this.children = this.children.filter((x) => x !== c); return c; },
  remove() { this.isConnected = false; this.parentNode?.removeChild?.(this); },
  insertBefore(c) { this.children.push(c); return c; },
  addEventListener() {},
  removeEventListener() {},
  querySelector: () => null,
  querySelectorAll: () => [],
  contains: () => false,
  getBoundingClientRect: () => ({ left: 0, top: 0, right: 100, bottom: 40, width: 100, height: 40 }),
  getContext: () => ({}),
  click() {},
  focus() {},
  closest: () => null,
});

const body = el('body');
const head = el('head');
const styleTags = [];

const doc = {
  body,
  head,
  documentElement: el('html'),
  createElement(tag) {
    const node = el(tag);
    if (tag === 'style') styleTags.push(node);
    made.push(node);
    return node;
  },
  createElementNS(_ns, tag) { return el(tag); },
  createTextNode(t) { return { nodeType: 3, textContent: t }; },
  createDocumentFragment() { return el('fragment'); },
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
  removeEventListener() {},
  fonts: { ready: Promise.resolve() },
};

const store = new Map();
const win = {
  document: doc,
  innerWidth: 1600,
  innerHeight: 900,
  devicePixelRatio: 1,
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  requestAnimationFrame: (fn) => setTimeout(fn, 0),
  cancelAnimationFrame: () => {},
  setTimeout,
  clearTimeout,
  addEventListener() {},
  removeEventListener() {},
  localStorage: {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
  MutationObserver: class { observe() {} disconnect() {} },
  ResizeObserver: class { observe() {} disconnect() {} },
  IntersectionObserver: class { observe() {} disconnect() {} },
  CSS: { escape: (s) => s },
  location: { href: 'http://127.0.0.1:56033/' },
  navigator: { userAgent: 'node' },
};
win.window = win;
win.self = win;
win.globalThis = win;

/* client.js 的形状是 __ModuleLoader__.load({ id, factory })，
   宿主会调 factory(require) 拿到插件对象。所以必须走这条路才算真的加载。 */
let moduleExports = null;
let factoryError = null;
win.__ModuleLoader__ = {
  load({ id, factory }) {
    try {
      moduleExports = factory((name) => {
        if (name === 'react') return { createElement: () => null, useState: () => [null, () => {}] };
        return {};
      });
      console.log('factory 执行成功，插件 id:', id, '导出:', Object.keys(moduleExports || {}).join(', '));
    } catch (e) {
      factoryError = e;
    }
  },
};

/* 跑 client.js：它最后会挂一个全局，用来看有没有跑到结尾 */
let ok = false;
let err = null;
try {
  const fn = new Function(
    'window', 'document', 'globalThis', 'navigator', 'localStorage',
    'MutationObserver', 'ResizeObserver', 'IntersectionObserver', 'CSS',
    'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle', 'matchMedia',
    'location',
    code,
  );
  fn(
    win, doc, win, win.navigator, win.localStorage,
    win.MutationObserver, win.ResizeObserver, win.IntersectionObserver, win.CSS,
    win.requestAnimationFrame, win.cancelAnimationFrame, win.getComputedStyle, win.matchMedia,
    win.location,
  );
  ok = true;
} catch (e) {
  err = e;
}

console.log('加载 client.js：', ok ? '通过' : '失败');
if (err) {
  console.log('错误：', err.message);
  console.log(err.stack?.split('\n').slice(0, 4).join('\n'));
  process.exit(1);
}

if (factoryError) {
  console.log('factory 抛错：', factoryError.message);
  console.log(factoryError.stack?.split('\n').slice(0, 5).join('\n'));
  process.exit(1);
}

/* 导出对象里必须有这几样（apply 是宿主入口） */
const checks = [
  ['apply', () => typeof moduleExports?.apply],
  ['name', () => moduleExports?.name ?? 'undefined'],
  ['inject', () => (Array.isArray(moduleExports?.inject) ? moduleExports.inject.length : 0)],
  ['createAppearanceSection', () => typeof moduleExports?.createAppearanceSection],
  ['mountLookFab', () => typeof moduleExports?.mountLookFab],
];
let bad = 0;
for (const [name, probe] of checks) {
  let v;
  try { v = probe(); } catch { v = 'undefined'; }
  const good = v !== 'undefined' && v !== undefined && v !== 0;
  if (!good) bad += 1;
  console.log(`  ${name.padEnd(26)} ${good ? '在' : '缺'}  ${v}`);
}

/* 样式里必须带六套皮肤 */
const css = styleTags.map((s) => s.textContent || '').join('');
for (const skin of ['ink', 'nebula', 'neon', 'jade', 'paper', 'mono']) {
  const has = css.includes(`data-knest-skin="${skin}"`);
  if (!has) bad += 1;
  console.log(`  皮肤 ${skin.padEnd(10)} ${has ? '在样式里' : '缺'}`);
}

process.exit(bad === 0 ? 0 : 1);
