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
import { createSettings } from './settings.js';
import { hashString } from './util.js';
import { detectTheme, stampTheme, watchTheme } from './theme.js';

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
  /* 跟着宿主的明暗走：读页面背景亮度，别硬写 dark */
  stampTheme(doc, detectTheme(doc));
  const stopTheme = typeof watchTheme === 'function'
    ? watchTheme(doc, (next) => stampTheme(doc, next))
    : () => {};

  const painter = createPainter(doc);
  let flashToast = null;

  /* 拖动时的字数提示。
     右键拖动时浏览器不产生原生选区，光靠高亮很难判断拖了多长，
     所以在指针旁边挂一个小气泡，实时报「已选 N 字」。 */
  let dragHint = null;
  const hideDragHint = () => {
    try {
      dragHint?.setAttribute('data-show', 'false');
    } catch {
      /* 忽略 */
    }
  };

  /**
   * 更新拖动提示。
   * @param {Range|null} range - 当前选区。
   * @param {number} [x] - 指针横坐标。
   * @param {number} [y] - 指针纵坐标。
   * @returns {void}
   */
  const showDragHint = (range, x, y) => {
    try {
      const count = range === null || range === undefined ? 0 : [...String(range.toString()).replace(/\s+/gu, '')].length;
      if (count === 0) {
        hideDragHint();
        return;
      }
      if (dragHint === null || dragHint.parentNode === null) {
        dragHint = doc.createElement('div');
        dragHint.className = 'knest-drag-hint';
        dragHint.setAttribute('data-show', 'false');
        (doc.body ?? doc.documentElement).appendChild(dragHint);
      }
      dragHint.textContent = `已选 ${count} 字`;
      dragHint.setAttribute('data-show', 'true');

      const px = typeof x === 'number' ? x : win.innerWidth / 2;
      const py = typeof y === 'number' ? y : win.innerHeight / 2;
      const gap = 16;
      const boxW = 100;
      const boxH = 30;
      const left = px + gap + boxW > win.innerWidth ? px - gap - boxW : px + gap;
      const top = py + gap + boxH > win.innerHeight ? py - gap - boxH : py + gap;
      dragHint.style.left = `${Math.max(4, Math.round(left))}px`;
      dragHint.style.top = `${Math.max(4, Math.round(top))}px`;
    } catch {
      /* 忽略 */
    }
  };

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

  /**
   * 把画布上的树导成 Markdown：下载一份 .md，同时复制到剪贴板。
   *
   * 独立版没有宿主的文件系统权限，所以走浏览器下载这一条；
   * 复制是顺手给的，方便直接粘进笔记。
   *
   * @returns {void}
   */
  const exportTree = () => {
    try {
      const snap = board.snapshot();
      const list = Array.isArray(snap?.nodes) ? snap.nodes : [];
      if (list.length === 0) {
        flash('画布上还没有卡片');
        return;
      }
      const kids = (id) => list.filter((node) => (node.parentId ?? null) === id);
      const lines = ['# 词林 · 知识树', '', `导出时间：${new Date().toLocaleString()}`, ''];
      const walk = (node, depth) => {
        const pad = '  '.repeat(depth);
        const lead = typeof node.model?.lead === 'string' ? node.model.lead : '';
        lines.push(`${pad}- **${node.text}**${lead === '' ? '' : ` — ${lead}`}`);
        for (const child of kids(node.id)) walk(child, depth + 1);
      };
      for (const root of list.filter((node) => (node.parentId ?? null) === null)) walk(root, 0);
      const text = lines.join('\n');

      let downloaded = false;
      try {
        const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = doc.createElement('a');
        link.href = url;
        link.download = `词林-知识树-${new Date().toISOString().slice(0, 10)}.md`;
        link.style.display = 'none';
        (doc.body ?? doc.documentElement).appendChild(link);
        link.click();
        link.remove();
        win.setTimeout(() => URL.revokeObjectURL(url), 1500);
        downloaded = true;
      } catch {
        downloaded = false;
      }

      let copied = false;
      try {
        win.navigator?.clipboard?.writeText?.(text);
        copied = true;
      } catch {
        copied = false;
      }

      if (downloaded && copied) flash(`已导出 ${list.length} 张卡片：下载了一份 .md，也复制到了剪贴板`);
      else if (downloaded) flash(`已导出 ${list.length} 张卡片：下载了一份 .md`);
      else if (copied) flash(`已导出 ${list.length} 张卡片：内容已复制到剪贴板`);
      else flash('导出失败：浏览器拦了下载和剪贴板');
    } catch (error) {
      flash(`导出出错：${String(error?.message ?? error).slice(0, 60)}`);
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
    onExport: () => exportTree(),
  });
  board.mount();

  const annotator = createAnnotator({ doc, win });
  annotator.restore();

  /* 设置面板：直接建在宿主页面里，读写的是同一个 config.json */
  const setupPort = Number(options.setupPort ?? 7332);
  const settings = createSettings({
    doc,
    win,
    port: setupPort,
    onToast: (message) => flash(message),
  });
  const gear = doc.createElement('button');
  gear.type = 'button';
  gear.className = 'knest-edge-tab';
  gear.title = '词林：点这里选模型、填钥匙';
  gear.innerHTML = '<span>词林</span>';
  gear.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    settings.toggle();
  });
  gear.addEventListener('contextmenu', (event) => event.stopPropagation());
  (doc.body ?? doc.documentElement).appendChild(gear);

  /* 还没配模型时亮个红点，告诉用户这里要点 */
  const markUnconfigured = async () => {
    try {
      const res = await fetch(`http://127.0.0.1:${setupPort}/state`);
      const state = await res.json();
      const configured = typeof state?.saved?.baseUrl === 'string' && state.saved.baseUrl.trim() !== '';
      gear.setAttribute('data-alert', configured ? '0' : '1');
    } catch {
      gear.setAttribute('data-alert', '1');
    }
  };
  markUnconfigured();
  /* 面板关掉时重新看一眼，配好了就把红点熄掉 */
  const tabObserver = new MutationObserver(() => {
    const open = settings.isOpen();
    gear.setAttribute('data-open', open ? 'true' : 'false');
    if (!open) markUnconfigured();
  });
  try {
    tabObserver.observe(settings.el, { attributes: true, attributeFilter: ['data-open'] });
  } catch {
    /* 忽略 */
  }

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
    /* 拖动过程中实时上色 + 报字数：右键拖动没有原生选区，不这么做用户看不见自己选到哪 */
    onLive: (range, at) => {
      if (range === null || range === undefined) {
        hideDragHint();
        return;
      }
      painter.paint(range);
      showDragHint(range, at?.x, at?.y);
    },
    onCancel: () => {
      hideDragHint();
      painter.clear();
    },
    onPick: (payload) => {
      const { phrase, range, rect } = payload;
      const clean = typeof phrase === 'string' ? phrase.trim() : '';
      hideDragHint();
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

  win[GLOBAL_KEY] = { board, annotator, settings, dispose };

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
    try {
      settings.dispose();
      gear.remove();
    } catch {
      /* 忽略 */
    }
    try {
      stopTheme?.();
    } catch {
      /* 忽略 */
    }
    doc.getElementById('knest-style')?.remove?.();
    delete win[GLOBAL_KEY];
  }

  flash(`词林已挂到 ${options.appName ?? '当前窗口'}　右侧「词林」竖条可设置模型`);
  return { board, annotator, dispose };
}
