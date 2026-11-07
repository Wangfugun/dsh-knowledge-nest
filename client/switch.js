/**
 * 「启用圈词」开关：贴在对话区**右侧边缘**的一块竖牌。
 *
 * 为什么竖着：聊天区右侧本来就窄，横排一按钮会压住宿主自己的悬浮操作；
 * 竖排中文（`writing-mode: vertical-rl`）只占 30px 宽，还能一眼看到「启用圈词」四个字。
 *
 * 点击切换，快捷键（默认 `Alt+Q`，设置里可改）同样切换；
 * 用快捷键切换时会在牌子上闪一下「已开启 / 已关闭」，不然用户看不见状态变了。
 */

/** 根 id。 */
const SWITCH_ID = 'knest-switch';

/**
 * 造开关。
 * @param {{doc?:Document, getEnabled?:Function, onChange?:Function, getShortcut?:Function}} [options] - 依赖。
 * @returns {{mount:Function, sync:Function, flash:Function, dispose:Function}} 句柄。
 */
export function createSwitch(options = {}) {
  const doc = options.doc ?? (typeof globalThis.document === 'undefined' ? null : globalThis.document);
  const getEnabled = typeof options.getEnabled === 'function' ? options.getEnabled : () => true;
  const getShortcut = typeof options.getShortcut === 'function' ? options.getShortcut : () => '';
  const onChange = options.onChange;

  let root = null;
  let button = null;
  let label = null;
  let timer = null;

  const sync = () => {
    if (root === null) return;
    const on = getEnabled() === true;
    root.dataset.on = on ? 'true' : 'false';
    if (button !== null) {
      button.setAttribute('aria-checked', on ? 'true' : 'false');
      const shortcut = getShortcut();
      button.title = on
        ? `知识库已启用：按住右键拖过要问的字${shortcut ? `（${shortcut} 关闭）` : ''}`
        : `知识库已关闭：右键会弹出选区菜单${shortcut ? `（${shortcut} 开启）` : ''}`;
    }
    if (label !== null && timer === null) label.textContent = '知识库';
  };

  /* 提示条：独立浮层。以前直接写进竖排标签，长句子会被挤成一条竖线。 */
  let toast = null;

  const flash = (message) => {
    if (toast === null && label === null) return;
    const text = String(message ?? '');
    if (toast !== null) {
      toast.textContent = text;
      toast.setAttribute('data-show', 'true');
    }
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (toast !== null) toast.setAttribute('data-show', 'false');
    }, 2400);
  };

  return {
    /**
     * 挂载（幂等）。
     * @returns {void}
     */
    mount() {
      if (doc === null) return;
      if (root !== null && root.isConnected !== false) return;
      const existing = typeof doc.getElementById === 'function' ? doc.getElementById(SWITCH_ID) : null;
      const host = existing ?? doc.createElement('div');
      if (existing === null) {
        host.id = SWITCH_ID;
        toast = doc.createElement('div');
      toast.className = 'knest-toast';
      toast.setAttribute('data-show', 'false');
      (doc.body ?? doc.documentElement).appendChild(toast);
      (doc.body ?? doc.documentElement).appendChild(host);
      }
      host.className = 'knest-switch';
      host.textContent = '';

      label = doc.createElement('span');
      label.className = 'knest-switch-text';
      label.textContent = '知识库';

      const dot = doc.createElement('span');
      dot.className = 'knest-switch-dot';
      dot.setAttribute('aria-hidden', 'true');

      button = doc.createElement('button');
      button.type = 'button';
      button.className = 'knest-switch-btn';
      button.setAttribute('role', 'switch');
      button.appendChild(label);
      button.appendChild(dot);
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const next = getEnabled() !== true;
        try {
          onChange?.(next);
        } catch {
          /* 忽略 */
        }
        sync();
      });

      host.appendChild(button);
      root = host;
      sync();
    },
    sync,
    flash,
    /**
     * 卸载。
     * @returns {void}
     */
    dispose() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      if (root !== null && root.parentNode !== null) {
        try {
          root.remove();
        } catch {
          /* 忽略 */
        }
      }
      root = null;
      button = null;
      label = null;
    },
  };
}
