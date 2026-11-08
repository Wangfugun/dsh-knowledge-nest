/**
 * 知识树画布：无限画布 + 节点 + SVG 贝塞尔连线。
 *
 * 替代原来的「独立浮动窗口」：不再一卡一窗，而是一张画布，节点散布其上，
 * 父子之间用一条曲线相连；拖动节点时线跟着重算，空白处拖动平移、滚轮缩放。
 *
 * 分层：
 *   - **纯函数**（edgeFor / pathFor / depthOf / descendantsOf / placeChild）：不碰 DOM，node 里直接测；
 *   - **渲染层**（createTreeBoard）：只负责把节点数组画成 DOM + SVG。
 *
 * 约束：最多 3 层（根 = 第 1 层），到第 3 层的节点不再展开新节点。
 */

/** 节点宽度（固定，高度自适应）。 */
export const NODE_W = 300;

/** 最多几层（根算第 1 层）。 */
export const MAX_LEVELS = 4;

/** 连线的控制点强度（相对位移比例，0~0.6 之间比较好看）。 */
const CURVE = 0.5;

/** 子节点默认落位：水平间距 / 垂直间距。 */
const GAP_X = 56;
const GAP_Y = 96;

/** 缩放范围。 */
const SCALE_MIN = 0.4;
const SCALE_MAX = 2.2;


/** 数字收一位小数，便于测试断言与输出稳定。 */
function round(value) {
  return Math.round(Number(value) * 10) / 10;
}

/**
 * 节点尺寸（没测到就用默认值）。
 * @param {{w?:number,h?:number}} size - 尺寸。
 * @returns {{w:number,h:number}} 收敛后的尺寸。
 */
function sizeOf(size) {
  return {
    w: Number.isFinite(size?.w) && size.w > 0 ? size.w : NODE_W,
    h: Number.isFinite(size?.h) && size.h > 0 ? size.h : 160,
  };
}

/**
 * 算一条连线的两个端点与控制点。
 *
 * 自动避让规则：
 *   · 两个节点**大致上下叠着**（横向位移 ≤ 一个节点宽 × 0.9）→ 竖向连线：
 *     父底边中点 → 子顶边中点（子在父上方则反过来）；
 *   · 横向拉开得更远 → 横向连线：父右（或左）边中点 → 子左边（或右）边中点。
 *
 * @param {{x:number,y:number}} parent - 父节点左上角（世界坐标）。
 * @param {{x:number,y:number}} child - 子节点左上角。
 * @param {{w:number,h:number}} parentSize - 父节点尺寸。
 * @param {{w:number,h:number}} childSize - 子节点尺寸。
 * @returns {{x1:number,y1:number,c1x:number,c1y:number,c2x:number,c2y:number,x2:number,y2:number,orientation:'vertical'|'horizontal'}} 连线几何。
 */
export function edgeFor(parent, child, parentSize, childSize) {
  const p = { x: Number(parent?.x) || 0, y: Number(parent?.y) || 0 };
  const c = { x: Number(child?.x) || 0, y: Number(child?.y) || 0 };
  const ps = sizeOf(parentSize);
  const cs = sizeOf(childSize);
  const dx = c.x - p.x;
  const dy = c.y - p.y;

  if (Math.abs(dx) <= Math.max(ps.w, cs.w) * 0.9) {
    /* 竖向：默认父下 → 子上；子整体在父上方则反过来。 */
    const down = (c.y + cs.h / 2) >= (p.y + ps.h / 2);
    const x1 = p.x + ps.w / 2;
    const y1 = down ? p.y + ps.h : p.y;
    const x2 = c.x + cs.w / 2;
    const y2 = down ? c.y : c.y + cs.h;
    const bend = Math.max(40, Math.abs(y2 - y1) * CURVE);
    return {
      x1: round(x1),
      y1: round(y1),
      c1x: round(x1),
      c1y: round(down ? y1 + bend : y1 - bend),
      c2x: round(x2),
      c2y: round(down ? y2 - bend : y2 + bend),
      x2: round(x2),
      y2: round(y2),
      orientation: 'vertical',
    };
  }

  /* 横向：默认父右 → 子左；子整体在父左边则反过来。 */
  const right = (c.x + cs.w / 2) >= (p.x + ps.w / 2);
  const x1 = right ? p.x + ps.w : p.x;
  const y1 = p.y + ps.h / 2;
  const x2 = right ? c.x : c.x + cs.w;
  const y2 = c.y + cs.h / 2;
  const bend = Math.max(40, Math.abs(x2 - x1) * CURVE);
  return {
    x1: round(x1),
    y1: round(y1),
    c1x: round(right ? x1 + bend : x1 - bend),
    c1y: round(y1),
    c2x: round(right ? x2 - bend : x2 + bend),
    c2y: round(y2),
    x2: round(x2),
    y2: round(y2),
    orientation: 'horizontal',
  };
}

/**
 * 连线几何 → SVG `d`。
 * @param {object} edge - `edgeFor()` 的产物。
 * @returns {string} `M x1 y1 C c1x c1y c2x c2y x2 y2`。
 */
export function pathFor(edge) {
  return `M ${edge.x1} ${edge.y1} C ${edge.c1x} ${edge.c1y} ${edge.c2x} ${edge.c2y} ${edge.x2} ${edge.y2}`;
}

/**
 * 节点的层级（根 = 0）。
 * @param {object[]} nodes - 节点数组。
 * @param {string} id - 节点 id。
 * @returns {number} 层级；找不到返回 -1。
 */
export function depthOf(nodes, id) {
  const map = new Map((Array.isArray(nodes) ? nodes : []).map((node) => [node.id, node]));
  let cursor = map.get(id);
  let depth = 0;
  let guard = 0;
  while (cursor !== undefined && cursor.parentId !== null && cursor.parentId !== undefined) {
    cursor = map.get(cursor.parentId);
    depth += 1;
    guard += 1;
    if (guard > 64) break; /* 环保护 */
  }
  return map.has(id) ? depth : -1;
}

/**
 * 某个节点的全部后代 id（含自己）。
 * @param {object[]} nodes - 节点数组。
 * @param {string} id - 节点 id。
 * @returns {string[]} id 列表。
 */
export function descendantsOf(nodes, id) {
  const list = Array.isArray(nodes) ? nodes : [];
  const out = [id];
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of list) {
      if (out.includes(node.id)) continue;
      if (out.includes(node.parentId)) {
        out.push(node.id);
        changed = true;
      }
    }
  }
  return out;
}

/**
 * 给新子节点挑个落点：父节点下方居中排开，兄弟越多越往右摊。
 * @param {object[]} nodes - 现有节点。
 * @param {object} parent - 父节点（需含 x/y）。
 * @param {{w:number,h:number}} parentSize - 父节点尺寸。
 * @param {number} index - 在兄弟里的序号（0 起）。
 * @returns {{x:number,y:number}} 世界坐标。
 */
export function placeChild(nodes, parent, parentSize, index) {
  const ps = sizeOf(parentSize);
  const siblings = (Array.isArray(nodes) ? nodes : []).filter((node) => node.parentId === parent.id);
  const total = Math.max(1, siblings.length + 1);
  const step = NODE_W + GAP_X;
  const slot = index - (total - 1) / 2;
  const centerX = (parent.x ?? 0) + ps.w / 2 + slot * step;
  return {
    x: round(centerX - NODE_W / 2),
    y: round((parent.y ?? 0) + ps.h + GAP_Y),
  };
}

/**
 * 造画布。
 * @param {{doc?:Document, onExpand?:Function, onRetry?:Function}} [options] - 依赖。
 *   `onExpand(nodeId, text)` 在点击节点里的可展开词时回调；`onRetry(nodeId, text)` 在点「再试一次」时回调。
 * @returns {object} 画布句柄。
 */
export function createTreeBoard(options = {}) {
  const doc = options.doc ?? (typeof globalThis.document === 'undefined' ? null : globalThis.document);
  const onExpand = options.onExpand;
  const onRetry = options.onRetry;
  const onClear = options.onClear;
  const onchange = options.onchange;
  const onCopyNode = options.onCopyNode;
  const onExport = options.onExport;
  const onCardMenu = options.onCardMenu;
  const onSelect = options.onSelect;

  /** 通知外部：画布变了（用于持久化）。 */
  const notify = () => {
    try {
      onchange?.();
    } catch {
      /* 忽略 */
    }
  };

  /** @type {object[]} 节点 [{id, text, x, y, parentId, depth, model, collapsed}]。 */
  const nodes = [];
  /** @type {Map<string, HTMLElement>} */
  const elements = new Map();
  /** @type {Map<string, {w:number,h:number}>} */
  const sizes = new Map();

  let root = null;
  let world = null;
  let edgeLayer = null;
  let nodeLayer = null;
  let hud = null;
  let panX = 0;
  let panY = 0;
  let scale = 1;
  let drag = null;
  /** @type {Set<string>} 多选（Shift+点击） */
  const selected = new Set();
  let stage = null;
  let named = 0;

  const indexOf = (id) => nodes.findIndex((node) => node.id === id);
  const get = (id) => nodes[indexOf(id)] ?? null;

  /**
   * 造元素。
   * @param {string} tag - 标签。
   * @param {object} [attrs] - 属性（class / text / data-*）。
   * @param {(Node|string)[]} [children] - 子节点。
   * @returns {HTMLElement} 节点。
   */
  const el = (tag, attrs = {}, children = []) => {
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
  };

  /** 读节点尺寸（DOM 量不到就用默认值）。 */
  const measure = (id) => {
    const cached = sizes.get(id);
    const node = elements.get(id);
    if (node === undefined) return cached ?? { w: NODE_W, h: 160 };
    const w = Number(node.offsetWidth) || cached?.w || NODE_W;
    const h = Number(node.offsetHeight) || cached?.h || 160;
    const size = { w, h };
    sizes.set(id, size);
    return size;
  };

  const applyView = () => {
    if (world === null) return;
    world.style.transform = `translate(${Math.round(panX)}px, ${Math.round(panY)}px) scale(${scale})`;
  };

  const positionNode = (node) => {
    const element = elements.get(node.id);
    if (element === undefined) return;
    element.style.left = `${node.x}px`;
    element.style.top = `${node.y}px`;
  };

  /** 重画所有连线（节点数组变了 / 被拖动 / 折叠时都要调）。 */
  const syncEdges = () => {
    if (edgeLayer === null) return;
    edgeLayer.textContent = '';
    for (const node of nodes) {
      if (node.parentId === null || node.parentId === undefined) continue;
      const parent = get(node.parentId);
      if (parent === null) continue;
      const edge = edgeFor(parent, node, measure(parent.id), measure(node.id));
      const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', pathFor(edge));
      path.setAttribute('class', 'knest-edge');
      path.setAttribute('data-from', parent.id);
      path.setAttribute('data-to', node.id);
      path.setAttribute('data-orientation', edge.orientation);
      edgeLayer.appendChild(path);
    }
  };

  /**
   * 渲染一个节点的正文。
   * @param {object} node - 节点记录。
   * @returns {HTMLElement} 正文容器。
   */
  const renderBody = (node) => {
    const model = node.model ?? {};
    const body = el('div', { class: 'knest-tnode-body' });

    if (model.pending === true) {
      body.appendChild(el('div', { class: 'knest-scan' }));
      body.appendChild(el('div', { class: 'knest-skel', 'data-w': '84' }));
      body.appendChild(el('div', { class: 'knest-skel', 'data-w': '62' }));
      return body;
    }

    if (model.error === true) {
      body.appendChild(el('p', { class: 'knest-tnode-lead knest-bad', text: model.lead ?? '这次没拿到解释' }));
      const retry = el('button', { class: 'knest-retry', type: 'button', text: '再试一次' });
      retry.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        try {
          onRetry?.(node.id, node.text);
        } catch {
          /* 忽略 */
        }
      });
      body.appendChild(retry);
      return body;
    }

    body.appendChild(el('p', { class: 'knest-tnode-lead', text: model.lead ?? '' }));

    const evidence = Array.isArray(model.evidence) ? model.evidence.slice(0, 2) : [];
    if (evidence.length > 0) {
      const list = el('ul', { class: 'knest-tnode-evidence' });
      for (const item of evidence) {
        if (typeof item?.quote !== 'string' || item.quote === '') continue;
        list.appendChild(el('li', {}, [el('span', { class: 'knest-quote', text: item.quote })]));
      }
      if (list.children.length > 0) body.appendChild(list);
    }

    /* 可展开词：card.tree 的 label。到第 3 层就只显示、不再可点。 */
    const links = Array.isArray(model.tree) ? model.tree.slice(0, 4) : [];
    if (links.length > 0) {
      const expandable = node.depth < MAX_LEVELS - 1;
      const wrap = el('div', { class: 'knest-tnode-links' });
      for (const link of links) {
        if (typeof link?.label !== 'string' || link.label === '') continue;
        const chip = el('button', {
          class: 'knest-chip',
          type: 'button',
          'data-term': link.label,
          disabled: expandable !== true,
          title: expandable === true ? `展开「${link.label}」（Alt+点击＝原地换个解释）` : '最多 4 层，这里不再展开',
          text: link.label,
        });
        if (expandable === true) {
          chip.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            try {
              onExpand?.(node.id, link.label, { replace: event.altKey === true });
            } catch {
              /* 忽略 */
            }
          });
        }
        wrap.appendChild(chip);
      }
      if (wrap.children.length > 0) body.appendChild(wrap);
    }

    const meta = model.meta ?? {};
    const bits = [];
    if (meta.count > 0) bits.push(`${meta.count} 次`);
    if (meta.model) bits.push(meta.model);
    if (meta.usage?.total > 0) bits.push(`${meta.usage.total} token`);
    if (bits.length > 0) body.appendChild(el('div', { class: 'knest-tnode-foot', text: bits.join(' · ') }));

    return body;
  };

  /** 造一个节点 DOM（不含挂载）。 */
  const buildNode = (node) => {
    const title = el('span', { class: 'knest-tnode-title', text: node.text });
    const kind = el('span', { class: 'knest-tnode-kind', text: node.model?.kind ?? '' });
    const min = el('button', { class: 'knest-tnode-btn', type: 'button', 'data-act': 'min', title: '最小化', text: '—' });
    const close = el('button', { class: 'knest-tnode-btn', type: 'button', 'data-act': 'close', title: '关闭', text: '×' });
    const up = el('button', {
      class: 'knest-tnode-btn',
      type: 'button',
      'data-act': 'up',
      title: '回到上级',
      text: '↑',
    });
    if (node.parentId === null || node.parentId === undefined) up.setAttribute('hidden', 'true');
    up.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const parent = get(node.parentId);
      if (parent !== null) {
        centerOn(parent);
        elements.get(parent.id)?.setAttribute('data-flash', 'true');
        setTimeout(() => elements.get(parent.id)?.removeAttribute('data-flash'), 900);
      }
    });

    title.addEventListener('dblclick', (event) => {
      event.preventDefault();
      event.stopPropagation();
      try {
        onCopyNode?.(node);
      } catch {
        /* 忽略 */
      }
    });

    const bar = el('header', { class: 'knest-tnode-bar' }, [up, title, kind, min, close]);
    const body = renderBody(node);

    const section = el('section', {
      class: 'knest-tnode',
      'data-id': node.id,
      'data-depth': String(node.depth),
      'data-collapsed': node.collapsed === true ? 'true' : 'false',
      /* 领域：模型给什么就写什么；空串表示"没判定"，前端据此不参与标橙 */
      'data-domain': node.model?.domain ?? '',
    }, [bar, body]);

    section.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();
      try {
        onCardMenu?.(node, event);
      } catch {
        /* 忽略 */
      }
    });

    section.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      /* Shift+点击：切换选中，不启动拖动 */
      if (event.shiftKey === true) {
        event.preventDefault();
        event.stopPropagation();
        if (selected.has(node.id)) selected.delete(node.id);
        else selected.add(node.id);
        section.setAttribute('data-selected', selected.has(node.id) ? 'true' : 'false');
        try {
          onSelect?.(selected.size);
        } catch {
          /* 忽略 */
        }
        return;
      }
      const target = event.target;
      const interactive = target !== null && typeof target.closest === 'function'
        && target.closest('button, textarea, input, a, .knest-chip') !== null;
      if (interactive) return;
      /* 标题栏永远可拖；正文只在没有活动选区时才拖，避免抢走选字 */
      const onBar = typeof target.closest === 'function' && target.closest('.knest-tnode-bar') !== null;
      if (!onBar) {
        try {
          const picked = doc?.getSelection?.();
          if (picked !== null && picked !== undefined && picked.isCollapsed === false) return;
        } catch {
          /* 忽略 */
        }
      }
      startNodeDrag(event, node.id);
    });

    min.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleCollapse(node.id);
    });
    close.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      remove(node.id);
    });

    return section;
  };

  /** 重画单个节点的正文（结果回来时）。 */
  const refreshNode = (node) => {
    const element = elements.get(node.id);
    if (element === undefined) return;
    const body = element.querySelector('.knest-tnode-body');
    if (body !== null && body !== undefined && body.parentNode !== null) {
      const next = renderBody(node);
      body.parentNode.replaceChild(next, body);
    }
    const kind = element.querySelector('.knest-tnode-kind');
    if (kind !== null && kind !== undefined) kind.textContent = node.model?.kind ?? '';
    element.setAttribute('data-domain', node.model?.domain ?? '');
  };

  const ensureShell = () => {
    if (doc === null) return false;
    if (root !== null && root.isConnected !== false) return true;
    const existing = typeof doc.getElementById === 'function' ? doc.getElementById('knest-board') : null;
    if (existing !== null && existing !== undefined) {
      root = existing;
      world = existing.querySelector('.knest-board-world');
      edgeLayer = existing.querySelector('.knest-board-edges');
      nodeLayer = existing.querySelector('.knest-board-nodes');
      hud = existing.querySelector('.knest-board-hud');
      return world !== null;
    }

    edgeLayer = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    edgeLayer.setAttribute('class', 'knest-board-edges');
    edgeLayer.setAttribute('width', '1');
    edgeLayer.setAttribute('height', '1');
    nodeLayer = el('div', { class: 'knest-board-nodes' });
    world = el('div', { class: 'knest-board-world' }, [edgeLayer, nodeLayer]);

    /* HUD 收成右上角一颗小胶囊：只有两个图标按钮，说明文字进 tooltip。 */
    const hint = '拖标题栏移动卡片 · Alt+拖拽平移 · Ctrl+滚轮缩放 · Esc 收起';
    const reset = el('button', { class: 'knest-hud-btn', type: 'button', title: `回到根节点\n${hint}`, text: '⟲' });
    reset.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const first = nodes[0];
      if (first !== undefined) centerOn(first);
    });
    const clear = el('button', { class: 'knest-hud-btn', type: 'button', title: `全部关闭（Esc）\n${hint}`, text: '✕' });
    clear.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      clearAll();
    });

    const exportBtn = el('button', { class: 'knest-hud-btn', type: 'button', title: '导出这棵树为 Markdown', text: '⤓' });
    exportBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      try {
        onExport?.();
      } catch {
        /* 忽略 */
      }
    });

    hud = el('div', { class: 'knest-board-hud' }, [exportBtn, reset, clear]);

    /* HUD 可拖动：宿主底部常有自己的工具条，固定位置迟早被挡。
       拖过之后位置记在 localStorage，下次还在这儿。 */
    const hudKey = 'knest.hud.pos';
    const restoreHud = () => {
      try {
        const raw = doc?.defaultView?.localStorage?.getItem(hudKey);
        if (typeof raw !== 'string' || raw === '') return;
        const pos = JSON.parse(raw);
        if (Number.isFinite(pos?.left) && Number.isFinite(pos?.top)) {
          hud.style.left = `${Math.round(pos.left)}px`;
          hud.style.top = `${Math.round(pos.top)}px`;
          hud.style.right = 'auto';
          hud.style.bottom = 'auto';
        }
      } catch {
        /* 忽略 */
      }
    };
    restoreHud();

    let hudDrag = null;
    const onHudMove = (event) => {
      if (hudDrag === null) return;
      event.preventDefault();
      event.stopPropagation();
      const dx = event.clientX - hudDrag.startX;
      const dy = event.clientY - hudDrag.startY;
      const box = stage?.getBoundingClientRect?.() ?? { width: 1280, height: 800 };
      const width = hud.offsetWidth || 90;
      const height = hud.offsetHeight || 28;
      const left = Math.min(Math.max(4, hudDrag.originLeft + dx), (Number(box.width) || 1280) - width - 4);
      const top = Math.min(Math.max(4, hudDrag.originTop + dy), (Number(box.height) || 800) - height - 4);
      hud.style.left = `${Math.round(left)}px`;
      hud.style.top = `${Math.round(top)}px`;
      hud.style.right = 'auto';
      hud.style.bottom = 'auto';
    };
    const onHudUp = (event) => {
      if (hudDrag === null) return;
      hudDrag = null;
      hud.setAttribute('data-dragging', 'false');
      doc?.removeEventListener?.('pointermove', onHudMove, true);
      doc?.removeEventListener?.('pointerup', onHudUp, true);
      try {
        const box = hud.getBoundingClientRect();
        const stageBox = stage?.getBoundingClientRect?.() ?? { left: 0, top: 0 };
        doc?.defaultView?.localStorage?.setItem(hudKey, JSON.stringify({
          left: box.left - stageBox.left,
          top: box.top - stageBox.top,
        }));
      } catch {
        /* 忽略 */
      }
      event.preventDefault();
      event.stopPropagation();
    };
    hud.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      /* 点在按钮上就别拖，留给按钮自己处理 */
      if (event.target?.closest?.('.knest-hud-btn') !== null) return;
      const box = hud.getBoundingClientRect();
      const stageBox = stage?.getBoundingClientRect?.() ?? { left: 0, top: 0 };
      hudDrag = {
        startX: event.clientX,
        startY: event.clientY,
        originLeft: box.left - stageBox.left,
        originTop: box.top - stageBox.top,
      };
      hud.setAttribute('data-dragging', 'true');
      doc?.addEventListener?.('pointermove', onHudMove, true);
      doc?.addEventListener?.('pointerup', onHudUp, true);
    });

    stage = el('div', { class: 'knest-board-main' }, [world, hud]);
    /* 挂载时必须先藏起来：没有这个初始属性，隐藏规则匹配不上，HUD 会一直露在左下角。 */
    root = el('div', { class: 'knest-board', id: 'knest-board', 'data-open': 'false' }, [stage]);
    doc.addEventListener('pointerdown', onBoardPointerDown, true);
    doc.addEventListener('wheel', onWheel, { passive: false, capture: true });
    doc.addEventListener('keydown', onBoardKey, true);
    (doc.body ?? doc.documentElement).appendChild(root);
    applyView();
    return true;
  };

  /** 让某个节点落在（右栏）视口中央。 */
  const centerOn = (node) => {
    const view = doc?.defaultView;
    const box = (stage ?? root)?.getBoundingClientRect?.() ?? { left: 0, top: 0, width: 0, height: 0 };
    const vw = Number(box.width) || view?.innerWidth || 1280;
    const vh = Number(box.height) || view?.innerHeight || 800;
    const size = measure(node.id);
    panX = vw / 2 - (node.x + size.w / 2) * scale;
    panY = vh / 2 - (node.y + size.h / 2) * scale;
    /* 别把卡片顶到窗口外面：标题栏至少留 44px 在可视区（44 = 宿主标题栏高度量级） */
    const topLimit = 80;
    if (node.y * scale + panY < topLimit) panY = topLimit - node.y * scale;
    applyView();
  };


  /** 待执行的那一帧；null 表示当前帧没人排队。 */
  let dragFrame = null;

  function startNodeDrag(event, id) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const node = get(id);
    if (node === null) return;
    const group = selected.has(id) && selected.size > 1 ? [...selected] : [id];
    const stageTop = (stage ?? root)?.getBoundingClientRect?.()?.top ?? 0;
    drag = {
      kind: 'node',
      id,
      group,
      origins: group.map((item) => ({ id: item, x: get(item)?.x ?? 0, y: get(item)?.y ?? 0 })),
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      originX: node.x,
      originY: node.y,
      minScreenY: stageTop + 80,
    };
    root?.setAttribute('data-dragging', 'true');
    doc?.addEventListener?.('pointermove', onPointerMove, true);
    doc?.addEventListener?.('pointerup', onPointerUp, true);
  }

  /**
   * 平移。
   *
   * 画布现在是**透明层**（不吃鼠标事件），所以空白处直接拖行不通——
   * 改成 Alt+左键 或 中键 拖动，任何时候都能平移，且不影响下面的对话。
   * @param {PointerEvent} event - 指针事件。
   * @returns {void}
   */
  function onBoardPointerDown(event) {
    if (root === null || root.getAttribute('data-open') === 'false') return;
    const alt = event.altKey === true;
    const middle = event.button === 1;
    if (!alt && !middle) return;
    drag = { kind: 'pan', startX: event.clientX, startY: event.clientY, lastX: event.clientX, lastY: event.clientY, originX: panX, originY: panY, minScreenY: null };
    root.setAttribute('data-dragging', 'true');
    doc?.addEventListener?.('pointermove', onPointerMove, true);
    doc?.addEventListener?.('pointerup', onPointerUp, true);
    event.preventDefault();
  }

  function onPointerMove(event) {
    if (drag === null) return;
    /* 只记住最新位置，真正的计算丢到下一帧做。
       原来的写法是每个 pointermove 都全量算一遍，高刷鼠标一秒能触发一百多次，
       再叠上 syncEdges 被调用两次，就成了肉眼可见的一顿一顿。 */
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    if (dragFrame !== null) return;
    dragFrame = (doc?.defaultView?.requestAnimationFrame ?? ((fn) => setTimeout(fn, 16)))(() => {
      dragFrame = null;
      applyDragFrame();
    });
  }

  /**
   * 按最新指针位置重排卡片。一帧只跑一次。
   * @returns {void}
   */
  function applyDragFrame() {
    if (drag === null) return;
    const dx = drag.lastX - drag.startX;
    const dy = drag.lastY - drag.startY;

    if (drag.kind === 'pan') {
      panX = drag.originX + dx;
      panY = drag.originY + dy;
      applyView();
      return;
    }

    const node = get(drag.id);
    if (node === null) return;

    const stepX = dx / scale;
    const stepY = dy / scale;
    /* 顶部禁区的世界坐标下界，拖动开始时就算好，不必每帧重新量 DOM */
    const minWorldY = drag.minScreenY === null ? null : (drag.minScreenY - panY) / scale;

    for (const origin of drag.origins ?? [{ id: drag.id, x: drag.originX, y: drag.originY }]) {
      const target = get(origin.id);
      if (target === null) continue;
      /* 不再磁吸：以前按 12px 取整，拖起来是跳格的。现在跟手就是一像素一像素走。 */
      let nextX = origin.x + stepX;
      let nextY = origin.y + stepY;
      if (minWorldY !== null && nextY < minWorldY) nextY = minWorldY;
      target.x = nextX;
      target.y = nextY;
      positionNode(target);
    }
    /* 全组位置都定了再连一次线；原来是边改边连、还连了两遍 */
    syncEdges();
  }

  function onPointerUp() {
    if (drag === null) return;
    if (dragFrame !== null) {
      (doc?.defaultView?.cancelAnimationFrame ?? clearTimeout)(dragFrame);
      dragFrame = null;
      applyDragFrame();
    }
    const draggedId = drag.kind === 'node' ? drag.id : null;
    drag = null;
    if (draggedId !== null) {
      const node = get(draggedId);
      const element = elements.get(draggedId);
      const stageBox = (stage ?? root)?.getBoundingClientRect?.() ?? null;
      const box = element?.getBoundingClientRect?.() ?? null;
      if (node !== null && stageBox !== null && box !== null && box.top < (stageBox.top ?? 0)) {
        node.y += Math.ceil(((stageBox.top ?? 0) - box.top + 40) / scale);
        positionNode(node);
        syncEdges();
        notify();
      }
    }
    root?.removeAttribute('data-dragging');
    doc?.removeEventListener?.('pointermove', onPointerMove, true);
    doc?.removeEventListener?.('pointerup', onPointerUp, true);
  }

  /**
   * 缩放到指定倍率。
   * @param {number} next - 目标倍率（会被夹到 SCALE_MIN..SCALE_MAX）。
   * @param {{x?:number,y?:number}|null} [anchor] - 视口坐标锚点，缺省用视口中心。
   * @returns {void}
   */
  const zoomTo = (next, anchor = null) => {
    if (root === null) return;
    const clamped = Math.min(SCALE_MAX, Math.max(SCALE_MIN, Number(next) || 1));
    if (Math.abs(clamped - scale) < 0.001) return;
    const host = stage ?? root;
    const rect = typeof host.getBoundingClientRect === 'function' ? host.getBoundingClientRect() : { left: 0, top: 0 };
    const view = doc?.defaultView;
    const px = (anchor?.x ?? (view?.innerWidth ?? 1280) / 2) - (rect.left ?? 0);
    const py = (anchor?.y ?? (view?.innerHeight ?? 800) / 2) - (rect.top ?? 0);
    panX = px - ((px - panX) / scale) * clamped;
    panY = py - ((py - panY) / scale) * clamped;
    scale = clamped;
    applyView();
  };

  /**
   * 相对缩放。
   * @param {number} factor - 倍率因子。
   * @returns {void}
   */
  const zoomBy = (factor) => zoomTo(scale * (Number(factor) || 1));

  function onWheel(event) {
    if (root === null) return;
    const target = event.target;
    /* 画布透明层：默认让滚轮去滚页面；只有按住 Ctrl/⌘ 才缩放卡片 */
    if (event.ctrlKey !== true && event.metaKey !== true) return;
    const inside = target === root || (typeof root.contains === 'function' && root.contains(target));
    if (!inside) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = typeof root.getBoundingClientRect === 'function'
      ? root.getBoundingClientRect()
      : { left: 0, top: 0 };
    const px = (event.clientX ?? 0) - (rect.left ?? 0);
    const py = (event.clientY ?? 0) - (rect.top ?? 0);
    const next = Math.min(SCALE_MAX, Math.max(SCALE_MIN, scale * Math.exp(-(event.deltaY ?? 0) * 0.0012)));
    /* 让光标下的世界坐标保持不动 */
    panX = px - ((px - panX) / scale) * next;
    panY = py - ((py - panY) / scale) * next;
    scale = next;
    applyView();
  }

  /**
   * 画布开着时的快捷键（输入框里放行）。
   * @param {KeyboardEvent} event - 键盘事件。
   * @returns {void}
   */
  function onBoardKey(event) {
    if (root === null || root.getAttribute('data-open') === 'false') return;
    const tag = String(event.target?.tagName ?? '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || event.target?.isContentEditable === true) return;
    if (event.key === '+' || event.key === '=') { event.preventDefault(); zoomBy(1.2); return; }
    if (event.key === '-' || event.key === '_') { event.preventDefault(); zoomBy(1 / 1.2); return; }
    if (event.key === '0') { event.preventDefault(); zoomTo(1); }
  }

  const toggleCollapse = (id) => {
    const node = get(id);
    if (node === null) return;
    node.collapsed = node.collapsed !== true;
    elements.get(id)?.setAttribute('data-collapsed', node.collapsed === true ? 'true' : 'false');
    syncEdges();
    notify();
  };

  /**
   * 加节点（内部用）。
   * @param {{id:string, text:string, x:number, y:number, parentId:string|null, model?:object}} input - 参数。
   * @returns {object|null} 节点记录。
   */
  const addNode = (input) => {
    if (!ensureShell()) return null;
    if (indexOf(input.id) >= 0) return get(input.id);
    /* 同一句话只出现一次：已经有同文本的节点就复用它（否则画布上会出现一模一样的两个框）。 */
    const twin = input.allowTwin === true ? undefined : nodes.find((node) => node.text === String(input.text ?? ''));
    if (twin !== undefined) return twin;
    const parentId = input.parentId ?? null;
    const parent = parentId === null ? null : get(parentId);
    if (parentId !== null && parent === null) return null;
    const depth = parent === null ? 0 : depthOf(nodes, parent.id) + 1;
    if (depth > MAX_LEVELS - 1) return null;

    const node = {
      id: input.id,
      text: String(input.text ?? ''),
      x: Number(input.x) || 0,
      y: Number(input.y) || 0,
      parentId,
      depth,
      model: input.model ?? { pending: true },
      collapsed: false,
    };
    nodes.push(node);
    const section = buildNode(node);
    elements.set(node.id, section);
    nodeLayer.appendChild(section);
    positionNode(node);
    measure(node.id);
    syncEdges();
    notify();
    return node;
  };

  const remove = (id) => {
    const targets = descendantsOf(nodes, id);
    for (const target of targets) {
      const element = elements.get(target);
      if (element !== undefined && element.parentNode !== null) element.parentNode.removeChild(element);
      elements.delete(target);
      sizes.delete(target);
    }
    for (let i = nodes.length - 1; i >= 0; i -= 1) {
      if (targets.includes(nodes[i].id)) nodes.splice(i, 1);
    }
    syncEdges();
    notify();
    if (nodes.length === 0) hide();
    return targets.length;
  };

  const clearAll = () => {
    for (const element of elements.values()) {
      if (element.parentNode !== null) element.parentNode.removeChild(element);
    }
    elements.clear();
    sizes.clear();
    nodes.length = 0;
    syncEdges();
    hide();
    try {
      onClear?.();
    } catch {
      /* 忽略 */
    }
  };

  const show = () => {
    root?.setAttribute('data-open', 'true');
  };
  const hide = () => {
    root?.setAttribute('data-open', 'false');
  };

  return {
    /** 节点数组（只读视图，测试与调试用）。 */
    nodes,
    /**
     * 挂载外壳（幂等）。
     * @returns {void}
     */
    mount() {
      ensureShell();
    },
    /**
     * 开根节点（画布中心）。
     * @param {{id:string, text:string, model?:object}} input - 参数。
     * @returns {object|null} 节点。
     */
    openRoot(input) {
      const existing = get(input.id);
      if (existing !== null) {
        existing.text = input.text;
        existing.model = input.model ?? existing.model;
        refreshNode(existing);
        show();
            return existing;
      }
      const node = addNode({ id: input.id, text: input.text, x: 0, y: 0, parentId: null, model: input.model });
      if (node !== null) {
        show();
        centerOn(node);
          }
      return node;
    },
    /**
     * 在某节点下挂子节点（自动挑位置）。
     * @param {string} parentId - 父节点 id。
     * @param {{id:string, text:string, model?:object}} input - 子节点。
     * @returns {object|null} 节点；超出层数返回 null。
     */
    addChild(parentId, input) {
      const parent = get(parentId);
      if (parent === null) return null;
      if (parent.depth >= MAX_LEVELS - 1) return null;
      if (get(input.id) !== null) return get(input.id);
      const index = nodes.filter((node) => node.parentId === parentId).length;
      const spot = placeChild(nodes, parent, measure(parentId), index);
      const node = addNode({ id: input.id, text: input.text, x: spot.x, y: spot.y, parentId, model: input.model });
      if (node !== null) show();
      return node;
    },
    /**
     * 换内容（pending → 结果）。
     * @param {string} id - 节点 id。
     * @param {object} model - 卡片模型。
     * @returns {void}
     */
    update(id, model) {
      const node = get(id);
      if (node === null) return;
      node.model = model;
      refreshNode(node);
      syncEdges();
      },
    /**
     * 移动节点（拖拽内部用，测试也直接用）。
     * @param {string} id - 节点 id。
     * @param {number} x - 世界坐标 x。
     * @param {number} y - 世界坐标 y。
     * @returns {void}
     */
    move(id, x, y) {
      const node = get(id);
      if (node === null) return;
      node.x = Math.round(Number(x) || 0);
      node.y = Math.round(Number(y) || 0);
      positionNode(node);
      syncEdges();
    },
    /**
     * 读某条连线的 `d`（测试用：父 → 子）。
     * @param {string} parentId - 父 id。
     * @param {string} childId - 子 id。
     * @returns {string} path 的 d 属性；没有返回空串。
     */
    edgePath(parentId, childId) {
      if (edgeLayer === null) return '';
      for (const child of edgeLayer.children ?? []) {
        if (child.getAttribute?.('data-from') === parentId && child.getAttribute?.('data-to') === childId) {
          return child.getAttribute('d') ?? '';
        }
      }
      return '';
    },
    /**
     * 按文本找节点。
     * @param {string} text - 节点标题。
     * @returns {object|null} 节点。
     */
    findByText(text) {
      const wanted = String(text ?? '');
      return nodes.find((node) => node.text === wanted) ?? null;
    },
    /**
     * 当前画布快照（供持久化）。
     * @returns {{nodes:object[], view:{panX:number, panY:number, scale:number}}} 快照。
     */
    snapshot() {
      return {
        nodes: nodes.map((node) => ({
          id: node.id,
          text: node.text,
          x: node.x,
          y: node.y,
          parentId: node.parentId,
          collapsed: node.collapsed === true,
          model: node.model,
        })),
        view: { panX, panY, scale },
      };
    },
    /**
     * 从快照恢复（先清空）。
     * @param {object} snap - 快照。
     * @returns {number} 恢复的节点数。
     */
    restore(snap) {
      const list = Array.isArray(snap?.nodes) ? snap.nodes : [];
      clearAll();
      for (const item of list) {
        if (item === null || typeof item !== 'object' || typeof item.id !== 'string') continue;
        const created = addNode({
          id: item.id,
          text: item.text,
          x: Number(item.x) || 0,
          y: Number(item.y) || 0,
          parentId: item.parentId ?? null,
          model: item.model ?? {},
          allowTwin: true,
        });
        if (created !== null && item.collapsed === true) toggleCollapse(created.id);
      }
      const view = snap?.view;
      if (view !== null && typeof view === 'object') {
        if (Number.isFinite(view.panX)) panX = view.panX;
        if (Number.isFinite(view.panY)) panY = view.panY;
        if (Number.isFinite(view.scale)) scale = Math.min(SCALE_MAX, Math.max(SCALE_MIN, view.scale));
        applyView();
      }
      if (nodes.length > 0) show();
      return nodes.length;
    },
    /** 相对缩放（供 HUD 与快捷键调用）。 */
    zoomBy,
    /** 绝对缩放。 */
    zoomTo,
    /**
     * 当前视口参数（测试与调试用）。
     * @returns {{scale:number, panX:number, panY:number}} 视口。
     */
    view() {
      return { scale, panX, panY };
    },
    /** 当前选中的节点 id。 */
    selectedIds() {
      return [...selected];
    },
    /** 清空选中。 */
    clearSelection() {
      for (const id of selected) elements.get(id)?.setAttribute('data-selected', 'false');
      selected.clear();
    },
    /** 删掉选中的所有节点（各自连带后代）。 */
    removeSelected() {
      const ids = [...selected];
      selected.clear();
      for (const id of ids) remove(id);
      return ids.length;
    },
    /** 折叠/展开。 */
    toggleCollapse,
    /** 删节点（连带后代）。 */
    remove,
    /** 清空画布。 */
    clear: clearAll,
    /**
     * 当前有几个节点。
     * @returns {number} 数量。
     */
    count() {
      return nodes.length;
    },
    /** 重算连线（尺寸变化后手动调）。 */
    sync: syncEdges,
    /** 显示/隐藏。 */
    show,
    hide,
    /**
     * 卸载。
     * @returns {void}
     */
    dispose() {
      onPointerUp();
      clearAll();
      if (root !== null && root.parentNode !== null) {
        try {
          root.parentNode.removeChild(root);
        } catch {
          /* 忽略 */
        }
      }
      doc?.removeEventListener?.('pointerdown', onBoardPointerDown, true);
      doc?.removeEventListener?.('wheel', onWheel, true);
      doc?.removeEventListener?.('keydown', onBoardKey, true);
      root = null;
      world = null;
      stage = null;
      edgeLayer = null;
      nodeLayer = null;
      hud = null;
    },
  };
}
