/**
 * 批注：把一段话标红划掉，并在它**正上方**挂一个跟随文字的气泡写「改为：」。
 *
 * 两种进入方式：
 *   1. 选中后右键菜单「批注」——一次性，标完就结束；
 *   2. 右侧按钮 / 快捷键进入**批注模式**——此时右键拖选直接标红，**不弹菜单**。
 *
 * 语义两种：`rewrite`（改写，写替代文字）/ `strike`（划掉，不写替代）。
 * 发下一条消息后，之前的批注自动标 `submitted`（淡出），但仍留在 AGENTS.local.md 供模型读取。
 */

/** 本地存储键。 */
export const NOTES_KEY = 'dsh.knowledge-nest.notes';

/** 红高亮名。 */
export const NOTE_HIGHLIGHT = 'knest-note';

/** 浮层 id。 */
export const NOTE_LAYER_ID = 'knest-annotations';

/** 上限。 */
const MAX_NOTES = 60;

/**
 * 造批注器。
 * @param {{doc?:Document, win?:object, onchange?:Function}} [options] - 依赖。
 * @returns {object} 句柄。
 */
export function createAnnotator(options = {}) {
  const doc = options.doc ?? (typeof globalThis.document === 'undefined' ? null : globalThis.document);
  const win = options.win ?? (typeof globalThis === 'undefined' ? null : globalThis);
  const onchange = options.onchange;

  /** @type {object[]} */
  let notes = readNotes();
  /** @type {Map<string, Range>} */
  const ranges = new Map();
  /** @type {Map<string, HTMLElement>} */
  const bubbles = new Map();
  let mode = false;
  let layer = null;
  let counter = 0;
  let raf = 0;

  const registry = win?.CSS?.highlights ?? null;
  const HighlightCtor = win?.Highlight ?? null;
  const supported = registry !== null && typeof HighlightCtor === 'function';

  function readNotes() {
    try {
      const raw = win?.localStorage?.getItem(NOTES_KEY);
      if (typeof raw !== 'string' || raw === '') return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((item) => item !== null && typeof item === 'object') : [];
    } catch {
      return [];
    }
  }

  const persist = () => {
    try {
      win?.localStorage?.setItem(NOTES_KEY, JSON.stringify(notes));
    } catch {
      /* 忽略 */
    }
    try {
      onchange?.(notes.slice());
    } catch {
      /* 忽略 */
    }
  };

  const ensureLayer = () => {
    if (doc === null) return null;
    if (layer !== null && layer.isConnected !== false) return layer;
    layer = doc.getElementById?.(NOTE_LAYER_ID) ?? null;
    if (layer === null) {
      layer = doc.createElement('div');
      layer.id = NOTE_LAYER_ID;
      layer.className = 'knest-notes-layer';
      (doc.body ?? doc.documentElement).appendChild(layer);
    }
    return layer;
  };

  const repaint = () => {
    if (!supported) return;
    try {
      const list = [...ranges.values()].filter((range) => range !== null);
      if (list.length === 0) registry.delete(NOTE_HIGHLIGHT);
      else registry.set(NOTE_HIGHLIGHT, new HighlightCtor(...list));
    } catch {
      /* 忽略 */
    }
  };

  /**
   * 把气泡挪到红字正上方（跟随滚动）。
   * @returns {void}
   */
  const reposition = () => {
    for (const note of notes) {
      const box = bubbles.get(note.id);
      const range = ranges.get(note.id);
      if (box === undefined || range === undefined) continue;
      let rect = null;
      try {
        rect = range.getBoundingClientRect();
      } catch {
        rect = null;
      }
      if (rect === null || (rect.width === 0 && rect.height === 0)) continue;
      const height = box.offsetHeight || 40;
      const above = rect.top - height - 6;
      box.style.left = `${Math.round(Math.max(8, rect.left))}px`;
      /* 上面放不下就翻到文字下方，别被窗口顶切掉 */
      box.style.top = `${Math.round(above >= 8 ? above : rect.bottom + 6)}px`;
      box.setAttribute('data-side', above >= 8 ? 'above' : 'below');
    }
  };

  /** 下一帧重排（滚动时别每像素都算）。 */
  const scheduleReposition = () => {
    if (raf !== 0) return;
    const rafFn = win?.requestAnimationFrame ?? ((fn) => setTimeout(fn, 16));
    raf = rafFn(() => {
      raf = 0;
      reposition();
    });
  };

  /**
   * 造气泡。
   * @param {object} note - 批注。
   * @returns {HTMLElement} 气泡。
   */
  const buildBubble = (note) => {
    const box = doc.createElement('div');
    box.className = 'knest-note-bubble';
    box.setAttribute('data-note-id', note.id);
    box.setAttribute('data-kind', note.kind === 'strike' ? 'strike' : 'rewrite');
    box.setAttribute('data-collapsed', note.collapsed === false ? 'false' : 'true');
    box.setAttribute('data-submitted', note.submitted === true ? 'true' : 'false');

    const head = doc.createElement('div');
    head.className = 'knest-note-head';

    const kindBtn = doc.createElement('button');
    kindBtn.className = 'knest-note-kind';
    kindBtn.type = 'button';
    kindBtn.textContent = note.kind === 'strike' ? '划掉' : '改写';
    kindBtn.title = '切换：改写 / 划掉';
    kindBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      note.kind = note.kind === 'strike' ? 'rewrite' : 'strike';
      box.setAttribute('data-kind', note.kind);
      kindBtn.textContent = note.kind === 'strike' ? '划掉' : '改写';
      persist();
    });

    const kill = doc.createElement('button');
    kill.className = 'knest-note-del';
    kill.type = 'button';
    kill.textContent = '×';
    kill.title = '删掉这条批注';
    kill.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      remove(note.id);
    });

    head.appendChild(kindBtn);
    head.appendChild(kill);

    const field = doc.createElement('textarea');
    field.className = 'knest-note-input';
    field.rows = 1;
    field.placeholder = '改为：';
    field.value = typeof note.note === 'string' ? note.note : '';
    field.addEventListener('input', () => {
      note.note = field.value;
      field.style.height = 'auto';
      field.style.height = `${field.scrollHeight}px`;
      persist();
    });
    field.addEventListener('focus', () => {
      box.setAttribute('data-collapsed', 'false');
      note.collapsed = false;
    });

    box.appendChild(head);
    box.appendChild(field);

    box.addEventListener('click', (event) => {
      if (event.target === field) return;
      const collapsed = box.getAttribute('data-collapsed') === 'true';
      box.setAttribute('data-collapsed', collapsed ? 'false' : 'true');
      note.collapsed = !collapsed;
      if (!collapsed) return;
      scheduleReposition();
    });

    return box;
  };

  /**
   * 加一条。
   * @param {{phrase:string, range?:Range|null, rect?:object|null, kind?:string}} input - 选区。
   * @returns {object|null} 批注。
   */
  const add = (input) => {
    const phrase = typeof input?.phrase === 'string' ? input.phrase.trim() : '';
    if (phrase === '') return null;
    const range = input?.range ?? null;
    const rect = input?.rect ?? (typeof range?.getBoundingClientRect === 'function' ? range.getBoundingClientRect() : null);
    /* 同一句话在同一处反复拖：复用已有那条 */
    const twin = notes.find((item) => item.phrase === phrase
      && Number.isFinite(item.x) && rect !== null
      && Math.abs(item.x - rect.left) < 6);
    if (twin !== undefined) return twin;

    counter += 1;
    const note = {
      id: `a-${Date.now().toString(36)}-${counter}`,
      phrase,
      note: '',
      kind: input?.kind === 'strike' ? 'strike' : 'rewrite',
      ts: Date.now(),
      submitted: false,
      collapsed: true,
      x: rect === null ? Number.NaN : rect.left,
      y: rect === null ? Number.NaN : rect.top,
    };
    notes.push(note);
    while (notes.length > MAX_NOTES) notes.shift();
    if (range !== null) ranges.set(note.id, range);
    repaint();

    const host = ensureLayer();
    if (host !== null) {
      const box = buildBubble(note);
      bubbles.set(note.id, box);
      host.appendChild(box);
      scheduleReposition();
      /* 改写语义：一出现就展开并聚焦，光标在那儿等同用户输入；划掉则不需要 */
      if (note.kind !== 'strike') {
        box.setAttribute('data-collapsed', 'false');
        note.collapsed = false;
        const field = typeof box.querySelector === 'function' ? box.querySelector('.knest-note-input') : null;
        try {
          field?.focus?.();
          const end = String(field?.value ?? '').length;
          field?.setSelectionRange?.(end, end);
        } catch {
          /* 忽略 */
        }
      }
    }
    persist();
    return note;
  };

  const update = (id, patch) => {
    const note = notes.find((item) => item.id === id);
    if (note === undefined) return;
    /* 传字符串 = 只改写后内容；传对象 = 改任意字段（note / kind / submitted） */
    if (typeof patch === 'string') note.note = patch;
    else if (patch !== null && typeof patch === 'object') Object.assign(note, patch);
    persist();
  };

  const remove = (id) => {
    notes = notes.filter((item) => item.id !== id);
    ranges.delete(id);
    repaint();
    const box = bubbles.get(id);
    if (box !== undefined && box.parentNode !== null) box.parentNode.removeChild(box);
    bubbles.delete(id);
    persist();
  };

  const clear = () => {
    notes = [];
    ranges.clear();
    repaint();
    for (const box of bubbles.values()) if (box.parentNode !== null) box.parentNode.removeChild(box);
    bubbles.clear();
    persist();
  };

  const since = (mark) => {
    const limit = Number.isFinite(mark) ? mark : 0;
    return notes.filter((note) => Number(note.ts) > limit);
  };

  return {
    /** 清空全部批注（含红高亮与气泡）。 */
    clearAll() {
      clear();
    },
    isOn() {
      return mode;
    },
    setMode(next) {
      mode = next === true;
      doc?.body?.setAttribute?.('data-knest-annotate', mode ? 'true' : 'false');
      return mode;
    },
    add,
    update,
    remove,
    clear,
    since,
    /** 未提交的批注。 */
    pending() {
      return notes.filter((note) => note.submitted !== true);
    },
    /**
     * 发消息后把"已发生"的批注标为已提交（淡出）。
     * @param {number} before - 时间点。
     * @returns {number} 标记条数。
     */
    submitAll(before) {
      const limit = Number.isFinite(before) ? before : Date.now();
      let count = 0;
      for (const note of notes) {
        if (note.submitted === true || Number(note.ts) > limit) continue;
        note.submitted = true;
        count += 1;
        bubbles.get(note.id)?.setAttribute('data-submitted', 'true');
      }
      if (count > 0) persist();
      return count;
    },
    list() {
      return notes.slice();
    },
    supported,
    reposition,
    restore() {
      const host = ensureLayer();
      if (host === null) return 0;
      for (const note of notes) {
        const box = buildBubble(note);
        bubbles.set(note.id, box);
        host.appendChild(box);
      }
      scheduleReposition();
      return notes.length;
    },
    dispose() {
      try {
        registry?.delete?.(NOTE_HIGHLIGHT);
      } catch {
        /* 忽略 */
      }
      if (layer !== null && layer.parentNode !== null) layer.parentNode.removeChild(layer);
      layer = null;
      bubbles.clear();
      doc?.body?.removeAttribute?.('data-knest-annotate');
    },
  };
}
