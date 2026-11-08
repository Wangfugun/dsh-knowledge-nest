/**
 * 右键按住圈词（**全文档**，不只在插件视图里）。
 *
 * 为什么不用浏览器原生选区：
 *   1) 左键选字会跟宿主聊天区自己的选择/复制打架；
 *   2) 我们要的手势是「按住右键拖过一段 → 松手就问」，原生选区没有这个动作。
 *
 * 手势契约：
 *   右键按下（落在正文上）→ 吞掉默认行为 → 拖动时实时回调 Range →
 *   松手（拖动过 = 两点取文；没拖动 = 指针所在整句）→ 回调 onPick；
 *   紧接着那一下 `contextmenu` 也吞掉，别弹系统菜单。
 *
 * 不碰输入框：在 input/textarea/select/contenteditable 上按下直接放行（用户可能想粘贴）。
 */
import { expandSentenceAt, normalizePhrase, pointAt, rangeBetween } from './phrase.js';

/** 判定"拖过"的像素阈值。 */
const DRAG_THRESHOLD = 3;

/** 松手后多久内继续吞 contextmenu。 */
const SWALLOW_MS = 500;

/**
 * 挂载圈选手势。
 * @param {Document} doc - 文档。
 * @param {object} [handlers] - 回调。
 * @param {(range:Range|null)=>void} [handlers.onLive] - 拖动中的实时选区。
 * @param {(payload:{phrase:string, sentence:string, range:Range|null, rect:object})=>void} [handlers.onPick] - 松手。
 * @param {()=>void} [handlers.onCancel] - 取消（Esc / 失焦）。
 * @returns {{dispose:Function, cancel:Function, active:Function}} 句柄。
 */
export function attachSelector(doc, handlers = {}) {
  if (doc === null || doc === undefined || typeof doc.addEventListener !== 'function') {
    return { dispose() {}, cancel() {}, active: () => false };
  }
  const view = doc.defaultView ?? null;
  const isEnabled = typeof handlers.isEnabled === 'function' ? handlers.isEnabled : () => true;
  let armed = false;
  let startButton = 2;
  let moved = false;
  let startPoint = null;
  let startX = 0;
  let startY = 0;
  let swallowUntil = 0;
  let warned = false;

  /**
   * 回调抛错只报一次：既不刷屏，也不至于让 bug 彻底静音。
   * @param {unknown} error - 异常。
   * @returns {void}
   */
  const warnOnce = (error) => {
    if (warned) return;
    warned = true;
    try {
      console.warn('[knest] 圈词回调抛错：', error);
    } catch {
      /* 忽略 */
    }
  };

  const isEditable = (target) => {
    if (target === null || target === undefined || typeof target.closest !== 'function') return false;
    const tag = String(target.nodeName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'OPTION') return true;
    try {
      if (target.isContentEditable === true) return true;
      return target.closest('[contenteditable="true"]') !== null;
    } catch {
      return false;
    }
  };

  const reset = () => {
    armed = false;
    moved = false;
    startPoint = null;
  };

  const cancel = () => {
    if (!armed) return;
    reset();
    try {
      handlers.onCancel?.();
    } catch {
      /* 回调异常不能把页面带崩 */
    }
  };

  function onDown(event) {
    /* 右键 = 圈词；左键只在批注模式里接管（批注用左键拖选）。 */
    const left = event.button === 0 && options.leftEnabled?.() === true;
    if (event.button !== 2 && !left) return;
    /* 圈词关着的时候完全不接管右键：让 contextmenu 走到菜单那边去。 */
    if (event.button === 2 && isEnabled() !== true) return;
    if (isEditable(event.target)) return;
    const point = pointAt(doc, event.clientX, event.clientY);
    if (point === null || point.container === null || point.container === undefined) return;
    armed = true;
    moved = false;
    startButton = event.button;
    startPoint = point;
    startX = event.clientX;
    startY = event.clientY;
    event.preventDefault();
    event.stopPropagation();
  }

  function onMove(event) {
    if (!armed) return;
    if (!moved && Math.abs(event.clientX - startX) + Math.abs(event.clientY - startY) > DRAG_THRESHOLD) moved = true;
    if (!moved) return;
    event.preventDefault();
    const end = pointAt(doc, event.clientX, event.clientY);
    const { range } = rangeBetween(doc, startPoint, end);
    try {
      /* 带上指针坐标：调用方要用它把「已选 N 字」贴到光标旁边 */
      handlers.onLive?.(range, { x: event.clientX, y: event.clientY });
    } catch {
      /* 忽略 */
    }
  }

  function onUp(event) {
    if (!armed) return;
    const dropPoint = pointAt(doc, event.clientX, event.clientY);
    const wasMoved = moved;
    const origin = startPoint;
    reset();
    swallowUntil = Date.now() + SWALLOW_MS;
    event.preventDefault();
    event.stopPropagation();
    if (wasMoved) {
      const { range, text } = rangeBetween(doc, origin, dropPoint);
      const phrase = normalizePhrase(text);
      if (phrase === '') {
        handlers.onCancel?.();
        return;
      }
      const rect = rectOf(range, event);
      try {
        handlers.onPick?.({ phrase, sentence: phrase, range, rect, button: startButton, dragged: true, docText: contextAroundRange(range, phrase) });
      } catch (error) {
        /* 不要静默：上一版菜单构建抛错被这里吞掉，表现成「右键没反应」。 */
        warnOnce(error);
      }
      return;
    }
    /* 没拖动：取指针所在整句（点在图标/空白上就取消）。 */
    const point = dropPoint ?? origin;
    const data = point !== null && point !== undefined && typeof point.container?.data === 'string'
      ? point.container.data
      : (point?.container?.textContent ?? '');
    const sentence = typeof data === 'string' ? expandSentenceAt(data, point?.offset ?? 0) : '';
    if (sentence === '') {
      handlers.onCancel?.();
      return;
    }
    /* 没拖动时给 `range: null`：让调用方按整句文本重新解析 Range。
       这里若自己造一个 1 字的 Range，就会把一句话高亮成一个字（踩过）。 */
    try {
      handlers.onPick?.({ phrase: sentence, sentence, range: null, rect: rectOf(null, event), button: startButton, dragged: false });
    } catch {
      /* 忽略 */
    }
  }

  /**
   * 取选区的屏幕位置；拿不到就退回鼠标位置。
   * @param {Range|null} range - 选区。
   * @param {MouseEvent} event - 事件。
   * @returns {{left:number, top:number, right:number, bottom:number, width:number, height:number}} 矩形。
   */
  function rectOf(range, event) {
    try {
      const rect = range?.getBoundingClientRect?.();
      if (rect !== null && rect !== undefined && (rect.width > 0 || rect.height > 0)) {
        return {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        };
      }
    } catch {
      /* 忽略 */
    }
    const x = Number.isFinite(event?.clientX) ? event.clientX : 0;
    const y = Number.isFinite(event?.clientY) ? event.clientY : 0;
    return { left: x, top: y, right: x, bottom: y, width: 0, height: 0 };
  }

  function onContextMenu(event) {
    if (armed || Date.now() < swallowUntil) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function onKeyDown(event) {
    if (event?.key === 'Escape') cancel();
  }

  function onBlur() {
    cancel();
  }

  doc.addEventListener('mousedown', onDown, true);
  doc.addEventListener('mousemove', onMove, true);
  doc.addEventListener('mouseup', onUp, true);
  doc.addEventListener('contextmenu', onContextMenu, true);
  doc.addEventListener('keydown', onKeyDown, true);
  if (view !== null && typeof view.addEventListener === 'function') view.addEventListener('blur', onBlur);

  return {
    dispose() {
      doc.removeEventListener('mousedown', onDown, true);
      doc.removeEventListener('mousemove', onMove, true);
      doc.removeEventListener('mouseup', onUp, true);
      doc.removeEventListener('contextmenu', onContextMenu, true);
      doc.removeEventListener('keydown', onKeyDown, true);
      if (view !== null && typeof view.removeEventListener === 'function') view.removeEventListener('blur', onBlur);
      reset();
    },
    cancel,
    active: () => armed,
  };
}
