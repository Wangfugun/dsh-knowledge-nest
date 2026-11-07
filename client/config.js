/**
 * 前端配置：开关、模型、快捷键、上下文档位。
 *
 * 一条原则：**任何一项读坏了都不该把功能带崩**。localStorage 可能被禁用、被写进垃圾，
 * 所以每个字段都单独兜底，坏值回默认，绝不 throw。
 */

/** 配置键。 */
export const CONFIG_KEY = 'dsh.knowledge-nest.config';

/** 默认快捷键。 */
export const DEFAULT_SHORTCUT = 'Alt+Q';

/** 默认配置。 */
export const DEFAULT_CONFIG = Object.freeze({
  enabled: true,
  model: '',
  shortcut: DEFAULT_SHORTCUT,
  depth: 'compact',
  /* 批注区间起点：assistant = 上一条助手回复；user = 上一次用户消息 */
  annotateWindow: 'assistant',
  /* 批注模式开关的快捷键（可在 localStorage 里改） */
  annotateShortcut: 'Alt+A',
});

/**
 * 安全取 localStorage。
 * @param {Window|object} [win] - 宿主窗口。
 * @returns {Storage|null} 存储；不可用是 null。
 */
export function localStore(win) {
  try {
    const store = win?.localStorage ?? null;
    if (store === null || store === undefined) return null;
    /* 有的环境里 localStorage 存在但一碰就抛（隐私模式）。 */
    const probe = '__knest_probe__';
    store.setItem(probe, '1');
    store.removeItem(probe);
    return store;
  } catch {
    return null;
  }
}

/**
 * 读配置。
 * @param {Window|object} [win] - 宿主窗口。
 * @returns {{enabled:boolean, model:string, shortcut:string, depth:string}} 归一化配置。
 */
export function readConfig(win) {
  const store = localStore(win);
  const base = { ...DEFAULT_CONFIG };
  if (store === null) return base;
  try {
    const raw = store.getItem(CONFIG_KEY);
    if (raw === null || raw === '') return base;
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object') return base;
    return {
      enabled: parsed.enabled === false ? false : true,
      model: typeof parsed.model === 'string' ? parsed.model : '',
      shortcut: typeof parsed.shortcut === 'string' && parsed.shortcut.trim() !== '' ? parsed.shortcut.trim() : base.shortcut,
      depth: parsed.depth === 'standard' || parsed.depth === 'deep' ? parsed.depth : 'compact',
      annotateShortcut: typeof parsed.annotateShortcut === 'string' && parsed.annotateShortcut.trim() !== ''
        ? parsed.annotateShortcut.trim()
        : base.annotateShortcut,
      annotateWindow: parsed.annotateWindow === 'user' ? 'user' : 'assistant',
    };
  } catch {
    return base;
  }
}

/**
 * 写配置（合并）。
 * @param {Window|object} [win] - 宿主窗口。
 * @param {object} patch - 变更项。
 * @returns {object} 写入后的配置。
 */
export function writeConfig(win, patch) {
  const next = { ...readConfig(win), ...(patch !== null && typeof patch === 'object' ? patch : {}) };
  const store = localStore(win);
  if (store === null) return next;
  try {
    store.setItem(CONFIG_KEY, JSON.stringify(next));
  } catch {
    /* 存不下就算了 */
  }
  return next;
}

/** 允许当作快捷键主键的名字（其余必须是单个字符）。 */
const NAMED_KEYS = new Set([
  'space', 'enter', 'tab', 'escape', 'backspace', 'delete', 'home', 'end',
  'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'pageup', 'pagedown',
  'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9', 'f10', 'f11', 'f12',
]);

/**
 * 按键是否合法（单字符，或命名键）。
 * @param {string} key - 小写键名。
 * @returns {boolean} 是否合法。
 */
function validKey(key) {
  return key.length === 1 || NAMED_KEYS.has(key);
}

/**
 * 解析快捷键串（`Alt+Q`、`Ctrl+Shift+K`、`Meta+Enter`）。
 * @param {unknown} spec - 快捷键串。
 * @returns {{key:string, ctrl:boolean, alt:boolean, shift:boolean, meta:boolean}|null} 解析结果。
 */
export function parseShortcut(spec) {
  const text = typeof spec === 'string' ? spec.trim() : '';
  if (text === '') return null;
  const parts = text.split('+').map((part) => part.trim()).filter((part) => part !== '');
  if (parts.length === 0) return null;
  const keyRaw = parts.pop();
  const lowered = keyRaw.toLowerCase();
  if (!validKey(lowered)) return null;
  const key = lowered === 'space' ? ' ' : lowered;
  const flags = { ctrl: false, alt: false, shift: false, meta: false };
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === 'ctrl' || lower === 'control') flags.ctrl = true;
    else if (lower === 'alt' || lower === 'option') flags.alt = true;
    else if (lower === 'shift') flags.shift = true;
    else if (lower === 'meta' || lower === 'cmd' || lower === 'command' || lower === 'win') flags.meta = true;
    else return null;
  }
  return { key, ...flags };
}

/**
 * 事件是不是这个快捷键。
 * @param {KeyboardEvent} event - 键盘事件。
 * @param {unknown} spec - 快捷键串。
 * @returns {boolean} 是否命中。
 */
export function matchShortcut(event, spec) {
  const parsed = parseShortcut(spec);
  if (parsed === null || event === null || event === undefined) return false;
  const key = typeof event.key === 'string' ? event.key.toLowerCase() : '';
  if (key !== parsed.key) return false;
  return event.ctrlKey === parsed.ctrl
    && event.altKey === parsed.alt
    && event.shiftKey === parsed.shift
    && event.metaKey === parsed.meta;
}

/**
 * 从键盘事件反推一个快捷键串（设置页录制用）。
 * @param {KeyboardEvent} event - 键盘事件。
 * @returns {string|null} 快捷键串；只按了修饰键返回 null。
 */
export function shortcutFromEvent(event) {
  if (event === null || event === undefined) return null;
  const key = typeof event.key === 'string' ? event.key : '';
  if (key === '' || key === 'Control' || key === 'Alt' || key === 'Shift' || key === 'Meta' || key === 'Dead') return null;
  const parts = [];
  if (event.ctrlKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  if (event.metaKey) parts.push('Meta');
  parts.push(key === ' ' ? 'Space' : (key.length === 1 ? key.toUpperCase() : key));
  return parts.join('+');
}
