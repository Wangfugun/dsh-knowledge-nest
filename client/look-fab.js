/**
 * 右下角的词林入口 + 外观浮层。
 *
 * 为什么单独一个文件：DSH 版是 React，Cherry 版是纯 DOM，两边都想要
 * 「右下角一个按钮，点开调风格」，那就用一个不依赖 React 的实现，
 * 各自 mount 一次即可。
 *
 * 浮层里只放外观四件（风格 / 卡片大小 / 解释长度 / 语言），
 * 模型与钥匙那部分仍归各宿主自己的设置——两件事不要混在一起。
 */

import { createAppearanceSection } from './appearance.js';
import { applyPrefs, readPrefs } from './prefs.js';
import { t } from './i18n.js';

const HOST_ID = 'knest-look-fab';

/**
 * 挂上入口按钮与浮层。
 *
 * @param {{doc?:Document, win?:object, onToast?:Function}} [options] - 参数。
 * @returns {{dispose:Function, el:HTMLElement, open:Function, close:Function}} 句柄。
 */
export function mountLookFab(options = {}) {
  const win = options.win ?? globalThis;
  const doc = options.doc ?? win.document;
  if (!doc?.body) {
    return { dispose: () => {}, el: doc?.createElement?.('div') ?? null, open: () => {}, close: () => {} };
  }

  /* 已经挂过就先摘掉，避免热重载叠出两个按钮 */
  doc.getElementById(HOST_ID)?.remove();

  applyPrefs();

  const host = doc.createElement('div');
  host.id = HOST_ID;

  /* 按钮 */
  const btn = doc.createElement('button');
  btn.type = 'button';
  btn.className = 'knest-logo-btn';
  btn.title = t('词林 · 外观、长度、语言都在这里');
  btn.innerHTML = '<span class="g">词</span><span class="knest-fab-txt">词林</span>';

  /* 语言代码直接挂在按钮上：出问题时一眼能看出是「代码没生效」还是「逻辑有问题」 */
  const badge = doc.createElement('span');
  badge.className = 'knest-fab-lang';
  btn.appendChild(badge);

  /**
   * 刷新按钮上的语言标记。
   * @returns {void}
   */
  const paintBadge = () => {
    badge.textContent = readPrefs().lang;
  };
  paintBadge();

  /* 浮层 */
  const panel = doc.createElement('div');
  panel.className = 'knest-look-panel';
  panel.setAttribute('data-open', 'false');

  const head = doc.createElement('div');
  head.className = 'knest-look-head';
  const title = doc.createElement('b');
  title.textContent = t('外观');
  const x = doc.createElement('button');
  x.type = 'button';
  x.className = 'knest-look-x';
  x.textContent = '×';
  x.title = t('关闭');
  head.appendChild(title);
  head.appendChild(x);

  const appearance = createAppearanceSection({ doc, onChange: () => {} });

  panel.appendChild(head);
  panel.appendChild(appearance.el);

  host.appendChild(btn);
  host.appendChild(panel);
  doc.body.appendChild(host);

  let open = false;

  /**
   * 开关浮层。
   * @param {boolean} [next] - 指定开或关；不传就切换。
   * @returns {void}
   */
  const setOpen = (next) => {
    open = next === undefined ? !open : Boolean(next);
    panel.setAttribute('data-open', open ? 'true' : 'false');
    btn.setAttribute('data-open', open ? 'true' : 'false');
  };

  const onBtn = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setOpen();
  };
  const onX = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setOpen(false);
  };
  /* 点面板以外的地方收起。用捕获阶段，免得被宿主的点击拦住 */
  const onDocDown = (event) => {
    if (!open) return;
    if (host.contains(event.target)) return;
    setOpen(false);
  };
  const onKey = (event) => {
    if (event.key === 'Escape' && open) setOpen(false);
  };

  btn.addEventListener('click', onBtn);
  btn.addEventListener('contextmenu', (event) => event.stopPropagation());
  x.addEventListener('click', onX);
  const onPrefs = () => {
    paintBadge();
    appearance.refresh?.();
    title.textContent = t('外观');
  };
  win.addEventListener?.('knest-prefs', onPrefs);

  doc.addEventListener('pointerdown', onDocDown, true);
  doc.addEventListener('keydown', onKey, true);

  return {
    el: host,
    open: () => setOpen(true),
    close: () => setOpen(false),
    /**
     * 摘掉按钮、浮层和全部监听。
     * @returns {void}
     */
    dispose: () => {
      btn.removeEventListener('click', onBtn);
      x.removeEventListener('click', onX);
      doc.removeEventListener('pointerdown', onDocDown, true);
      doc.removeEventListener('keydown', onKey, true);
      win.removeEventListener?.('knest-prefs', onPrefs);
      host.remove();
    },
  };
}
