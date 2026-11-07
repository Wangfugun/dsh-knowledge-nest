/**
 * 右键菜单（关掉圈词时用）。
 *
 * 场景：圈词关掉以后，右键拖过一段仍然会选中（并变绿），松手在选区**右上角**弹出
 * 这个小方框。一级只放四个最常用的，其余进「更多…」，免得一屏塞十行。
 *
 * 一级：复制 / 查询 / 换个说法 / 收进圈词本
 * 更多：复制释义 / 举个例子 / 翻译 / 朗读 / 复制引用块 / 定位出处
 *
 * 图标全部手画（SVG，16×16，1.4px 描边），不引入字体、不拼 innerHTML。
 */

/** 菜单根 id。 */
const MENU_ID = 'knest-menu-layer';

/** 命名空间。 */
const MENU_SVG_NS = 'http://www.w3.org/2000/svg';

/** 一级项。 */
const TOP_ITEMS = [
  { action: 'copy', label: '复制', hint: 'Ctrl+C' },
  { action: 'query', label: '查询', hint: '右键拖' },
  { action: 'rephrase', label: '换个说法', hint: 'Ctrl+R' },
  { action: 'mark-domain', label: '标出同领域', hint: 'Ctrl+D' },
  { action: 'annotate', label: '批注这段', hint: '一次性' },
  { action: 'save', label: '收进生词本', hint: 'Ctrl+S' },
];

/** 二级项。 */
const MORE_ITEMS = [
  { action: 'copy-explain', label: '复制释义', hint: '' },
  { action: 'example', label: '举个例子', hint: '' },
  { action: 'translate', label: '翻译', hint: '' },
  { action: 'speak', label: '朗读', hint: '' },
  { action: 'copy-quote', label: '复制引用块', hint: '' },
  { action: 'locate', label: '定位出处', hint: '' },
  { action: 'clear-notes', label: '清空批注', hint: '' },
];

/**
 * 造图标。
 * @param {Document} doc - 文档。
 * @param {string} name - 图标名。
 * @returns {SVGElement} 图标节点。
 */
function menuIcon(doc, name) {
  const svg = doc.createElementNS(MENU_SVG_NS, 'svg');
  const setup = {
    viewBox: '0 0 16 16',
    width: '15',
    height: '15',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.4',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
  };
  for (const [key, value] of Object.entries(setup)) svg.setAttribute(key, value);

  const add = (tag, attrs) => {
    const node = doc.createElementNS(MENU_SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    svg.appendChild(node);
    return node;
  };

  if (name === 'copy') {
    add('rect', { x: 5.6, y: 5.6, width: 8, height: 8.4 });
    add('path', { d: 'M10.4 3.4H3.2v9' });
  } else if (name === 'query') {
    add('circle', { cx: 7, cy: 7, r: 3.4 });
    add('circle', { cx: 7, cy: 7, r: 0.9, fill: 'currentColor', stroke: 'none' });
    add('path', { d: 'M10.3 10.3 13.6 13.6' });
  } else if (name === 'rephrase') {
    add('path', { d: 'M2.8 6.2a5.2 5.2 0 0 1 8.9-1.9' });
    add('path', { d: 'M13.2 9.8a5.2 5.2 0 0 1-8.9 1.9' });
    add('path', { d: 'M11.7 1.9v2.6H9.1' });
    add('path', { d: 'M4.3 14.1v-2.6h2.6' });
  } else if (name === 'save') {
    add('path', { d: 'M4.4 2.4h7.2v11.2L8 11.1l-3.6 2.5z' });
  } else if (name === 'copy-explain') {
    add('rect', { x: 3.4, y: 2.4, width: 9.2, height: 11.2 });
    add('path', { d: 'M5.6 5.6h4.8M5.6 8h4.8M5.6 10.4h3.2' });
  } else if (name === 'example') {
    add('path', { d: 'M8 2.2v2.2M8 11.6v2.2M2.2 8h2.2M11.6 8h2.2' });
    add('circle', { cx: 8, cy: 8, r: 2.4 });
  } else if (name === 'translate') {
    add('circle', { cx: 8, cy: 8, r: 5.6 });
    add('path', { d: 'M2.6 8h10.8' });
    add('path', { d: 'M8 2.4c3 3.2 3 8 0 11.2-3-3.2-3-8 0-11.2z' });
  } else if (name === 'speak') {
    add('path', { d: 'M3.2 6.2h2.2l3-2.6v8.8l-3-2.6H3.2z' });
    add('path', { d: 'M10.8 6a2.8 2.8 0 0 1 0 4M12.4 4.2a5.2 5.2 0 0 1 0 7.6' });
  } else if (name === 'copy-quote') {
    add('path', { d: 'M4.2 4.2h2.6v3.4c0 1.6-1 2.6-2.6 2.8' });
    add('path', { d: 'M9.2 4.2h2.6v3.4c0 1.6-1 2.6-2.6 2.8' });
  } else if (name === 'locate') {
    add('circle', { cx: 8, cy: 8, r: 3 });
    add('path', { d: 'M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2' });
  } else if (name === 'mark-domain') {
    /* 三个点连成一片：同类的意思 */
    add('circle', { cx: 4, cy: 5.2, r: 1.5 });
    add('circle', { cx: 11.6, cy: 4.4, r: 1.5 });
    add('circle', { cx: 7.6, cy: 11.4, r: 1.5 });
    add('path', { d: 'M5.4 5.4 10.2 4.7M4.9 6.6l1.9 3.4M10.6 5.7l-2 4.3' });
  } else {
    /* more / back */
    add('path', { d: name === 'back' ? 'M9.4 3.6 5 8l4.4 4.4' : 'M6.6 3.6 11 8l-4.4 4.4' });
  }
  return svg;
}

/**
 * 建元素的小工具（不拼 innerHTML）。
 * @param {Document} doc - 文档。
 * @param {string} tag - 标签。
 * @param {object} [attrs] - 属性。
 * @param {(Node|string)[]} [children] - 子节点。
 * @returns {HTMLElement} 节点。
 */
function menuEl(doc, tag, attrs = {}, children = []) {
  const node = doc.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = String(value);
    else if (key === 'text') node.textContent = String(value);
    else node.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.appendChild(typeof child === 'string' ? doc.createTextNode(child) : child);
  }
  return node;
}

/**
 * 由上下文算出每一项的可用状态（纯函数，DOM 那层只负责画）。
 * @param {{editable?:boolean, hasSelection?:boolean, selection?:string, hasExplain?:boolean}} [data] - 上下文。
 * @returns {{top:object[], more:object[]}} 两页菜单项。
 */
export function menuItemsFor(data) {
  const hasText = data?.hasSelection === true
    || (typeof data?.selection === 'string' && data.selection.trim() !== '');
  const hasExplain = data?.hasExplain === true;
  const hasDomain = data?.hasDomain === true;
  const mark = (items) => items.map((item) => {
    const disabled = item.action === 'annotate'
      ? false
      : item.action === 'copy-explain'
      ? !hasExplain
      : (item.action === 'mark-domain'
        ? !hasDomain
        : (item.action === 'copy' || item.action === 'save' ? !hasText : !hasText && item.action !== 'query'));
    return { ...item, disabled };
  });
  const label = typeof data?.queryLabel === 'string' && data.queryLabel !== '' ? data.queryLabel : '';
  const top = label === ''
    ? TOP_ITEMS
    : TOP_ITEMS.map((item) => (item.action === 'query' ? { ...item, label } : item));
  return { top: mark(top), more: mark(MORE_ITEMS) };
}

/**
 * 造菜单。
 * @param {{doc?:Document, onAction?:Function}} [options] - 依赖。
 * @returns {{show:Function, hide:Function, isOpen:Function, page:Function, dispose:Function}} 句柄。
 */
export function createMenu(options = {}) {
  const doc = options.doc ?? (typeof globalThis.document === 'undefined' ? null : globalThis.document);
  const onAction = options.onAction;

  let root = null;
  let box = null;
  let payload = null;
  let listening = false;
  let page = 'top';
  let anchor = null;

  const hide = () => {
    if (box !== null && box.parentNode !== null) {
      try {
        box.remove();
      } catch {
        /* 忽略 */
      }
    }
    box = null;
    payload = null;
    anchor = null;
    page = 'top';
    if (listening && doc !== null) {
      listening = false;
      doc.removeEventListener('mousedown', onOutside, true);
      doc.removeEventListener('keydown', onKey, true);
      doc.defaultView?.removeEventListener?.('scroll', hide, true);
      doc.defaultView?.removeEventListener?.('resize', hide, true);
    }
  };

  function onOutside(event) {
    if (box === null) return;
    if (event.target !== null && typeof box.contains === 'function' && box.contains(event.target)) return;
    hide();
  }

  function onKey(event) {
    if (event?.key === 'Escape') hide();
  }

  const listen = () => {
    if (doc === null || listening) return;
    listening = true;
    doc.addEventListener('mousedown', onOutside, true);
    doc.addEventListener('keydown', onKey, true);
    doc.defaultView?.addEventListener?.('scroll', hide, true);
    doc.defaultView?.addEventListener?.('resize', hide, true);
  };

  const ensureRoot = () => {
    if (doc === null) return null;
    if (root !== null && root.isConnected !== false) return root;
    const existing = typeof doc.getElementById === 'function' ? doc.getElementById(MENU_ID) : null;
    if (existing !== null && existing !== undefined) {
      root = existing;
      root.textContent = '';
      return root;
    }
    root = menuEl(doc, 'div', { id: MENU_ID });
    (doc.body ?? doc.documentElement).appendChild(root);
    return root;
  };

  const place = () => {
    if (box === null || anchor === null) return;
    const view = doc.defaultView;
    const vw = view?.innerWidth ?? 1280;
    const vh = view?.innerHeight ?? 800;
    const width = box.offsetWidth || 190;
    const height = box.offsetHeight || 160;
    const margin = 8;
    let left = anchor.right + 6;
    if (left + width > vw - margin) left = anchor.left - width - 6;
    if (left < margin) left = margin;
    let top = anchor.top - height - 6;
    if (top < margin) top = anchor.bottom + 6;
    if (top + height > vh - margin) top = Math.max(margin, vh - height - margin);
    box.style.left = `${Math.round(left)}px`;
    box.style.top = `${Math.round(top)}px`;
  };

  /**
   * 画一页。
   * @param {'top'|'more'} next - 页码。
   * @returns {void}
   */
  const paint = (next) => {
    if (box === null) return;
    page = next;
    const groups = menuItemsFor(payload);
    const items = next === 'more' ? groups.more : groups.top;
    box.textContent = '';
    box.dataset.page = next;

    if (next === 'more') {
      const back = menuEl(doc, 'button', { class: 'knest-mi knest-mi-lead', type: 'button', 'data-nav': 'back' }, [
        menuIcon(doc, 'back'),
        menuEl(doc, 'span', { class: 'knest-mi-label', text: '返回' }),
      ]);
      back.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        paint('top');
      });
      box.appendChild(back);
      box.appendChild(menuEl(doc, 'div', { class: 'knest-mdiv' }));
    }

    for (const item of items) {
      const button = menuEl(doc, 'button', {
        class: 'knest-mi',
        type: 'button',
        role: 'menuitem',
        'data-action': item.action,
        disabled: item.disabled === true,
        title: item.disabled === true
          ? (item.action === 'copy-explain' ? '先查询一次，才有释义可复制' : '先选中一段文字')
          : item.label,
      }, [
        menuIcon(doc, item.action),
        menuEl(doc, 'span', { class: 'knest-mi-label', text: item.label }),
        menuEl(doc, 'span', { class: 'knest-mi-hint', text: item.hint }),
      ]);
      box.appendChild(button);
    }

    if (next === 'top') {
      box.appendChild(menuEl(doc, 'div', { class: 'knest-mdiv' }));
      const more = menuEl(doc, 'button', { class: 'knest-mi knest-mi-more', type: 'button', 'data-nav': 'more' }, [
        menuIcon(doc, 'more'),
        menuEl(doc, 'span', { class: 'knest-mi-label', text: '更多' }),
      ]);
      more.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        paint('more');
        place();
      });
      box.appendChild(more);
    }
    place();
  };

  return {
    /**
     * 在选区右上角弹出。
     * @param {{left:number, top:number, right:number, bottom:number}} rect - 选区矩形（视口坐标）。
     * @param {{phrase:string, selection:string, hasSelection:boolean, hasExplain?:boolean}} data - 上下文。
     * @returns {void}
     */
    show(rect, data) {
      const host = ensureRoot();
      if (host === null) return;
      hide();
      anchor = rect ?? { left: 8, top: 8, right: 8, bottom: 8 };
      payload = data ?? { phrase: '', selection: '', hasSelection: false, hasExplain: false };

      box = menuEl(doc, 'div', { class: 'knest-menu', role: 'menu', 'aria-label': '选区操作' });
      box.addEventListener('mousedown', (event) => event.preventDefault());
      box.addEventListener('click', (event) => {
        const target = event.target;
        const button = target !== null && typeof target.closest === 'function' ? target.closest('.knest-mi') : null;
        if (button === null || button.disabled === true) return;
        if (button.getAttribute('data-nav') !== null) return;
        const action = button.getAttribute('data-action');
        const snapshot = payload;
        hide();
        try {
          onAction?.(action, snapshot);
        } catch (error) {
          try {
            console.warn('[knest] 菜单动作抛错：', error);
          } catch {
            /* 忽略 */
          }
        }
      });

      host.appendChild(box);
      paint('top');
      listen();
    },
    hide,
    /**
     * 开着没有。
     * @returns {boolean} 是否开着。
     */
    isOpen() {
      return box !== null;
    },
    /**
     * 当前页（调试用）。
     * @returns {string} top / more。
     */
    page() {
      return page;
    },
    /**
     * 卸载。
     * @returns {void}
     */
    dispose() {
      hide();
      if (root !== null && root.parentNode !== null) {
        try {
          root.remove();
        } catch {
          /* 忽略 */
        }
      }
      root = null;
    },
  };
}
