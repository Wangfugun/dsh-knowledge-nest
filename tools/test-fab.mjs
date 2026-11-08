/**
 * 单独测 mountLookFab：把藏在 catch 里的错误逼出来。
 */
import { mountLookFab } from '../client/look-fab.js';

const made = [];
const mkEl = (tag) => {
  const n = {
    tagName: String(tag).toUpperCase(),
    children: [],
    style: { setProperty() {}, removeProperty() {} },
    dataset: {},
    attributes: {},
    textContent: '',
    innerHTML: '',
    isConnected: true,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute(k, v) { this.attributes[k] = String(v); },
    getAttribute(k) { return this.attributes[k] ?? null; },
    removeAttribute(k) { delete this.attributes[k]; },
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
    removeChild(c) { this.children = this.children.filter((x) => x !== c); return c; },
    remove() { this.isConnected = false; },
    insertBefore(c) { this.children.push(c); return c; },
    addEventListener() {},
    removeEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    contains: () => false,
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 10, bottom: 10, width: 10, height: 10 }),
    closest: () => null,
  };
  made.push(n);
  return n;
};

const body = mkEl('body');
const doc = {
  body,
  documentElement: mkEl('html'),
  createElement: (t) => mkEl(t),
  createTextNode: (t) => ({ nodeType: 3, textContent: t }),
  getElementById: (id) => made.find((n) => n.attributes?.id === id) ?? null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
  removeEventListener() {},
};

globalThis.document = doc;
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.CustomEvent = class { constructor(t, i) { this.type = t; this.detail = i?.detail; } };
globalThis.dispatchEvent = () => true;

try {
  const r = mountLookFab({ doc, win: globalThis });
  console.log('mountLookFab 成功');
  console.log('  返回 el:', r?.el ? '有' : '无');
  console.log('  body 子节点数:', body.children.length);
  for (const c of body.children) {
    console.log('    -', c.tagName, c.attributes?.id || c.attributes?.class || '');
  }
  console.log('  html data-knest-lang:', doc.documentElement.getAttribute('data-knest-lang'));
} catch (e) {
  console.log('mountLookFab 抛错：', e.message);
  console.log(e.stack?.split('\n').slice(0, 10).join('\n'));
  process.exit(1);
}
