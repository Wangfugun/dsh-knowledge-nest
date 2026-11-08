/**
 * 视图与插件装配。
 *
 * 四块界面：
 *   1. **地图**（conversation.view 里的 `圈词` 标签页）：会话竖轴 + 圈过的词；
 *   2. **卡片浮层**（宿主 body 上的原生 DOM）：圈住就出现；
 *   3. **右侧竖牌**「启用圈词」：点一下开关，快捷键也能切；
 *   4. **右键菜单**（关掉圈词时）：剪切 / 复制 / 粘贴 / 查询。
 *
 * 装配顺序：样式 → 主题 → 浮层 → 菜单 → 开关 → 手势/快捷键 → 槽位注册。
 * 浮层、菜单、开关、手势都挂在**插件初始化**上，不挂在视图组件里——
 * 用户在聊天标签页操作时，视图根本没挂载。
 */
import { buildCard, buildErrorCard, buildPendingCard, parentContextOf } from './card.js';
import { createExplainApi } from './api.js';
import { createAnnotator } from './annotate.js';
import { createLibrary } from './library.js';
import { formatExplanation, formatQuote, notebookAdd, notebookRemove, notebookToMarkdown, speakText } from './actions.js';
import { DEFAULT_SHORTCUT, localStore, matchShortcut, readConfig, shortcutFromEvent, writeConfig } from './config.js';
import { MAP_GEOMETRY, layoutMap } from './layout.js';
import { createMenu } from './menu.js';
import { createTreeBoard } from './tree-board.js';
import { createPainter } from './painter.js';
import { expandSentenceAt, normalizePhrase, phraseKey, pointAt, sentenceContaining } from './phrase.js';
import { attachSelector } from './selector.js';
import { ensureStyles } from './styles.js';
import { createStore } from './store.js';
import { createSwitch } from './switch.js';
import { detectTheme, stampTheme, watchTheme } from './theme.js';
import { DEPTHS, buildContext, buildTranscript, countPhrase } from './transcript.js';
import { clampText, hashString } from './util.js';

/** conversation.view 的注册参数（新标签，不覆盖官方 chat）。 */
export const VIEW_OPTIONS = Object.freeze({
  name: 'conversation.view',
  id: 'knowledge',
  order: -1,
  label: '知识库',
});

/**
 * 槽位注入：**拿 sessionId 的唯一正确方式**。
 *
 * 宿主渲染是 `renderSlot('conversation.view', { inspectCall, viewRequest, openView, completeViewRequest }, { only })`
 * ——里面没有 sessionId。官方视图都靠注册项上的 `inject: (sessionId) => ({...})` 传。
 */
export function viewInjected(sessionId) {
  return { sessionId: typeof sessionId === 'string' ? sessionId : '' };
}

/** 设置分区注册参数。 */
export const SETTINGS_SECTION = Object.freeze({
  name: 'settings.section',
  id: 'knowledge-nest',
  order: 60,
  label: '知识库',
});

/** 地图持久化键。 */
const MAP_KEY = 'dsh.knowledge-nest.map';

/** 圈词本持久化键。 */
const NOTEBOOK_KEY = 'dsh.knowledge-nest.notebook';

/** 一个会话最多记多少个词。 */
const NODE_LIMIT = 80;

/** 变体模式的中文名（窗口标题用）。 */
const MODE_LABEL = Object.freeze({ rephrase: '换个说法', example: '举个例子', translate: '翻译' });

/**
 * 读圈词本。
 * @param {Window} win - 窗口。
 * @returns {object[]} 条目（新的在后）。
 */
export function readNotebook(win) {
  const store = localStore(win);
  if (store === null) return [];
  try {
    const raw = store.getItem(NOTEBOOK_KEY);
    if (raw === null || raw === '') return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((node) => node !== null && typeof node === 'object' && typeof node.phrase === 'string');
  } catch {
    return [];
  }
}

/**
 * 写圈词本。
 * @param {Window} win - 窗口。
 * @param {object[]} list - 条目。
 * @returns {void}
 */
export function writeNotebook(win, list) {
  const store = localStore(win);
  if (store === null) return;
  try {
    store.setItem(NOTEBOOK_KEY, JSON.stringify(Array.isArray(list) ? list : []));
  } catch {
    /* 存不下就算了 */
  }
}

/**
 * 读地图存档。
 * @param {Window} win - 窗口。
 * @returns {Record<string, object[]>} 会话 → 节点数组。
 */
export function readMapStore(win) {
  const store = localStore(win);
  if (store === null) return {};
  try {
    const raw = store.getItem(MAP_KEY);
    if (raw === null || raw === '') return {};
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (!Array.isArray(value)) continue;
      out[key] = value.filter((node) => node !== null && typeof node === 'object' && typeof node.phrase === 'string');
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * 写地图存档。
 * @param {Window} win - 窗口。
 * @param {Record<string, object[]>} all - 全量。
 * @returns {void}
 */
export function writeMapStore(win, all) {
  const store = localStore(win);
  if (store === null) return;
  try {
    store.setItem(MAP_KEY, JSON.stringify(all));
  } catch {
    /* 存不下就算了 */
  }
}

/**
 * 取某个会话的节点（按圈词时间升序）。
 * @param {Record<string, object[]>} all - 全量。
 * @param {string} sessionId - 会话。
 * @returns {object[]} 节点。
 */
export function nodesOfSession(all, sessionId) {
  const list = all?.[sessionId];
  if (!Array.isArray(list)) return [];
  return list.slice().sort((left, right) => (left.at ?? 0) - (right.at ?? 0));
}

/**
 * 插入/更新一个节点：同一个词只留一条。
 * @param {object[]} list - 现有节点。
 * @param {{phrase:string, messageIndex:number, count:number}} input - 新节点。
 * @returns {object[]} 新数组。
 */
export function upsertNode(list, input) {
  const current = Array.isArray(list) ? list.slice() : [];
  const key = phraseKey(input?.phrase);
  const phrase = clampText(input?.phrase, 120);
  const at = Date.now();
  const existingIndex = current.findIndex((node) => phraseKey(node?.phrase) === key);
  const node = {
    id: `n-${hashString(key)}`,
    phrase,
    messageIndex: Number.isFinite(input?.messageIndex) ? input.messageIndex : 0,
    count: Number.isFinite(input?.count) ? input.count : 1,
    explained: input?.explained === true,
    at,
  };
  if (existingIndex >= 0) {
    const previous = current[existingIndex];
    current[existingIndex] = { ...previous, ...node, at: previous.at ?? at, explained: previous.explained === true || node.explained };
    return current;
  }
  current.push(node);
  return current.length > NODE_LIMIT ? current.slice(current.length - NODE_LIMIT) : current;
}

/**
 * 读一个会话的消息（每次现读，保证上下文是最新的）。
 * @param {object} sessions - 会话服务。
 * @param {string} sessionId - 会话。
 * @returns {object[]} 消息。
 */
export function readMessages(sessions, sessionId) {
  try {
    const binding = typeof sessions?.binding === 'function' ? sessions.binding(sessionId) : null;
    const snapshot = binding?.eventSource?.getSnapshot?.();
    const entries = snapshot?.entries ?? binding?.window?.entries ?? binding?.window?.records ?? [];
    return buildTranscript(entries);
  } catch {
    return [];
  }
}

/**
 * 目标是不是可编辑元素（输入框、可编辑块）——那里右键要留给原生菜单。
 * @param {EventTarget|null} target - 事件目标。
 * @returns {boolean} 是否可编辑。
 */
function isEditableTarget(target) {
  if (target === null || target === undefined || typeof target.closest !== 'function') return false;
  const tag = String(target.nodeName || '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'OPTION') return true;
  try {
    if (target.isContentEditable === true) return true;
    return target.closest('[contenteditable="true"]') !== null;
  } catch {
    return false;
  }
}

/**
 * 目标是不是插件自己的界面。
 * @param {EventTarget|null} target - 事件目标。
 * @returns {boolean} 是否在自家界面里。
 */
function insideOwnUi(target) {
  if (target === null || target === undefined || typeof target.closest !== 'function') return false;
  try {
    return target.closest('#knest-echo-layer, #knest-menu-layer, #knest-switch') !== null;
  } catch {
    return false;
  }
}

/**
 * 画地图。
 * @param {{h:Function, React:object, sessions:object, store:object, api:object, board:object, runExplain:Function}} env - 依赖。
 * @returns {Function} React 组件。
 */
export function createMapView(env) {
  const { h, React, sessions, store, api, board, runExplain } = env;

  return function MapView(props) {
    const sessionId = typeof props?.sessionId === 'string' ? props.sessionId : '';
    const [snapTick, setSnapTick] = React.useState(0);
    const theme = store.get().theme;

    React.useEffect(() => {
      if (typeof sessionId === 'string' && sessionId !== '' && store.get().sessionId !== sessionId) {
        store.patch({ sessionId });
      }
      return undefined;
    }, [sessionId]);

    React.useEffect(() => store.subscribe(() => setSnapTick((value) => value + 1)), []);

    /* 事件流一变就重算（流式输出时地图跟着长）。 */
    React.useEffect(() => {
      let off = null;
      try {
        const binding = typeof sessions?.binding === 'function' ? sessions.binding(sessionId) : null;
        const source = binding?.eventSource;
        if (source !== null && source !== undefined && typeof source.subscribe === 'function') {
          off = source.subscribe(() => setSnapTick((value) => value + 1));
        }
      } catch {
        off = null;
      }
      return () => {
        try {
          if (typeof off === 'function') off();
        } catch {
          /* 忽略 */
        }
      };
    }, [sessionId]);

    const state = store.get();
    const activeSession = sessionId || state.sessionId;
    const messages = React.useMemo(
      () => readMessages(sessions, activeSession),
      [sessions, activeSession, snapTick],
    );
    const nodes = state.nodes;
    const [query, setQuery] = React.useState('');
    const cards = state.cards ?? {};
    /* 搜索：词 / 释义 / 领域 三个字段，命中就过滤图上的节点 */
    const visibleNodes = React.useMemo(() => {
      const needle = query.trim().toLowerCase();
      if (needle === '') return nodes;
      return nodes.filter((node) => {
        const card = cards[node.id] ?? {};
        const hay = [node.phrase, card.lead, card.domain].filter((item) => typeof item === 'string').join('\n').toLowerCase();
        return hay.includes(needle);
      });
    }, [nodes, cards, query]);
    const layout = React.useMemo(() => layoutMap({ messages, nodes: visibleNodes }), [messages, visibleNodes]);

    const onNode = (event, point) => {
      event.preventDefault();
      const rect = typeof event.currentTarget?.getBoundingClientRect === 'function'
        ? event.currentTarget.getBoundingClientRect()
        : { left: 0, top: 0, right: 0, bottom: 0 };
      const card = store.get().cards?.[point.id];
      if (card !== undefined) {
        board.openRoot({ id: point.id, text: point.phrase, model: card });
        store.patch({ activeId: point.id });
        return;
      }
      runExplain({ phrase: point.phrase, sessionId: activeSession, rect, nodeId: point.id });
    };

    const usable = messages.length > 0;
    const enabled = state.enabled !== false;
    const notebook = Array.isArray(state.notebook) ? state.notebook : [];

    /**
     * 圈词本：点开一条 → 用存下来的字段拼一张轻卡（不再花钱）。
     * @param {MouseEvent} event - 点击事件。
     * @param {object} note - 笔记条目。
     * @returns {void}
     */
    const openNote = (event, note) => {
      event.preventDefault();
      const rect = typeof event.currentTarget?.getBoundingClientRect === 'function'
        ? event.currentTarget.getBoundingClientRect()
        : { left: 0, top: 0, right: 0, bottom: 0 };
      const card = buildCard({
        phrase: note.phrase,
        data: {
          here: note.lead !== undefined && note.lead !== '' ? note.lead : '（这条笔记没存释义）',
          kind: '',
          confidence: 'medium',
          evidence: typeof note.quote === 'string' && note.quote !== '' ? [{ quote: note.quote, why: '' }] : [],
        },
      });
      board.openRoot({ id: `note-${note.id}`, text: note.phrase, model: card });
    };

    const removeNote = (id) => {
      const list = notebookRemove(store.get().notebook, id);
      writeNotebook(globalThis, list);
      store.patch({ notebook: list });
    };

    const clearNotebook = () => {
      writeNotebook(globalThis, []);
      store.patch({ notebook: [] });
    };

    const exportNotebook = () => {
      const text = notebookToMarkdown(store.get().notebook);
      if (text === '') return;
      const clipboard = globalThis.navigator?.clipboard;
      if (clipboard !== undefined && typeof clipboard.writeText === 'function') {
        clipboard.writeText(text).catch(() => {});
      }
    };

    return h('div', { className: 'knest-stage', 'data-knest-stage': 'map', 'data-knest-theme': theme }, [
      h('div', { className: 'knest-rail' }, [
        h('h2', {}, '知识库'),
        h('input', {
          className: 'knest-search',
          type: 'search',
          placeholder: '搜词 / 释义 / 领域…',
          value: query,
          onChange: (event) => setQuery(event.target.value),
        }),
        h('span', { className: 'knest-fig' }, usable ? `${messages.length} 条消息` : '还没有消息'),
        h('span', { className: 'knest-fig' }, nodes.length > 0 ? `${nodes.length} 个词` : ''),
        h('span', { style: { flex: '1' } }),
        h('span', { className: 'knest-fig' }, enabled ? '' : '已关闭'),
        nodes.length > 0
          ? h('button', {
            className: 'knest-key',
            type: 'button',
            onClick: () => {
              writeMapStore(globalThis, { ...readMapStore(globalThis), [activeSession]: [] });
              store.patch({ nodes: [], cards: {}, activeId: '' });
            },
          }, '清空这张图')
          : null,
      ]),
      h('p', { className: 'knest-lead-in' },
        enabled
          ? '按住鼠标右键拖过聊天里的一个词或一句话，松手它就变绿，意思钉在这条轴上。'
          : '知识库已关闭：右键仍可对选中的词「查询」一次；右侧竖牌或快捷键可以重新打开。'),
      !usable
        ? h('div', { className: 'knest-blank' }, [
          h('b', {}, '这个会话里还没有可圈的东西。'),
          h('ol', { className: 'knest-steps' }, [
            h('li', {}, '回到对话，按住鼠标右键拖过一个词；'),
            h('li', {}, '松手 → 它变绿，右边弹出解释；'),
            h('li', {}, '这里就会多出一个节点，点它随时再看。'),
          ]),
        ])
        : null,
      usable
        ? h('div', { className: 'knest-map', style: { height: `${layout.height}px` } }, [
          ...layout.ticks
            .filter((tick) => layout.points.some((point) => point.messageIndex === tick.index))
            .map((tick) => h('span', {
              key: `role-${tick.index}`,
              className: 'knest-role-mark',
              'data-role': tick.role,
              style: { top: `${tick.center}px` },
            }, tick.role === 'you' ? '你' : '答')),
          h('svg', { className: 'knest-svg', width: '100%', height: layout.height }, [
            h('line', {
              key: 'spine',
              'data-kind': 'spine',
              x1: MAP_GEOMETRY.spineX,
              y1: 0,
              x2: MAP_GEOMETRY.spineX,
              y2: layout.height,
            }),
            ...layout.ticks.map((tick) => h('line', {
              key: `tick-${tick.index}`,
              'data-kind': `tick-${tick.role}`,
              x1: MAP_GEOMETRY.spineX - 6,
              y1: tick.center,
              x2: MAP_GEOMETRY.spineX,
              y2: tick.center,
            })),
            ...layout.stems.map((stem, index) => h('line', {
              key: `stem-${index}`,
              'data-kind': 'stem',
              x1: stem.x1,
              y1: stem.y1,
              x2: stem.x2,
              y2: stem.y2,
            })),
            ...layout.branches.map((branch, index) => h('line', {
              key: `branch-${index}`,
              'data-kind': 'branch',
              x1: branch.x1,
              y1: branch.y1,
              x2: branch.x2,
              y2: branch.y2,
            })),
            ...layout.edges.map((edge, index) => h('line', {
              key: `edge-${index}`,
              'data-kind': edge.kind,
              x1: edge.x1,
              y1: edge.y1,
              x2: edge.x2,
              y2: edge.y2,
            })),
          ]),
          ...layout.points.map((point) => h('button', {
            key: point.id,
            type: 'button',
            className: 'knest-point',
            style: { left: `${point.x}px`, top: `${point.y}px` },
            title: point.phrase,
            'data-explained': point.explained ? 'true' : 'false',
            'data-active': state.activeId === point.id ? 'true' : 'false',
            'data-pending': state.pendingId === point.id ? 'true' : 'false',
            onClick: (event) => onNode(event, point),
          }, [
            h('span', { className: 'knest-ring-dot' }),
            h('span', { className: 'knest-label' }, point.phrase),
            point.count > 1 ? h('span', { className: 'knest-times' }, `${point.count} 次`) : null,
          ])),
        ])
        : null,
      !usable ? null : (nodes.length === 0
        ? h('div', { className: 'knest-blank' }, '图上还空着。圈第一个词试试。')
        : null),
      notebook.length === 0
        ? null
        : h('section', { className: 'knest-notes' }, [
          h('div', { className: 'knest-notes-head' }, [
            h('h3', {}, '知识库 · 生词本'),
            h('span', { className: 'knest-fig' }, `${notebook.length} 条`),
            h('span', { style: { flex: '1' } }),
            h('button', { className: 'knest-key', type: 'button', onClick: exportNotebook }, '导出 Markdown'),
            h('button', { className: 'knest-key', type: 'button', onClick: clearNotebook }, '清空'),
          ]),
          h('ul', { className: 'knest-note-list' }, notebook.slice().reverse().map((note) => h('li', { key: note.id }, [
            h('button', { className: 'knest-note-open', type: 'button', onClick: (event) => openNote(event, note) }, [
              h('span', { className: 'knest-note-phrase' }, note.phrase),
              typeof note.lead === 'string' && note.lead !== ''
                ? h('span', { className: 'knest-note-lead' }, note.lead)
                : null,
            ]),
            h('button', {
              className: 'knest-note-del',
              type: 'button',
              title: '删掉这条',
              onClick: () => removeNote(note.id),
            }, '×'),
          ]))),
        ]),
    ]);
  };
}

/**
 * 设置分区。
 * @param {{h:Function, React:object, api:object, store:object, actions:object}} env - 依赖。
 * @returns {Function} React 组件。
 */
export function createSettingsPanel(env) {
  const { h, React, api, store, actions } = env;
  return function SettingsPanel() {
    const [status, setStatus] = React.useState(null);
    const [busy, setBusy] = React.useState(false);
    const [recording, setRecording] = React.useState(false);
    const [recordingNote, setRecordingNote] = React.useState(false);
    const [filePath, setFilePath] = React.useState('');
    const [fileResult, setFileResult] = React.useState(null);
    const [fileBusy, setFileBusy] = React.useState(false);
    const [, setTick] = React.useState(0);

    React.useEffect(() => store.subscribe(() => setTick((value) => value + 1)), []);

    const refresh = React.useCallback(() => {
      setBusy(true);
      api.status().then((result) => {
        setStatus(result?.ok === true ? result.status : { error: result?.error?.message ?? '路由没响应' });
        setBusy(false);
      }).catch(() => {
        setStatus({ error: '路由没响应' });
        setBusy(false);
      });
    }, [api]);

    React.useEffect(() => {
      refresh();
    }, [refresh]);

    const state = store.get();
    const clear = () => {
      setBusy(true);
      api.clearCache().then(() => refresh()).catch(() => setBusy(false));
    };

    /**
     * 读工作区文件：成功把全文打到控制台，面板上留一行摘要 + 前 400 字预览。
     * @returns {void}
     */
    const readFile = () => {
      const target = filePath.trim();
      if (target === '') {
        setFileResult({ ok: false, message: '先填一个路径' });
        return;
      }
      setFileBusy(true);
      api.readFile(target).then((result) => {
        if (result.ok === true) {
          try {
            console.info(`[knowledge-nest] ${result.path}（${result.bytes} 字节）\n${result.text}`);
          } catch {
            /* 控制台不可用就算了 */
          }
          setFileResult({
            ok: true,
            message: `读到 ${result.bytes} 字节 / ${result.text.length} 字，全文已在控制台`,
            preview: result.text.slice(0, 400),
          });
        } else {
          setFileResult({ ok: false, message: `${result.error.code}：${result.error.message}` });
        }
        setFileBusy(false);
      }).catch((error) => {
        setFileResult({ ok: false, message: String(error?.message ?? error) });
        setFileBusy(false);
      });
    };

    const keyLine = status === null
      ? '正在问 host…'
      : (status.error !== undefined
        ? `拿不到状态：${status.error}`
        : (status.keyConfigured
          ? `钥匙就位（来源 ${status.keySource}，指纹 ${status.keyFingerprint}）`
          : '没有钥匙：host 会依次找 配置文件 → 环境变量 → ~/.dsh/.credentials.yaml'));

    const usage = status?.lastUsage;
    const usageLine = usage !== undefined && usage.prompt > 0
      ? `上一次请求：prompt ${usage.prompt} + completion ${usage.completion} = ${usage.total} token`
      : '还没有真实请求；圈一次词就能看到用量。';

    return h('div', { className: 'knest-form', 'data-knest-theme': detectTheme() }, [
      h('div', { className: 'knest-row' }, [
        h('label', { style: { display: 'inline-flex', alignItems: 'center', gap: '6px' } }, [
          h('input', {
            type: 'checkbox',
            checked: state.enabled !== false,
            onChange: (event) => actions.setEnabled(event.target.checked),
          }),
          '启用知识库',
        ]),
      ]),
      h('p', { className: 'knest-note' },
        state.enabled !== false
          ? '开着：按住右键拖过字就变绿并解释。'
          : '关着：右键会弹出小菜单（剪切 / 复制 / 粘贴 / 查询）。'),
      h('div', { className: 'knest-row' }, [
        h('label', {}, '批注模式'),
        h('input', {
          type: 'text',
          readOnly: true,
          value: recordingNote ? '按下组合键…' : (state.annotateShortcut || 'Alt+A'),
          style: { width: '150px' },
          onFocus: () => setRecordingNote(true),
          onBlur: () => setRecordingNote(false),
          onKeyDown: (event) => {
            event.preventDefault();
            const spec = shortcutFromEvent(event);
            if (spec === null) return;
            setRecordingNote(false);
            writeConfig(globalThis, { annotateShortcut: spec });
            store.patch({ annotateShortcut: spec });
            event.currentTarget.blur();
          },
        }),
        h('span', { className: 'knest-note' }, '进入后左键拖选即标红'),
      ]),
      h('div', { className: 'knest-row' }, [
        h('label', {}, '上下文'),
        h('select', {
          value: state.depth,
          onChange: (event) => actions.setDepth(event.target.value),
        }, [
          h('option', { value: 'compact' }, `${DEPTHS.compact.label}（约 800 token / 次）`),
          h('option', { value: 'standard' }, `${DEPTHS.standard.label}（约 1300 token / 次）`),
          h('option', { value: 'deep' }, `${DEPTHS.deep.label}（约 2700 token / 次）`),
        ]),
      ]),
      h('div', { className: 'knest-row' }, [
        h('label', {}, '模型'),
        h('select', {
          value: state.model,
          onChange: (event) => actions.setModel(event.target.value),
        }, [
          h('option', { value: '' }, '跟随 host 配置（deepseek-flash）'),
          h('option', { value: 'deepseek-flash' }, 'deepseek-flash 更快更省'),
          h('option', { value: 'deepseek-v4-pro' }, 'deepseek-v4-pro 更细更慢'),
        ]),
      ]),
      h('p', { className: 'knest-note' }, keyLine),
      h('p', { className: 'knest-note' }, usageLine),
      h('div', { className: 'knest-row' }, [
        h('button', { className: 'knest-btn', type: 'button', onClick: refresh, disabled: busy }, '重新读状态'),
        h('button', { className: 'knest-btn', type: 'button', onClick: clear, disabled: busy }, '清解释缓存'),
      ]),
      status !== null && status.cache !== undefined
        ? h('p', { className: 'knest-note' }, `缓存 ${status.cache.entries} 条，命中 ${status.cache.hits} 次，写在 ${status.cache.file}`)
        : null,
      h('p', { className: 'knest-note' },
        '只把「圈出的字 + 前后一两条对话」发给 DeepSeek；同一个词在同一段对话里只问一次，之后走缓存。'),

      /* ── 文件读取通道的临时入口（下一轮换成侧边栏面板后删掉） ── */
      h('hr', { className: 'knest-rule' }),
      h('div', { className: 'knest-row' }, [
        h('input', {
          className: 'knest-input',
          type: 'text',
          placeholder: '工作区内的相对路径，如 README.md',
          value: filePath,
          onChange: (event) => setFilePath(event.target.value),
          onKeyDown: (event) => {
            if (event.key === 'Enter') readFile();
          },
        }),
        h('button', {
          className: 'knest-btn',
          type: 'button',
          disabled: fileBusy,
          onClick: readFile,
        }, fileBusy ? '读取中…' : '读取'),
      ]),
      h('p', { className: 'knest-note' }, fileResult === null
        ? '只读通道：文本后缀、1MB 以内、必须在当前工作区内；读到的全文打到控制台。'
        : fileResult.message),
      fileResult !== null && fileResult.preview !== undefined
        ? h('pre', { className: 'knest-file-preview' }, fileResult.preview)
        : null,
    ]);
  };
}

/**
 * 选区像不像代码：有换行、分号、括号、花括号或赋值号就当代码。
 * @param {string} text - 选区文本。
 * @returns {boolean} 是否像代码。
 */
export function isCodeLike(text) {
  const value = typeof text === 'string' ? text : '';
  return /[\n;{}()[\]=<>]/.test(value);
}

/**
 * 造插件对象（client.js 的包壳只负责 require('react') 再调它）。
 * @param {{h:Function, React:object}} env - React 绑定。
 * @returns {{inject:string[], apply:Function}} cordis 客户端插件。
 */
export function createPlugin(env) {
  return {
    inject: ['slots', 'sessions'],
    apply(ctx) {
      const doc = typeof globalThis.document === 'undefined' ? null : globalThis.document;
      ensureStyles(doc);

      let sessions = null;
      try {
        sessions = typeof ctx.get === 'function' ? ctx.get('sessions') : undefined;
      } catch {
        sessions = undefined;
      }
      if (sessions === undefined || sessions === null) sessions = ctx.sessions ?? null;

      const initialTheme = detectTheme(doc);
      stampTheme(doc, initialTheme);
      const initialConfig = readConfig(globalThis);

      const store = createStore({
        sessionId: '',
        theme: initialTheme,
        nodes: [],
        cards: {},
        notebook: readNotebook(globalThis),
        activeId: '',
        pendingId: '',
        enabled: initialConfig.enabled !== false,
        shortcut: initialConfig.shortcut,
        annotateShortcut: initialConfig.annotateShortcut || 'Alt+A',
        annotateWindow: initialConfig.annotateWindow || 'assistant',
        depth: initialConfig.depth,
        model: initialConfig.model,
      });

      const api = createExplainApi();
      /* 画布在 expandFrom 里被引用，用函数声明提前挂钩，避免初始化顺序问题。 */
      const board = createTreeBoard({
        doc,
        onchange: () => saveBoard(),
        onCopyNode: (node) => {
          const text = node?.model?.lead ?? '';
          if (text === '') return;
          copyText(text, '已复制释义');
        },
        onExport: () => exportTree(),
        onSelect: (count) => {
          if (count > 0) switchEl.flash(`已选中 ${count} 张卡片（Delete 删除）`);
        },
        onCardMenu: (node, event) => {
          const model = node?.model ?? {};
          menu.show({ left: event.clientX, top: event.clientY, width: 0, height: 0 }, {
            phrase: node?.text ?? '',
            selection: node?.text ?? '',
            hasSelection: true,
            hasExplain: true,
            hasDomain: typeof model.domain === 'string' && model.domain !== '',
            queryLabel: '重新解释这个词',
            cardActions: true,
          });
        },
        onExpand: (nodeId, term) => expandFrom(nodeId, term),
        onRetry: (nodeId, phrase) => retry(phrase, nodeId),
        onClear: () => painter.clearDomain(),
      });
      board.mount();

      /* 画布持久化：刷新后卡片位置/折叠都还在。 */
      const BOARD_KEY = 'dsh.knowledge-nest.board';
      try {
        const saved = JSON.parse(globalThis.localStorage?.getItem(BOARD_KEY) ?? 'null');
        if (saved !== null && Array.isArray(saved?.nodes) && saved.nodes.length > 0) board.restore(saved);
      } catch {
        /* 坏数据就当没有 */
      }
      let boardTimer = null;
      const saveBoard = () => {
        if (boardTimer !== null) clearTimeout(boardTimer);
        boardTimer = setTimeout(() => {
          boardTimer = null;
          try {
            globalThis.localStorage?.setItem(BOARD_KEY, JSON.stringify(board.snapshot()));
          } catch {
            /* 存不下就算了 */
          }
        }, 400);
      };

      const annotator = createAnnotator({
        doc,
        win: globalThis,
        onchange: (list) => pushAnnotations(list),
      });
      annotator.restore();

      const painter = createPainter(doc);
      const menu = createMenu({ doc, onAction: (action, data) => onMenuAction(action, data) });

      const library = createLibrary({
        doc,
        getCards: () => Object.values(store.get().cards ?? {}),
        searchRemote: (q) => api.searchCards({ q }),
        onOpen: (card) => {
          if (card === null || typeof card !== 'object' || typeof card.phrase !== 'string') return;
          board.openRoot({
            id: `n-${hashString(phraseKey(card.phrase))}`,
            text: card.phrase,
            model: card,
          });
        },
      });
      const switchEl = createSwitch({
        doc,
        getEnabled: () => store.get().enabled !== false,
        getShortcut: () => store.get().shortcut,
        onChange: (next) => setEnabled(next, true),
      });
      switchEl.mount();
      try {
        doc?.getElementById?.('knest-switch')?.setAttribute?.('data-hidden', 'true');
      } catch {
        /* 忽略 */
      }
      showGuideOnce();

      /* 竖牌单击：呼出知识库面板（开关改从设置面板或快捷键） */
      try {
        doc?.getElementById?.('knest-switch')?.addEventListener?.('click', (event) => {
          if (event.target?.closest?.('.knest-switch-btn') !== null) {
            event.preventDefault();
            event.stopPropagation();
            library.toggle();
          }
        }, true);
      } catch {
        /* 忽略 */
      }

      /* 批注模式：右侧一个独立小按钮（贴着竖牌下方）。 */
      const noteBtn = doc?.createElement?.('button');
      if (noteBtn !== null && noteBtn !== undefined) {
        noteBtn.className = 'knest-note-toggle';
        noteBtn.type = 'button';
        noteBtn.textContent = '批注';
        noteBtn.title = '批注模式：拖过一段字就标红（再点退出）';
        noteBtn.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          const on = annotator.setMode(!annotator.isOn());
          noteBtn.setAttribute('data-on', on ? 'true' : 'false');
          switchEl.flash(on ? '批注模式：拖过一段字就标红' : '已退出批注模式');
        });
        (doc.body ?? doc.documentElement).appendChild(noteBtn);

        const wipeBtn = doc.createElement('button');
        wipeBtn.className = 'knest-note-wipe';
        wipeBtn.type = 'button';
        wipeBtn.textContent = '清空';
        wipeBtn.title = '清空所有批注（红字与气泡一起去掉）';
        wipeBtn.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          annotator.clearAll();
          switchEl.flash('批注已清空');
        });
        (doc.body ?? doc.documentElement).appendChild(wipeBtn);
      }

      /* 批注落盘：只把「区间内」的批注写进 AGENTS.local.md。 */
      let pushTimer = null;
      /** 观测到的最新消息时间（用来算区间起点）。 */
      const marks = { assistant: 0, user: 0 };

      function pushAnnotations(list) {
        if (pushTimer !== null) clearTimeout(pushTimer);
        pushTimer = setTimeout(() => {
          pushTimer = null;
          const window = store.get().annotateWindow === 'user' ? 'user' : 'assistant';
          const since = window === 'user' ? marks.user : marks.assistant;
          const entries = (Array.isArray(list) ? list : [])
            .filter((item) => Number(item.ts) > since)
            .map((item) => ({ phrase: item.phrase, note: item.note }));
          api.annotate({ entries, window }).catch(() => {});
        }, 600);
      }

      /**
       * 记录两条时间线：用户发了新话 / 助手回了新话。
       * 在每次交互时顺手同步一下即可，不需要轮询。
       * @returns {void}
       */
      let lastUserSeen = 0;

      /**
       * 用户发了新消息 → 把此前的批注标为已提交（淡出）。
       * @returns {void}
       */
      /**
       * 顶部提示：除区间外还有更早的未提交批注。
       * @returns {void}
       */
      function syncPendingBanner() {
        const window = store.get().annotateWindow === 'user' ? 'user' : 'assistant';
        const since = window === 'user' ? marks.user : marks.assistant;
        const older = annotator.pending().filter((note) => Number(note.ts) <= since);
        if (older.length === 0) {
          doc?.getElementById?.('knest-pending')?.remove?.();
          return;
        }
        let tip = doc?.getElementById?.('knest-pending') ?? null;
        if (tip === null && doc !== null) {
          tip = doc.createElement('div');
          tip.id = 'knest-pending';
          tip.className = 'knest-pending';
          (doc.body ?? doc.documentElement).appendChild(tip);
        }
        if (tip === null) return;
        tip.textContent = `还有 ${older.length} 条更早的批注没提交（点击一起带上）`;
        tip.onclick = () => {
          annotator.submitAll(Date.now());
          syncPendingBanner();
          switchEl.flash('已把全部批注标记为已提交');
        };
      }

      function submitStaleNotes() {
        if (marks.user <= lastUserSeen) return;
        lastUserSeen = marks.user;
        const count = annotator.submitAll(marks.user);
        if (count > 0) switchEl.flash(`上一条消息已带上 ${count} 条批注`);
      }

      function syncMarks() {
        const messages = readMessages(sessions, sessionNow());
        for (const message of messages) {
          if (message.role === 'you') marks.user = Math.max(marks.user, Number(message.at) || marks.user);
          else marks.assistant = Math.max(marks.assistant, Number(message.at) || marks.assistant);
        }
        if (marks.user === 0) marks.user = Date.now();
        if (marks.assistant === 0) marks.assistant = marks.user;
        submitStaleNotes();
        syncPendingBanner();
      }

      /* 首次使用引导：只出现一次，30 秒自动消失 */
      function showGuideOnce() {
        if (doc === null || doc === undefined) return;
        const KEY = 'dsh.knowledge-nest.guided';
        try {
          if (globalThis.localStorage?.getItem(KEY) === '1') return;
          globalThis.localStorage?.setItem(KEY, '1');
        } catch {
          return;
        }
        const tip = doc.createElement('div');
        tip.className = 'knest-guide';
        tip.textContent = '右键拖过一段字 → 出菜单；点「解释这段文本」生成卡片；卡片里的词可以继续点开；Ctrl+K 搜知识库';
        (doc.body ?? doc.documentElement).appendChild(tip);
        setTimeout(() => {
          if (tip.parentNode !== null) tip.parentNode.removeChild(tip);
        }, 9000);
      }

      const sessionNow = () => {
        const state = store.get();
        if (typeof state.sessionId === 'string' && state.sessionId !== '') return state.sessionId;
        try {
          const guess = sessions?.current?.id ?? sessions?.active?.id ?? sessions?.activeSessionId ?? '';
          return typeof guess === 'string' ? guess : '';
        } catch {
          return '';
        }
      };

      const persist = (sessionId, nodes) => {
        writeMapStore(globalThis, { ...readMapStore(globalThis), [sessionId]: nodes });
      };

      /**
       * 开关状态落盘 + 同步三块界面。
       * @param {boolean} next - 目标状态。
       * @param {boolean} [flash] - 是否在竖牌上闪一下。
       * @returns {void}
       */
      function setEnabled(next, flash) {
        const value = next === true;
        writeConfig(globalThis, { enabled: value });
        store.patch({ enabled: value });
        switchEl.sync();
        if (!value) {
          painter.clear();
          menu.hide();
        }
        if (flash === true) switchEl.flash(value ? '已开启' : '已关闭');
      }

      /**
       * 跑一次解释（圈词、点节点、菜单查询/换说法/举例/翻译、"再试一次"都走这里）。
       * @param {{phrase:string, sessionId:string, rect:object, nodeId?:string, force?:boolean, mode?:string}} input - 参数。
       * @returns {Promise<void>}
       */
      const runExplain = async (input) => {
        const phrase = typeof input?.phrase === 'string' ? input.phrase.trim() : '';
        if (phrase === '') return;
        const mode = typeof input?.mode === 'string' && input.mode !== '' ? input.mode : 'default';
        const sessionId = input.sessionId || sessionNow();
        const messages = readMessages(sessions, sessionId);
        const stat = countPhrase(messages, phrase);
        const first = stat.firstIndex >= 0 ? messages[stat.firstIndex] : null;
        const sentence = first === null ? '' : sentenceContaining(first.text, phrase);
        const depth = store.get().depth;
        const parentId = typeof input?.parentId === 'string' && input.parentId !== '' ? input.parentId : null;
        /* 从卡片里展开的词（如「CSS 属性」）原文往往没有，挂上父卡片当上下文。 */
        const parentNode = parentId === null ? null : board.nodes.find((node) => node.id === parentId) ?? null;
        const parentBlock = parentNode === null ? '' : parentContextOf(parentNode);
        const windowed = buildContext(messages, { phrase, depth });
        /* 选区若来自右侧打开的文档（MD/PPT），把那段周边原文也带上 */
        const docBlock = typeof input?.docText === 'string' && input.docText.trim() !== ''
          ? `【文档原文】${input.docText.trim()}`
          : '';
        const head = [docBlock, parentBlock].filter((item) => item !== '').join('\n\n');
        const context = head === ''
          ? windowed.context
          : `${head}\n\n对话原文：\n${windowed.context}`;
        const fingerprint = head === ''
          ? windowed.fingerprint
          : hashString(`${phrase}\u0000${context}`);
        const baseId = input.nodeId ?? `n-${hashString(phraseKey(phrase))}`;
        /* 变体各占一扇窗：同一个词的「换个说法」不会覆盖它的原释义。 */
        const nodeId = mode === 'default' ? baseId : `${baseId}::${mode}`;
        const title = mode === 'default' ? phrase : `${phrase} · ${MODE_LABEL[mode] ?? mode}`;

        const replaceId = typeof input?.replaceId === 'string' && input.replaceId !== '' ? input.replaceId : '';
        store.patch({ pendingId: replaceId || nodeId, activeId: replaceId || nodeId });
        /* 画布会按文本去重：同名的节点可能被复用，真正要更新的是它返回的那个 id。 */
        let targetId = replaceId !== '' ? replaceId : nodeId;
        if (replaceId !== '') {
          board.update(replaceId, buildPendingCard(phrase));
        } else if (parentId !== null) {
          const child = board.addChild(parentId, { id: nodeId, text: title, model: buildPendingCard(phrase) });
          if (child === null) {
            switchEl.flash('最多 4 层，这里不再展开');
            store.patch({ pendingId: '' });
            return;
          }
          targetId = child.id;
        } else {
          const opened = board.openRoot({ id: nodeId, text: title, model: buildPendingCard(phrase) });
          if (opened !== null && opened !== undefined) targetId = opened.id;
        }
        if (targetId !== nodeId) {
          store.patch({ pendingId: targetId, activeId: targetId });
          switchEl.flash('画布上已经有「' + title + '」了');
        }

        const result = await api.explain({
          phrase,
          sentence,
          context,
          fingerprint,
          sessionId,
          mode,
          force: input.force === true,
          model: store.get().model,
        });

        store.patch({ pendingId: '' });

        if (result.ok === true) {
          const card = buildCard({
            phrase: mode === 'default' ? phrase : title,
            data: result.data,
            count: stat.total,
            model: result.model,
            cached: result.cached,
            ms: result.ms,
            usage: result.usage,
          });
          const cards = { ...(store.get().cards ?? {}), [targetId]: card };
          if (mode !== 'default') {
            /* 变体不进地图：地图只记"这个词被解释过"，不记每次追问。 */
            store.patch({ cards, activeId: targetId });
            board.update(targetId, card);
            return;
          }
          const nodes = upsertNode(store.get().nodes, {
            phrase,
            messageIndex: stat.firstIndex >= 0 ? stat.firstIndex : 0,
            count: stat.total,
            explained: true,
          });
          store.patch({ cards, nodes, activeId: targetId });
          api.saveCard({ ...card, at: Date.now(), count: stat.total }).catch(() => {});
          persist(sessionId, nodes);
          board.update(targetId, card);
          return;
        }
        board.update(targetId, buildErrorCard(phrase, result.error));
      };

      /**
       * 重试：丢掉内存缓存再问一次（窗口沿用原来的 id）。
       * @param {string} phrase - 词。
       * @param {string} [id] - 窗口 id。
       * @returns {void}
       */
      const retry = (phrase, id) => {
        const nodeId = typeof id === 'string' && id !== '' ? id : `n-${hashString(phraseKey(phrase))}`;
        runExplain({ phrase, sessionId: sessionNow(), rect: fallbackRect(), nodeId, force: true });
      };

      /**
       * 标出同领域：只染**文字**（对话正文里的同领域词），不上画布。
       * @param {string} domain - 领域名。
       * @returns {void}
       */
      function markDomain(domain) {
        const wanted = typeof domain === 'string' ? domain.trim() : '';
        if (wanted === '') {
          switchEl.flash('这个词还没有领域信息');
          return;
        }
        const cards = Object.values(store.get().cards ?? {});
        const phrases = [...new Set(cards
          .filter((item) => item !== null && typeof item === 'object' && item.domain === wanted && typeof item.phrase === 'string')
          .map((item) => item.phrase))];
        if (phrases.length === 0) {
          switchEl.flash('还没有别的「' + wanted + '」词可标');
          return;
        }
        const painted = painter.markDomain(phrases);
        switchEl.flash(painted > 0 ? '标出 ' + painted + ' 个「' + wanted + '」词' : '这个宿主不支持文字高亮');
      }

      /**
       * 把当前画布导成 Markdown 大纲（复制到剪贴板）。
       * @returns {void}
       */
      function exportTree() {
        const snap = board.snapshot();
        const list = Array.isArray(snap?.nodes) ? snap.nodes : [];
        if (list.length === 0) {
          switchEl.flash('画布上还没有卡片');
          return;
        }
        const kids = (id) => list.filter((node) => (node.parentId ?? null) === id);
        const lines = [];
        const walk = (node, depth) => {
          const pad = '  '.repeat(depth);
          const lead = node.model?.lead ?? '';
          lines.push(`${pad}- **${node.text}**${lead === '' ? '' : ` — ${lead}`}`);
          for (const child of kids(node.id)) walk(child, depth + 1);
        };
        for (const root of list.filter((node) => (node.parentId ?? null) === null)) walk(root, 0);
        copyText(lines.join('\n'), `已导出 ${list.length} 张卡片`);
      }

      /**
       * 点节点里的可展开词 → 以它为子节点再问一次。
       *
       * 深度由画布把关（超过 3 层 addChild 返回 null），这里只负责拼 id：
       * 同一个父节点下再点同一个词不会重复开节点。
       *
       * @param {string} parentId - 父节点 id。
       * @param {string} term - 被点的词。
       * @returns {void}
       */
      function expandFrom(parentId, term, opts) {
        const text = typeof term === 'string' ? term.trim() : '';
        if (text === '' || typeof parentId !== 'string' || parentId === '') return;
        /* Alt+点击：不新增子节点，直接把这张卡的内容换成新解释 */
        if (opts?.replace === true) {
          runExplain({ phrase: text, sessionId: sessionNow(), replaceId: parentId });
          return;
        }
        const childId = `${parentId}::${hashString(phraseKey(text))}`;
        runExplain({ phrase: text, sessionId: sessionNow(), parentId, nodeId: childId });
      }

      /**
       * 菜单里的追问（换个说法/举例/翻译）挂在当前根节点下面；没根就自己当根。
       * @returns {string|null} 父节点 id。
       */
      function variantParent() {
        const root = board.nodes.find((node) => node.parentId === null || node.parentId === undefined);
        return root === undefined ? null : root.id;
      }

      const fallbackRect = () => ({ left: 60, top: 80, right: 120, bottom: 96, width: 60, height: 16 });

      /**
       * 认下一个词：上绿、记账、开问。
       * @param {{phrase:string, range:Range|null, rect:object}} input - 结果。
       * @returns {void}
       */
      const pickPhrase = (input) => {
        const phrase = normalizePhrase(input?.phrase);
        if (phrase === '') return;
        const sessionId = sessionNow();
        const messages = readMessages(sessions, sessionId);
        const stat = countPhrase(messages, phrase);
        const nodes = upsertNode(store.get().nodes, {
          phrase,
          messageIndex: stat.firstIndex >= 0 ? stat.firstIndex : 0,
          count: stat.total,
        });
        store.patch({ nodes, activeId: `n-${hashString(phraseKey(phrase))}` });
        persist(sessionId, nodes);

        const resolved = input?.range ?? painter.resolve(phrase);
        painter.paint(resolved);
        runExplain({
          phrase,
          sessionId,
          rect: input?.rect ?? fallbackRect(),
          docText: input?.docText,
          parentId: input?.parentId,
          nodeId: input?.nodeId,
        });
      };

      /**
       * 复制文本到剪贴板（失败退 execCommand）。
       * @param {string} text - 内容。
       * @param {string} okText - 成功时竖牌上闪的字。
       * @returns {void}
       */
      function copyText(text, okText) {
        const content = typeof text === 'string' ? text : '';
        if (content === '') {
          switchEl.flash('没有可复制的内容');
          return;
        }
        const clipboard = doc?.defaultView?.navigator?.clipboard;
        if (clipboard !== null && clipboard !== undefined && typeof clipboard.writeText === 'function') {
          clipboard.writeText(content).then(() => switchEl.flash(okText)).catch(() => switchEl.flash('复制失败'));
          return;
        }
        try {
          doc.execCommand('copy');
          switchEl.flash(okText);
        } catch {
          switchEl.flash('复制失败');
        }
      }

      /**
       * 在对话里定位某个词（滚动 + 重新高亮）。
       * @param {string} phrase - 词。
       * @returns {void}
       */
      function locatePhrase(phrase) {
        const range = painter.resolve(phrase);
        if (range === null) {
          switchEl.flash('页面上找不到这个词');
          return;
        }
        painter.paint(range);
        try {
          const node = range.startContainer;
          const target = node?.nodeType === 1 ? node : node?.parentElement;
          target?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
          switchEl.flash('已定位');
        } catch {
          switchEl.flash('定位失败');
        }
      }

      /**
       * 右键菜单里的动作。
       * @param {string} action - copy / query / rephrase / save / copy-explain / example / translate / speak / copy-quote / locate。
       * @param {object} data - 菜单上下文。
       * @returns {void}
       */
      /**
       * 选区落在哪张卡片里（用来把新卡片挂成它的子节点）。
       * @param {Range|null} range - 选区。
       * @returns {string} 卡片 id；不在卡片里返回空串。
       */
      function cardIdAtRange(range) {
        try {
          const start = range?.startContainer ?? null;
          const element = start !== null && start.nodeType === 3 ? start.parentElement : start;
          const card = element?.closest?.('.knest-tnode') ?? null;
          const id = card?.getAttribute?.('data-id') ?? '';
          return typeof id === 'string' ? id : '';
        } catch {
          return '';
        }
      }

      function onMenuAction(action, data) {
        const phrase = normalizePhrase(data?.phrase) || normalizePhrase(data?.selection);
        if (phrase === '' && action !== 'copy') {
          switchEl.flash('先选中一段文字');
          return;
        }
        const rect = data?.rect ?? fallbackRect();
        const docText = typeof data?.docText === 'string' ? data.docText : '';
        const sessionId = sessionNow();
        const baseId = `n-${hashString(phraseKey(phrase))}`;
        const card = store.get().cards?.[baseId];
        const messages = readMessages(sessions, sessionId);
        const stat = countPhrase(messages, phrase);
        const first = stat.firstIndex >= 0 ? messages[stat.firstIndex] : null;
        const sentence = first === null ? phrase : sentenceContaining(first.text, phrase);

        switch (action) {
          case 'copy':
            copyText(data?.selection || phrase, '已复制');
            return;
          case 'query': {
            const parentId = typeof data?.cardId === 'string' ? data.cardId : '';
            pickPhrase({ phrase, range: null, rect, docText, parentId });
            return;
          }
            return;
          case 'rephrase':
            runExplain({ phrase, sessionId, rect, mode: 'rephrase', parentId: variantParent() });
            return;
          case 'example':
            runExplain({ phrase, sessionId, rect, mode: 'example', parentId: variantParent() });
            return;
          case 'translate':
            runExplain({ phrase, sessionId, rect, mode: 'translate', parentId: variantParent() });
            return;
          case 'copy-explain': {
            if (card === undefined) {
              switchEl.flash('这张卡还没有释义');
              return;
            }
            copyText(formatExplanation(card), '已复制释义');
            return;
          }
          case 'delete-card': {
            const target = board.findByText(phrase);
            if (target === null) {
              switchEl.flash('找不到这张卡');
              return;
            }
            board.remove(target.id);
            switchEl.flash('已删除这张卡（连同它的子卡片）');
            return;
          }
          case 'annotate': {
            menu.hide();
            annotator.setMode(false);
            syncMarks();
            const noted = annotator.add({ phrase: selection || phrase, range: null, rect });
            switchEl.flash(noted === null ? '先选中一段要改的文字' : '已标红，在上方气泡里写改为');
            return;
          }
          case 'clear-notes': {
            annotator.clearAll();
            switchEl.flash('批注已清空');
            return;
          }
          case 'mark-domain': {
            const domain = typeof card?.domain === 'string' ? card.domain.trim() : '';
            if (domain === '') {
              /* 老缓存里没有 domain：就地重跑一次拿到领域，提示用户再点 */
              runExplain({ phrase, sessionId, rect, docText, force: true });
              switchEl.flash('正在补判定领域，解释回来后再点一次「标出同领域」');
              return;
            }
            markDomain(domain);
            return;
          }
          case 'save': {
            const list = notebookAdd(store.get().notebook, {
              phrase,
              lead: card?.lead ?? '',
              quote: sentence,
              sessionId,
            });
            writeNotebook(globalThis, list);
            store.patch({ notebook: list });
            switchEl.flash('已收进生词本');
            return;
          }
          case 'copy-explain': {
            const text = card === undefined ? '' : formatExplanation(card);
            if (text === '') {
              switchEl.flash('先查询一次才有释义');
              return;
            }
            copyText(text, '释义已复制');
            return;
          }
          case 'speak': {
            const text = card?.lead !== undefined && card.lead !== '' ? card.lead : (data?.selection || phrase);
            switchEl.flash(speakText(text) ? '朗读中' : '这里不能朗读');
            return;
          }
          case 'copy-quote':
            copyText(formatQuote({
              phrase,
              sentence,
              role: first?.role ?? '',
              index: stat.firstIndex,
            }), '引用已复制');
            return;
          case 'locate':
            locatePhrase(phrase);
            return;
          default:
            return;
        }
      }

      /* ── 手势：右键拖选**永远可用**；开着就解释，关着就弹菜单 ───── */
      const selector = attachSelector(doc, {
        leftEnabled: () => annotator.isOn(),
        isEnabled: () => store.get().enabled !== false || annotator.isOn(),
        onLive: (range) => {
          if (range !== null) painter.paint(range);
        },
        onPick: (payload) => {
          const { phrase, range, rect, docText } = payload;
          const clean = normalizePhrase(phrase);
          if (clean === '') return;
          syncMarks();
          /* 批注模式：左键拖选才标红；右键仍旧出菜单（用来退出或换动作）。 */
          if (annotator.isOn()) {
            if (payload?.dragged !== true || range === null || range?.collapsed === true) {
              switchEl.flash('拖过一段要改的文字');
              return;
            }
            const note = annotator.add({ phrase: clean, range, rect });
            switchEl.flash(note === null ? '这段没能标上批注' : '已标红，在上方气泡里写改为');
            return;
          }
          const resolved = range ?? painter.resolve(clean);
          const cardId = cardIdAtRange(resolved);
          painter.paint(resolved);
          /* 拖完只出菜单：查询 / 换个说法 / 批注都由你点，绝不自动发请求。 */
          menu.show(rect, {
            phrase: clean,
            selection: clean,
            rect,
            editable: false,
            hasSelection: true,
            hasExplain: Boolean(store.get().cards?.['n-' + hashString(phraseKey(clean))]),
            hasDomain: Boolean(store.get().cards?.['n-' + hashString(phraseKey(clean))]?.domain),
            queryLabel: isCodeLike(clean) ? '解释这段代码' : '解释这段文本',
            docText,
            cardId,
          });
          /* 收掉选区：否则残留的选区会让卡片拖动被判定为"正在选字"而被忽略 */
          try {
            doc?.defaultView?.getSelection?.()?.removeAllRanges?.();
          } catch {
            /* 忽略 */
          }
        },
        onCancel: () => painter.clear(),
      });

      /**
       * 关着圈词时的右键：在选区右上角弹自己的菜单。
       * @param {MouseEvent} event - 右键事件。
       * @returns {void}
       */
      function onContextMenu(event) {
        /* 批注模式：右键归批注，不弹菜单（也不让浏览器弹原生菜单）。 */
        if (annotator.isOn()) {
          if (isEditableTarget(event.target) || insideOwnUi(event.target)) return;
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (store.get().enabled !== false) return;
        if (menu.isOpen()) return;
        if (isEditableTarget(event.target) || insideOwnUi(event.target)) return;
        const view = doc?.defaultView;
        let selection = '';
        let rect = null;
        let pickedRange = null;
        try {
          const sel = view?.getSelection?.();
          if (sel !== null && sel !== undefined && sel.rangeCount > 0) {
            selection = String(sel.toString()).trim();
            pickedRange = sel.getRangeAt(0);
            const box = pickedRange.getBoundingClientRect();
            if (box.width > 0 || box.height > 0) rect = box;
          }
        } catch {
          selection = '';
        }
        const point = pointAt(doc, event.clientX, event.clientY);
        const raw = point !== null && point !== undefined && typeof point.container?.data === 'string'
          ? point.container.data
          : '';
        const sentence = raw === '' ? '' : expandSentenceAt(raw, point?.offset ?? 0);
        const phrase = normalizePhrase(selection) || sentence;
        const box = rect ?? {
          left: event.clientX,
          top: event.clientY,
          right: event.clientX,
          bottom: event.clientY,
          width: 0,
          height: 0,
        };
        event.preventDefault();
        event.stopPropagation();
        menu.show(box, {
          phrase,
          selection,
          rect: box,
          editable: false,
          hasSelection: selection !== '',
          hasExplain: Boolean(store.get().cards?.['n-' + hashString(phraseKey(phrase))]),
          hasDomain: Boolean(store.get().cards?.['n-' + hashString(phraseKey(phrase))]?.domain),
          queryLabel: isCodeLike(selection || phrase) ? '解释这段代码' : '解释这段文本',
          cardId: cardIdAtRange(pickedRange),
        });
      }

      /**
       * 快捷键：切开关（输入框里不拦）。
       * @param {KeyboardEvent} event - 键盘事件。
       * @returns {void}
       */
      function onShortcutKey(event) {
        if (isEditableTarget(event.target)) return;
        /* 先看批注模式的快捷键 */
        if (matchShortcut(event, store.get().annotateShortcut || 'Alt+A')) {
          event.preventDefault();
          event.stopPropagation();
          const on = annotator.setMode(!annotator.isOn());
          switchEl.flash(on ? '批注模式：左键拖选要改的文字' : '已退出批注模式');
          return;
        }
        /* 快捷键已移除：一切都走右键菜单 */
        return;
      }

      /**
       * Esc：清空画布并收起遮罩。
       *
       * 只在画布真的开着的时候拦，且输入框里放行（那里 Esc 有自己的含义）。
       * @param {KeyboardEvent} event - 键盘事件。
       * @returns {void}
       */
      function onEscapeKey(event) {
        if (event?.key === 'Delete' || event?.key === 'Backspace') {
          if (isEditableTarget(event.target)) return;
          const removed = board.removeSelected();
          if (removed > 0) {
            event.preventDefault();
            event.stopPropagation();
            switchEl.flash(`已删除 ${removed} 张卡片`);
            return;
          }
        }
        if (event?.key !== 'Escape') return;
        if (board.selectedIds().length > 0) {
          board.clearSelection();
          return;
        }
        if (library.isOpen()) {
          event.preventDefault();
          event.stopPropagation();
          library.close();
          return;
        }
        if (annotator.isOn()) {
          annotator.setMode(false);
          switchEl.flash('已退出批注模式');
          if (isEditableTarget(event.target)) return;
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (isEditableTarget(event.target)) return;
        if (board.count() === 0) return;
        event.preventDefault();
        event.stopPropagation();
        board.clear();
        painter.clearDomain();
      }

      let disposeSelector = () => {};
      try {
        disposeSelector = selector.dispose;
      } catch {
        disposeSelector = () => {};
      }

      doc?.addEventListener?.('contextmenu', onContextMenu, true);
      doc?.addEventListener?.('keydown', onShortcutKey, true);
      doc?.addEventListener?.('scroll', () => annotator.reposition(), true);
      doc?.defaultView?.addEventListener?.('resize', () => annotator.reposition());
      doc?.addEventListener?.('keydown', onEscapeKey, true);
      const disposeTheme = watchTheme(doc, (theme) => store.patch({ theme }));

      const actions = {
        setEnabled: (value) => setEnabled(value, true),
        setShortcut: (spec) => {
          writeConfig(globalThis, { shortcut: spec });
          store.patch({ shortcut: spec });
          switchEl.sync();
        },
        setDepth: (depth) => {
          writeConfig(globalThis, { depth });
          store.patch({ depth });
        },
        setModel: (model) => {
          writeConfig(globalThis, { model });
          store.patch({ model });
        },
      };

      const mapView = createMapView({ h: env.h, React: env.React, sessions, store, api, board, runExplain });
      ctx.slots.inject('conversation.view', () => ctx.slots.register({ ...VIEW_OPTIONS, inject: viewInjected }, mapView));

      try {
        const panel = createSettingsPanel({ h: env.h, React: env.React, api, store, actions });
        ctx.slots.inject('settings.section', () => ctx.slots.register({ ...SETTINGS_SECTION }, panel));
      } catch {
        /* 老宿主没有 settings.section：视图照常工作 */
      }

      /* 右下角的词林入口：宿主设置里没有外观选项，这里单独给一个。
         纯 DOM 实现，不占 React 树；dispose 时一并摘掉。 */
      let lookFab = null;
      try {
        lookFab = mountLookFab({ doc: globalThis.document, win: globalThis });
      } catch {
        /* 没有 body 的极老宿主直接跳过，不影响圈词 */
      }


      /* 会话一切换，把那个会话的节点取出来。 */
      const reload = (sessionId) => {
        store.patch({ sessionId, nodes: nodesOfSession(readMapStore(globalThis), sessionId), cards: {}, activeId: '' });
      };
      store.subscribe((state) => {
        if (state.sessionId !== '' && state.sessionId !== reload.last) {
          reload.last = state.sessionId;
          reload(state.sessionId);
        }
      });

      /* 卸载：手势、快捷键、右键、主题、三块浮层一起摘，不留野监听。 */
      try {
        ctx.on?.('dispose', () => {
          lookFab?.dispose?.();
        disposeSelector();
          disposeTheme();
          doc?.removeEventListener?.('contextmenu', onContextMenu, true);
          doc?.removeEventListener?.('keydown', onShortcutKey, true);
          doc?.removeEventListener?.('keydown', onEscapeKey, true);
          menu.dispose();
          switchEl.dispose();
          board.dispose();
          annotator.dispose();
          painter.clear();
        });
      } catch {
        /* 老宿主没有 dispose 事件：忽略 */
      }
    },
  };
}
