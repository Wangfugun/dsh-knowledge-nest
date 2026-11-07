/**
 * 独立外壳：不依赖 React、不依赖 DSH 插槽，把一个「圈词」界面挂到任何网页或 Electron 窗口里。
 *
 * 这是给 Cherry Studio、WorkBuddy 这类宿主用的：它们的渲染进程就是一个 Chromium 页面，
 * 我们用 CDP 把这份代码注入进去，它就在页面里跑起来，和 DSH 里用的是同一套模块。
 *
 * 与 DSH 版的差别只有两处：
 *   1. 没有 `ctx.slots`，界面自己挂到 body；
 *   2. 解释请求打到外部端点（默认 http://127.0.0.1:7331），而不是插件的宿主路由。
 */

import { buildCard, buildErrorCard, buildPendingCard, parentContextOf } from './card.js';
import { createExplainApi } from './api.js';
import { attachSelector } from './selector.js';
import { createPainter } from './painter.js';
import { createTreeBoard } from './tree-board.js';
import { createMenu } from './menu.js';
import { createAnnotator } from './annotate.js';
import { KNEST_CSS } from './styles.js';
import { contextAroundRange } from './phrase.js';
import { hashString } from './util.js';

/** 注入到页面上的全局名。 */
export const GLOBAL_KEY = '__knestStandalone';

/**
 * 挂载。
 * @param {{endpoint?:string, appName?:string, doc?:Document, win?:object}} [options] - 配置。
 * @returns {{dispose:Function, board:object}} 句柄。
 */
export function mountKnest(options = {}) {
  const win = options.win ?? globalThis;
  const doc = options.doc ?? win.document;
  const endpoint = typeof options.endpoint === 'string' && options.endpoint !== ''
    ? options.endpoint.replace(/\/+$/u, '')
    : 'http://127.0.0.1:7331';

  const api = createExplainApi({ endpoint: `${endpoint}/explain` });

  /* 样式只注入一次 */
  if (doc.getElementById('knest-style') === null) {
    const style = doc.createElement('style');
    style.id = 'knest-style';
    style.textContent = KNEST_CSS;
    (doc.head ?? doc.documentElement).appendChild(style);
  }
  if (doc.documentElement.getAttribute('data-knest-theme') === null) {
    doc.documentElement.setAttribute('data-knest-theme', 'dark');
  }

  const painter = createPainter(doc);
  let flashToast = null;
  /**
   * 轻提示（独立版没有侧边竖牌，用一条浮出来的小条）。
   * @param {string} message - 文案。
   * @returns {void}
   */
  const flash = (message) => {
    try {
      if (flashToast === null || flashToast.parentNode === null) {
        flashToast = doc.createElement('div');
        flashToast.className = 'knest-toast';
        flashToast.setAttribute('data-show', 'false');
        (doc.body ?? doc.documentElement).appendChild(flashToast);
      }
      flashToast.textContent = String(message ?? '');
      flashToast.setAttribute('data-show', 'true');
      win.setTimeout(() => flashToast?.setAttribute('data-show', 'false'), 2200);
    } catch {
      /* 忽略 */
    }
  };

  const board = createTreeBoard({
    doc,
    onRetry: (nodeId, phrase) => runExplain({ phrase, nodeId, force: true }),
    onExpand: (nodeId, term, opts) => {
      if (opts?.replace === true) {
        runExplain({ phrase: term, replaceId: nodeId });
        return;
      }
      runExplain({ phrase: term, parentId: nodeId, nodeId: `${nodeId}::${hashString(term)}` });
    },
    onExport: () => flash('独立版暂不支持导出'),
  });
  board.mount();

  const annotator = createAnnotator({ doc, win });
  annotator.restore();

  const menu = createMenu({ doc, onAction: (action, data) => onMenuAction(action, data) });

  /**
   * 跑一次解释。
   * @param {{phrase:string, parentId?:string, nodeId?:string, replaceId?:string, force?:boolean, mode?:string, docText?:string}} input - 参数。
   * @returns {Promise<void>}
   */
  async function runExplain(input) {
    const phrase = typeof input?.phrase === 'string' ? input.phrase.trim() : '';
    if (phrase === '') return;
    const mode = typeof input?.mode === 'string' && input.mode !== '' ? input.mode : 'default';
    const nodeId = input?.nodeId ?? `n-${hashString(phrase)}`;
    const replaceId = typeof input?.replaceId === 'string' ? input.replaceId : '';

    let targetId = replaceId !== '' ? replaceId : nodeId;
    if (replaceId !== '') {
      board.update(replaceId, buildPendingCard(phrase));
    } else if (typeof input?.parentId === 'string' && input.parentId !== '') {
      const child = board.addChild(input.parentId, { id: nodeId, text: phrase, model: buildPendingCard(phrase) });
      if (child === null) {
        flash('最多 4 层，这里不再展开');
        return;
      }
      targetId = child.id;
    } else {
      const opened = board.openRoot({ id: nodeId, text: phrase, model: buildPendingCard(phrase) });
      if (opened !== null) targetId = opened.id;
    }

    const result = await api.explain({
      phrase,
      context: typeof input?.docText === 'string' ? input.docText : '',
      mode,
      force: input?.force === true,
    });

    if (result.ok === true) {
      const card = buildCard({ phrase, data: result.data });
      board.update(targetId, card);
      return;
    }
    board.update(targetId, buildErrorCard(phrase, result.error));
  }

  /**
   * 菜单动作。
   * @param {string} action - 动作名。
   * @param {object} data - 上下文。
   * @returns {void}
   */
  function onMenuAction(action, data) {
    const phrase = typeof data?.phrase === 'string' ? data.phrase : '';
    if (action === 'copy') {
      try {
        win.navigator?.clipboard?.writeText(data?.selection ?? phrase);
      } catch {
        /* 忽略 */
      }
      flash('已复制');
      return;
    }
    if (action === 'query') {
      runExplain({ phrase, docText: data?.docText });
      return;
    }
    if (action === 'rephrase' || action === 'example' || action === 'translate') {
      runExplain({ phrase, mode: action, docText: data?.docText });
      return;
    }
    if (action === 'annotate') {
      const noted = annotator.add({ phrase, range: data?.range ?? null, rect: data?.rect ?? null });
      flash(noted === null ? '先选中一段文字' : '已标红，在上方气泡里写改为');
      return;
    }
    if (action === 'clear-notes') {
      annotator.clearAll();
      flash('批注已清空');
      return;
    }
    flash('独立版还没做这个动作');
  }

  const disposeSelector = attachSelector(doc, {
    leftEnabled: () => annotator.isOn(),
    isEnabled: () => true,
    onPick: (payload) => {
      const { phrase, range, rect } = payload;
      const clean = typeof phrase === 'string' ? phrase.trim() : '';
      if (clean === '') return;
      if (annotator.isOn()) {
        if (payload?.dragged !== true || range === null) {
          flash('拖过一段要改的文字');
          return;
        }
        annotator.add({ phrase: clean, range, rect });
        flash('已标红，在上方气泡里写改为');
        return;
      }
      painter.paint(range ?? painter.resolve(clean));
      menu.show(rect, {
        phrase: clean,
        selection: clean,
        rect,
        range,
        docText: contextAroundRange(range, clean),
        hasSelection: true,
        hasExplain: false,
        hasDomain: false,
        queryLabel: '解释这段文本',
      });
    },
  });

  win[GLOBAL_KEY] = { board, annotator, dispose };

  /**
   * 卸载。
   * @returns {void}
   */
  function dispose() {
    try {
      disposeSelector?.();
    } catch {
      /* 忽略 */
    }
    board.dispose();
    annotator.dispose();
    doc.getElementById('knest-style')?.remove?.();
    delete win[GLOBAL_KEY];
  }

  flash(`词林已挂到 ${options.appName ?? '当前窗口'}`);
  return { board, annotator, dispose };
}
