/**
 * 极简假 DOM：够把 client.js 真跑起来（apply + 右键菜单 + 窗口 + 高亮）。
 *
 * 为什么需要它：`test/client.test.mjs` 要验证"点菜单真的会调用 actions.js 里的函数"，
 * 而 actions.js 曾经漏登记进 bundle——那类 bug 只有在真点一次时才暴露。
 *
 * 只实现被实际用到的 API；没实现的一律返回 null/undefined，让缺能力的地方显式降级。
 */

/**
 * 造一个元素。
 * @param {string} tag - 标签名。
 * @returns {object} 元素。
 */
function makeElement(tag) {
  const node = {
    tagName: String(tag).toUpperCase(),
    id: '',
    className: '',
    children: [],
    parentNode: null,
    attrs: {},
    style: { setProperty() {} },
    dataset: {},
    hidden: false,
    disabled: false,
    listeners: {},
    _text: '',

    get textContent() {
      return node._text;
    },
    set textContent(value) {
      node._text = String(value ?? '');
      node.children = [];
    },

    get firstChild() {
      return node.children[0] ?? null;
    },

    appendChild(child) {
      if (child === null || child === undefined) return child;
      child.parentNode = node;
      node.children.push(child);
      return child;
    },
    prepend(child) {
      child.parentNode = node;
      node.children.unshift(child);
      return child;
    },
    insertBefore(child, ref) {
      child.parentNode = node;
      const at = ref === undefined || ref === null ? node.children.length : node.children.indexOf(ref);
      if (at < 0) node.children.push(child);
      else node.children.splice(at, 0, child);
      return child;
    },
    removeChild(child) {
      node.children = node.children.filter((item) => item !== child);
      child.parentNode = null;
      return child;
    },
    replaceChild(next, prev) {
      const at = node.children.indexOf(prev);
      if (at < 0) return prev;
      next.parentNode = node;
      prev.parentNode = null;
      node.children[at] = next;
      return prev;
    },
    remove() {
      if (node.parentNode !== null) node.parentNode.removeChild(node);
    },
    replaceWith() {},
    contains(other) {
      if (other === node) return true;
      return node.children.some((child) => (typeof child.contains === 'function' ? child.contains(other) : false));
    },

    setAttribute(key, value) {
      node.attrs[key] = String(value);
      if (key === 'id') node.id = String(value);
      if (key === 'class') node.className = String(value);
      if (key === 'disabled') node.disabled = true;
    },
    getAttribute(key) {
      const value = node.attrs[key];
      return value === undefined ? null : value;
    },
    removeAttribute(key) {
      delete node.attrs[key];
    },

    addEventListener(type, handler) {
      node.listeners[type] = node.listeners[type] ?? [];
      node.listeners[type].push(handler);
    },
    removeEventListener(type, handler) {
      node.listeners[type] = (node.listeners[type] ?? []).filter((item) => item !== handler);
    },
    dispatch(type, event) {
      for (const handler of node.listeners[type] ?? []) handler(event);
    },

    querySelector(selector) {
      const want = String(selector).trim();
      const match = (item) => {
        if (want.startsWith('.')) return String(item.className).split(/\s+/u).includes(want.slice(1));
        if (want.startsWith('#')) return item.id === want.slice(1);
        if (want.startsWith('[')) {
          const inner = want.slice(1, -1);
          const [key, raw] = inner.split('=');
          const expected = raw === undefined ? undefined : raw.replace(/^["']|["']$/gu, '');
          return expected === undefined ? node.attrs[key] !== undefined : item.attrs[key] === expected;
        }
        return item.tagName === want.toUpperCase();
      };
      const walk = (item) => {
        for (const child of item.children) {
          if (match(child)) return child;
          const deeper = walk(child);
          if (deeper !== null) return deeper;
        }
        return null;
      };
      return walk(node);
    },
    closest(selector) {
      const want = String(selector).trim();
      let cursor = node;
      while (cursor !== null && cursor !== undefined) {
        if (want.startsWith('.') && String(cursor.className).split(/\s+/u).includes(want.slice(1))) return cursor;
        if (want.startsWith('#') && cursor.id === want.slice(1)) return cursor;
        cursor = cursor.parentNode;
      }
      return null;
    },

    get offsetWidth() {
      return 180;
    },
    get offsetHeight() {
      return 160;
    },
    getBoundingClientRect() {
      return { left: 100, top: 200, right: 200, bottom: 220, width: 100, height: 20 };
    },
    scrollIntoView() {},
    focus() {},
    blur() {},
  };
  return node;
}

/**
 * 造一个假 document + window。
 * @param {{selection?:string}} [options] - `selection` 是 `getSelection().toString()` 的返回值。
 * @returns {object} `{doc, win, findById, dispatchDoc}`.
 */
export function createFakeDom(options = {}) {
  const body = makeElement('body');
  const head = makeElement('head');
  const html = makeElement('html');
  html.appendChild(head);
  html.appendChild(body);

  const selection = typeof options.selection === 'string' ? options.selection : '';

  const doc = {
    body,
    head,
    documentElement: html,
    listeners: {},
    createElement: (tag) => makeElement(tag),
    createElementNS: (ns, tag) => makeElement(tag),
    createTextNode: (text) => {
      const node = makeElement('#text');
      node._text = String(text);
      return node;
    },
    getElementById(id) {
      const walk = (item) => {
        for (const child of item.children) {
          if (child.id === id) return child;
          const deeper = walk(child);
          if (deeper !== null) return deeper;
        }
        return null;
      };
      return walk(body);
    },
    createRange() {
      return {
        setStart() {},
        setEnd() {},
        toString: () => selection,
        getBoundingClientRect: () => ({ left: 100, top: 200, right: 200, bottom: 220, width: 100, height: 20 }),
      };
    },
    addEventListener(type, handler) {
      doc.listeners[type] = doc.listeners[type] ?? [];
      doc.listeners[type].push(handler);
    },
    removeEventListener(type, handler) {
      doc.listeners[type] = (doc.listeners[type] ?? []).filter((item) => item !== handler);
    },
    dispatch(type, event) {
      for (const handler of doc.listeners[type] ?? []) handler(event);
    },
    querySelector() {
      return null;
    },
  };

  const win = {
    innerWidth: 1280,
    innerHeight: 800,
    listeners: {},
    addEventListener(type, handler) {
      win.listeners[type] = win.listeners[type] ?? [];
      win.listeners[type].push(handler);
    },
    removeEventListener(type, handler) {
      win.listeners[type] = (win.listeners[type] ?? []).filter((item) => item !== handler);
    },
    getComputedStyle() {
      return { getPropertyValue: () => '', backgroundColor: '' };
    },
    getSelection() {
      return {
        rangeCount: 1,
        toString: () => selection,
        getRangeAt: () => ({
          getBoundingClientRect: () => ({ left: 100, top: 200, right: 200, bottom: 220, width: 100, height: 20 }),
        }),
        removeAllRanges() {},
      };
    },
    navigator: { clipboard: null },
  };

  doc.defaultView = win;
  win.document = doc;

  return { doc, win };
}
