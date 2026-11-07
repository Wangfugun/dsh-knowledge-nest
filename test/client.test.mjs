/**
 * 客户端 bundle 的"无浏览器"冒烟：真加载 client.js，真调 apply，真渲染一次组件。
 *
 * 这一段专门防三类事故：
 *   1) 拼包后顶层名字撞车（classic script 里会直接覆盖，静默出错）；
 *   2) apply 里引用了还没定义的变量（TDZ，浏览器里就是白屏）；
 *   3) 槽位注册参数被改坏（视图拿不到 sessionId → 永远空白）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFakeDom } from '../tools/fake-dom.mjs';

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');

/** 极简 React 替身：够跑组件函数，不跑 hooks 语义。 */
const React = {
  createElement(type, props, ...children) {
    return { type, props: props ?? {}, children };
  },
  useState(initial) {
    return [typeof initial === 'function' ? initial() : initial, () => {}];
  },
  useEffect() {},
  useMemo(factory) {
    return factory();
  },
  useCallback(fn) {
    return fn;
  },
  useRef(value) {
    return { current: value };
  },
  createContext() {
    return {};
  },
};

/**
 * 在隔离的 globalThis 里加载 bundle，拿回插件对象。
 * @returns {object} 插件对象。
 */
function loadPlugin() {
  let plugin = null;
  const fakeWindow = {
    __ModuleLoader__: {
      load(definition) {
        plugin = definition.factory((name) => {
          if (name === 'react') return React;
          throw new Error(`unexpected require: ${name}`);
        });
      },
    },
  };
  const previousWindow = globalThis.window;
  globalThis.window = fakeWindow;
  try {
    // eslint-disable-next-line no-new-func
    new Function(source)();
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
  return plugin;
}

test('bundle 能加载，并返回一个 cordis 客户端插件', () => {
  const plugin = loadPlugin();
  assert.equal(typeof plugin, 'object');
  assert.deepEqual(plugin.inject, ['slots', 'sessions']);
  assert.equal(typeof plugin.apply, 'function');
});

test('apply：注册 conversation.view（带 inject）与 settings.section', () => {
  const plugin = loadPlugin();
  const registered = [];
  const ctx = {
    get: () => null,
    slots: {
      inject(name, factory) {
        factory();
      },
      register(options, component) {
        registered.push({ options, component });
        return () => {};
      },
    },
    effect() {},
    on() {},
  };
  plugin.apply(ctx, {});
  assert.equal(registered.length, 2);
  const view = registered.find((item) => item.options.name === 'conversation.view');
  const panel = registered.find((item) => item.options.name === 'settings.section');
  assert.ok(view !== undefined, '必须注册 conversation.view');
  assert.ok(panel !== undefined, '必须注册 settings.section');
  assert.equal(view.options.id, 'knowledge');
  assert.equal(view.options.label, '知识库');
  assert.equal(typeof view.options.inject, 'function');
  assert.deepEqual(view.options.inject('sess-1'), { sessionId: 'sess-1' });
  assert.equal(typeof view.component, 'function');
});

test('视图渲染：没有会话时给空态，不抛', () => {
  const plugin = loadPlugin();
  let component = null;
  const ctx = {
    get: () => null,
    slots: {
      inject(name, factory) {
        factory();
      },
      register(options, view) {
        if (options.name === 'conversation.view') component = view;
        return () => {};
      },
    },
    effect() {},
    on() {},
  };
  plugin.apply(ctx, {});
  assert.equal(typeof component, 'function');
  const tree = component({ sessionId: '' });
  assert.equal(tree.type, 'div');
  assert.equal(tree.props.className, 'knest-stage');
  const text = JSON.stringify(tree, (key, value) => (key === 'props' ? undefined : value));
  assert.ok(text.includes('还没有可圈的东西') || text.includes('knest-blank'));
});

/* ──────────────────────────────────────────────────────────────
 * 菜单动作的端到端冒烟：真加载 bundle、真 apply、真点菜单。
 *
 * 这一条是冲着"actions.js 没打进 bundle"那个 bug 去的：当时六个函数
 * "被引用但未定义"，点菜单四秒才炸，而所有测试照常绿。现在每个动作都断言
 * **副作用真的发生了**（剪贴板/笔记本/朗读），而且 console.warn 必须为空——
 * menu.js 会把动作里的异常吞成一行 warn，不盯它等于没测。
 * ────────────────────────────────────────────────────────────── */

/**
 * 装一套假宿主：document / window / localStorage / fetch / clipboard / TTS。
 * @param {{enabled:boolean}} options - 开关状态。
 * @returns {object} 测试句柄。
 */
function mountPlugin(options) {
  const dom = createFakeDom({ selection: '推倒重来' });
  const { doc, win } = dom;

  const memory = new Map();
  memory.set('dsh.knowledge-nest.config', JSON.stringify({
    enabled: options?.enabled !== false,
    model: '',
    shortcut: 'Alt+Q',
    depth: 'compact',
  }));
  const localStorage = {
    getItem: (key) => (memory.has(key) ? memory.get(key) : null),
    setItem: (key, value) => memory.set(key, String(value)),
    removeItem: (key) => memory.delete(key),
  };

  const clipboard = {
    written: [],
    writeText(text) {
      clipboard.written.push(String(text));
      return Promise.resolve();
    },
  };
  win.navigator.clipboard = clipboard;

  const spoken = [];
  const previousSpeech = globalThis.speechSynthesis;
  const previousUtterance = globalThis.SpeechSynthesisUtterance;
  globalThis.speechSynthesis = { speak: (utterance) => spoken.push(String(utterance?.text ?? '')), cancel() {} };
  globalThis.SpeechSynthesisUtterance = function Utterance(text) {
    this.text = text;
  };

  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    localStorage: globalThis.localStorage,
    fetch: globalThis.fetch,
  };
  globalThis.window = win;
  globalThis.document = doc;
  globalThis.localStorage = localStorage;

  const fetchCalls = [];
  globalThis.fetch = async (url, init) => {
    fetchCalls.push({ url: String(url), method: init?.method ?? 'GET' });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        data: { here: '在这段对话里指整体推翻重做。', kind: '动作', confidence: 'high', evidence: [], readings: [], links: [] },
        cached: false,
        model: 'stub-model',
        ms: 7,
      }),
      text: async () => '',
    };
  };

  const warns = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warns.push(args.map((arg) => String(arg)).join(' '));

  let plugin = null;
  const loader = {
    __ModuleLoader__: {
      load(definition) {
        plugin = definition.factory((name) => {
          if (name === 'react') return React;
          throw new Error(`unexpected require: ${name}`);
        });
      },
    },
  };
  globalThis.window = loader;
  new Function(source)();
  globalThis.window = win;

  const registered = [];
  const ctx = {
    get: () => null,
    slots: {
      inject(name, factory) {
        factory();
      },
      register(options2, component) {
        registered.push({ options: options2, component });
        return () => {};
      },
    },
    effect() {},
    on() {},
  };

  plugin.apply(ctx, {});

  /** 右键一下，让菜单出现。 */
  const openMenu = () => {
    doc.dispatch('contextmenu', {
      target: doc.body,
      clientX: 120,
      clientY: 210,
      preventDefault() {},
      stopPropagation() {},
    });
  };

  /** 当前页的菜单盒。 */
  const menuBox = () => {
    const layer = doc.getElementById('knest-menu-layer');
    if (layer === null) throw new Error('菜单没出现');
    return layer.children[0];
  };

  /** 点「更多 / 返回」。 */
  const clickNav = (nav) => {
    const box = menuBox();
    const button = box.children.find((child) => child.attrs['data-nav'] === nav);
    if (button === undefined) throw new Error(`找不到菜单导航 ${nav}`);
    button.dispatch('click', { preventDefault() {}, stopPropagation() {} });
  };

  /** 点菜单里的某一项（不在当前页就自动翻到「更多」）。 */
  const clickAction = (action) => {
    let box = menuBox();
    let button = box.children.find((child) => child.attrs['data-action'] === action);
    if (button === undefined) {
      clickNav('more');
      box = menuBox();
      button = box.children.find((child) => child.attrs['data-action'] === action);
    }
    if (button === undefined) throw new Error(`找不到菜单项 ${action}`);
    box.dispatch('click', { target: button, preventDefault() {}, stopPropagation() {} });
  };

  const cleanup = () => {
    console.warn = originalWarn;
    globalThis.window = previous.window;
    globalThis.document = previous.document;
    globalThis.localStorage = previous.localStorage;
    globalThis.fetch = previous.fetch;
    globalThis.speechSynthesis = previousSpeech;
    globalThis.SpeechSynthesisUtterance = previousUtterance;
  };

  return { doc, win, plugin, registered, clipboard, spoken, warns, memory, fetchCalls, openMenu, clickAction, cleanup };
}

test('菜单动作真的会调用 actions.js（复制释义 / 引用 / 收进圈词本 / 朗读）', async () => {
  const h = mountPlugin({ enabled: false });
  try {
    /* 1) 先"查询"，让 store 里有一张解释卡 */
    h.openMenu();
    h.clickAction('query');
    await new Promise((resolve) => setTimeout(resolve, 80));

    /* 2) 复制释义：必须写出【推倒重来】 */
    h.openMenu();
    h.clickAction('copy-explain');
    assert.equal(h.clipboard.written.some((text) => text.includes('推倒重来')), true, '复制释义没有写进剪贴板');

    /* 3) 复制引用块：> 开头 */
    h.openMenu();
    h.clickAction('copy-quote');
    assert.equal(h.clipboard.written.some((text) => text.startsWith('> ')), true, '引用块格式不对');

    /* 4) 收进圈词本：localStorage 里要有这条 */
    h.openMenu();
    h.clickAction('save');
    const notebook = h.memory.get('dsh.knowledge-nest.notebook') ?? '';
    assert.equal(notebook.includes('推倒重来'), true, '圈词本没有写入');

    /* 5) 朗读：TTS 被调用 */
    h.openMenu();
    h.clickAction('speak');
    assert.ok(h.spoken.length > 0, '朗读没有触发 TTS');

    /* 6) 全程不该有被吞掉的异常 */
    assert.deepEqual(h.warns, [], `菜单动作抛错被吞了：${h.warns.join(' | ')}`);
  } finally {
    h.cleanup();
  }
});
