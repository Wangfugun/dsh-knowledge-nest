/**
 * 纯函数：清洗、哈希、圈词、快照、布局、卡片。
 * 这些是"改一行就可能默默坏掉"的地方，每条用例都对着一个具体回归。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { cleanMarkdown, hashString, clampText, clampMiddle } from '../client/util.js';
import { normalizePhrase, expandSentenceAt, sentenceContaining, rangeBetween, phraseKey } from '../client/phrase.js';
import { buildTranscript, buildContext, countPhrase, firstMessageIndex, DEPTHS } from '../client/transcript.js';
import { layoutMap, MAP_GEOMETRY } from '../client/layout.js';
import { buildCard, buildErrorCard, buildPendingCard, parentContextOf } from '../client/card.js';
import { readConfig, writeConfig, parseShortcut, matchShortcut, shortcutFromEvent, DEFAULT_CONFIG } from '../client/config.js';
import { attachSelector } from '../client/selector.js';
import { createMenu, menuItemsFor } from '../client/menu.js';
import { searchCards } from '../client/library.js';
import { contextAroundRange } from '../client/phrase.js';

test('cleanMarkdown：记号去掉，正文留下', () => {
  const raw = '## 标题\n\n**粗**、`代码`、[链接](http://x)\n\n```js\nconst a = 1;\n```\n';
  const out = cleanMarkdown(raw);
  assert.equal(out.includes('##'), false);
  assert.equal(out.includes('**'), false);
  assert.equal(out.includes('const a = 1;'), true);
  assert.equal(out.includes('链接'), true);
});

test('cleanMarkdown：畸形输入不抛', () => {
  for (const value of [null, undefined, 42, {}, [], '']) {
    assert.equal(typeof cleanMarkdown(value), 'string');
  }
});

test('hashString：稳定且短', () => {
  assert.equal(hashString('推倒重来'), hashString('推倒重来'));
  assert.notEqual(hashString('推倒重来'), hashString('推倒重来 '));
  assert.ok(hashString('x'.repeat(5000)).length <= 8);
});

test('clampText / clampMiddle：头尾都留', () => {
  assert.equal(clampText('  a \n b  ', 10), 'a b');
  const long = `HEAD${'x'.repeat(400)}TAIL`;
  const clipped = clampMiddle(long, 100);
  assert.ok(clipped.startsWith('HEAD'));
  assert.ok(clipped.endsWith('TAIL'));
  assert.ok(clipped.length <= 100);
});

test('normalizePhrase：去标点、压空白、切上限', () => {
  assert.equal(normalizePhrase('「推倒重来」'), '推倒重来');
  assert.equal(normalizePhrase('  流程  图  '), '流程 图');
  assert.equal(normalizePhrase('。'), '');
  assert.equal(normalizePhrase('x'.repeat(400)).length, 120);
});

test('expandSentenceAt：向两侧扩到句读', () => {
  const text = '第一句。第二句里有【关键】词！第三句。';
  assert.equal(expandSentenceAt(text, text.indexOf('关键')), '第二句里有【关键】词');
  assert.equal(expandSentenceAt('', 0), '');
});

test('sentenceContaining / phraseKey', () => {
  const text = '甲。乙丙丁。戊';
  assert.equal(sentenceContaining(text, '丙'), '乙丙丁');
  assert.equal(sentenceContaining(text, '不存在'), '');
  assert.equal(phraseKey('  推倒  重来 '), '推倒 重来');
});

test('rangeBetween：起止反了也能取到文本', () => {
  let calls = 0;
  const doc = {
    createRange() {
      calls += 1;
      const first = calls === 1;
      return {
        setStart() {},
        setEnd() {},
        toString() {
          return first ? '   ' : '推倒重来';
        },
      };
    },
  };
  const point = { container: {}, offset: 0 };
  const out = rangeBetween(doc, point, { container: {}, offset: 3 });
  assert.equal(out.text, '推倒重来');
  assert.equal(rangeBetween(null, point, point).text, '');
});

const entries = [
  { event: { seq: 2, type: 'assistant/message', data: { message: { id: 'a1', content: [{ type: 'text', text: '**回答**：流程图重做。' }] } } } },
  { event: { seq: 1, type: 'user/message', data: { id: 'u1', content: [{ type: 'text', text: '把流程图重做一下' }] } } },
  { event: { seq: 3, type: 'tool/call', data: { name: 'bash' } } },
  { event: { seq: 2, type: 'assistant/message', data: { message: { id: 'dup', content: [{ type: 'text', text: '重复 seq 应被丢掉' }] } } } },
  { seq: 4, type: 'assistant/message', data: { message: { id: 'a2', content: [{ type: 'thinking', text: '不该出现' }, { type: 'text', text: '裸事件也要认。' }] } } },
];

test('buildTranscript：包装与裸事件都认，按 seq 排序去重', () => {
  const rows = buildTranscript(entries);
  assert.deepEqual(rows.map((row) => row.id), ['u1', 'a1', 'a2']);
  assert.equal(rows[0].role, 'you');
  assert.equal(rows[1].text, '回答：流程图重做。');
  assert.equal(rows[2].text, '裸事件也要认。');
  assert.equal(buildTranscript(null).length, 0);
});

test('countPhrase / firstMessageIndex：跨消息统计', () => {
  const rows = buildTranscript(entries);
  const stat = countPhrase(rows, '流程图');
  assert.equal(stat.total, 2);
  assert.equal(stat.messages, 2);
  assert.equal(stat.firstIndex, 0);
  assert.equal(firstMessageIndex(rows, '没有这个词'), -1);
  assert.equal(countPhrase(rows, '').total, 0);
});

test('buildContext：命中就取前后窗口，指纹只跟内容走', () => {
  const rows = buildTranscript(entries);
  const one = buildContext(rows, { phrase: '流程图' });
  const two = buildContext(rows, { phrase: '流程图' });
  assert.equal(one.fingerprint, two.fingerprint);
  assert.ok(one.context.includes('流程图'));
  const other = buildContext(rows, { phrase: '别的词' });
  assert.notEqual(one.fingerprint, other.fingerprint);
});

test('layoutMap：节点挂在消息上，同一行的词竖着错开', () => {
  const messages = [
    { id: 'u1', role: 'you', text: '第一句' },
    { id: 'a1', role: 'ai', text: '第二句说得长一点'.repeat(6) },
    { id: 'a2', role: 'ai', text: '第三句' },
  ];
  const nodes = [
    { id: 'n1', phrase: '第一句', messageIndex: 0, count: 1 },
    { id: 'n2', phrase: '第二句', messageIndex: 1, count: 3 },
    { id: 'n3', phrase: '第三句', messageIndex: 2, count: 1 },
    { id: 'n4', phrase: '同一句里的另一个词', messageIndex: 1, count: 1 },
  ];
  const layout = layoutMap({ messages, nodes });
  assert.equal(layout.points.length, 4);
  assert.equal(layout.branches.length, 4, '每个节点一条支线');
  assert.equal(layout.stems.length, 3, '每条消息一条主轴短接');
  assert.equal(layout.edges.length, 1, '同一条消息上的两个词之间有一根竖线');
  const n2 = layout.points.find((point) => point.id === 'n2');
  const n4 = layout.points.find((point) => point.id === 'n4');
  assert.equal(n2.x, n4.x, '同一列，不横向错开（横向会压字）');
  assert.notEqual(n2.y, n4.y, '竖着错开');
  assert.ok(layout.height > MAP_GEOMETRY.top);
  assert.equal(layoutMap({}).points.length, 0);
});

test('buildCard：超长字段被削、坏条目被丢', () => {
  const card = buildCard({
    phrase: '推倒重来',
    count: 3,
    model: 'deepseek-flash',
    data: {
      here: 'x'.repeat(400),
      kind: '动作',
      literal: '字面义',
      confidence: 'high',
      readings: [{ label: '读法', note: 'note' }, { label: '' }, 'garbage'],
      evidence: [{ quote: '原话', why: '说明' }, { why: '没有 quote 应被丢' }],
      links: [{ label: '相关', note: 'n', children: [{ label: '细', note: 'm' }, { note: 'no label' }] }],
    },
  });
  assert.ok(card.lead.length <= 260);
  assert.equal(card.kind, '动作');
  assert.equal(card.evidence.length, 1);
  assert.equal(card.readings.length, 2);
  assert.equal(card.tree[0].children.length, 1);
  assert.equal(card.confidence.tone, 'high');
  assert.equal(card.meta.count, 3);
});

test('buildPendingCard / buildErrorCard：都给得出话', () => {
  assert.equal(buildPendingCard('词').pending, true);
  const error = buildErrorCard('词', { code: 'no-key', message: 'x', retryable: false });
  assert.equal(error.error, true);
  assert.match(error.lead, /key/u);
  const unknown = buildErrorCard('词', { code: 'weird', message: '兜底文案' });
  assert.equal(unknown.lead, '兜底文案');
});

/** 假 window（localStorage 够用即可）。 */
function fakeWindow(initial) {
  const map = new Map(Object.entries(initial ?? {}));
  return {
    localStorage: {
      getItem: (key) => (map.has(key) ? map.get(key) : null),
      setItem: (key, value) => map.set(key, String(value)),
      removeItem: (key) => map.delete(key),
    },
  };
}

test('config：默认值、坏值回落、写入读回', () => {
  const win = fakeWindow();
  assert.deepEqual(readConfig(win), { ...DEFAULT_CONFIG });
  assert.equal(readConfig(win).enabled, true);
  assert.equal(readConfig(win).depth, 'compact');

  const next = writeConfig(win, { enabled: false, shortcut: 'Ctrl+Shift+K', depth: 'deep' });
  assert.equal(next.enabled, false);
  const reread = readConfig(win);
  assert.equal(reread.enabled, false);
  assert.equal(reread.shortcut, 'Ctrl+Shift+K');
  assert.equal(reread.depth, 'deep');

  const broken = fakeWindow({ 'dsh.knowledge-nest.config': '{不是 json' });
  assert.deepEqual(readConfig(broken), { ...DEFAULT_CONFIG });

  const junk = fakeWindow({ 'dsh.knowledge-nest.config': '{"depth":"乱写","model":123}' });
  assert.equal(readConfig(junk).depth, 'compact');
  assert.equal(readConfig(junk).model, '');
});

test('config：快捷键解析与匹配', () => {
  assert.deepEqual(parseShortcut('Alt+Q'), { key: 'q', ctrl: false, alt: true, shift: false, meta: false });
  assert.deepEqual(parseShortcut('Ctrl+Shift+K'), { key: 'k', ctrl: true, alt: false, shift: true, meta: false });
  assert.equal(parseShortcut(''), null);
  assert.equal(parseShortcut('Alt+foo'), null);

  const event = { key: 'Q', ctrlKey: false, altKey: true, shiftKey: false, metaKey: false };
  assert.equal(matchShortcut(event, 'Alt+Q'), true);
  assert.equal(matchShortcut(event, 'Ctrl+Q'), false);
  assert.equal(matchShortcut({ ...event, shiftKey: true }, 'Alt+Q'), false);

  assert.equal(shortcutFromEvent({ key: 'q', ctrlKey: false, altKey: true, shiftKey: false, metaKey: false }), 'Alt+Q');
  assert.equal(shortcutFromEvent({ key: 'Control', altKey: true }), null);
  assert.equal(shortcutFromEvent({ key: ' ', altKey: true }), 'Alt+Space');
});

test('buildContext：档位越小上下文越短', () => {
  const rows = Array.from({ length: 20 }, (_, index) => ({
    id: `m${index}`,
    role: index % 2 === 0 ? 'you' : 'ai',
    text: `第 ${index} 条里提到了推倒重来，后面还有很多补充说明。`.repeat(8),
  }));
  const compact = buildContext(rows, { phrase: '推倒重来', depth: 'compact' });
  const standard = buildContext(rows, { phrase: '推倒重来', depth: 'standard' });
  const deep = buildContext(rows, { phrase: '推倒重来', depth: 'deep' });
  assert.ok(compact.chars < standard.chars);
  assert.ok(standard.chars < deep.chars);
  assert.ok(compact.chars <= DEPTHS.compact.budget);
  assert.equal(compact.depth, 'compact');
  assert.equal(buildContext(rows, { phrase: '推倒重来', depth: '乱写' }).depth, 'compact');
});

test('buildCard：用量进 meta，卡片能显示 token', () => {
  const card = buildCard({
    phrase: '推倒重来',
    data: { here: '重做' },
    usage: { prompt: 594, completion: 242, total: 836 },
  });
  assert.equal(card.meta.usage.total, 836);
  assert.equal(card.meta.usage.prompt, 594);
});

test('selector：关掉圈词时完全不接管右键', () => {
  const handlers = {};
  let prevented = 0;
  const doc = {
    addEventListener(type, fn) {
      handlers[type] = fn;
    },
    removeEventListener() {},
    defaultView: null,
    createRange() {
      return { setStart() {}, setEnd() {}, toString: () => 'x', getBoundingClientRect: () => ({ width: 1, height: 1 }) };
    },
    caretRangeFromPoint() {
      return { startContainer: { nodeType: 3, data: '推倒重来', parentNode: null }, startOffset: 1 };
    },
  };
  attachSelector(doc, { isEnabled: () => false, onPick() {} });
  handlers.mousedown({
    button: 2,
    clientX: 10,
    clientY: 10,
    target: null,
    preventDefault() {
      prevented += 1;
    },
    stopPropagation() {},
  });
  assert.equal(prevented, 0, '关闭时不该吞掉右键');

  const handlers2 = {};
  const doc2 = { ...doc, addEventListener: (type, fn) => { handlers2[type] = fn; } };
  attachSelector(doc2, { isEnabled: () => true, onPick() {} });
  handlers2.mousedown({
    button: 2,
    clientX: 10,
    clientY: 10,
    target: null,
    preventDefault() {
      prevented += 1;
    },
    stopPropagation() {},
  });
  assert.equal(prevented, 1, '开启时才接管');
});


/** 极简假 DOM：只够 menu.show() 跑一遍。 */
function fakeDom() {
  const make = (tag) => {
    const node = {
      tag,
      className: '',
      textContent: '',
      attrs: {},
      style: { setProperty() {} },
      dataset: {},
      children: [],
      parentNode: null,
      hidden: false,
      disabled: false,
      appendChild(child) {
        child.parentNode = node;
        node.children.push(child);
        return child;
      },
      prepend(child) {
        child.parentNode = node;
        node.children.unshift(child);
        return child;
      },
      insertBefore(child) {
        child.parentNode = node;
        node.children.push(child);
        return child;
      },
      setAttribute(key, value) {
        node.attrs[key] = String(value);
      },
      getAttribute(key) {
        return node.attrs[key] ?? null;
      },
      addEventListener() {},
      removeEventListener() {},
      remove() {
        if (node.parentNode !== null) {
          node.parentNode.children = node.parentNode.children.filter((item) => item !== node);
          node.parentNode = null;
        }
      },
      querySelector() {
        return null;
      },
      closest() {
        return null;
      },
      get offsetWidth() {
        return 180;
      },
      get offsetHeight() {
        return 160;
      },
    };
    return node;
  };
  const body = make('body');
  return {
    body,
    documentElement: body,
    defaultView: { innerWidth: 1200, innerHeight: 800, addEventListener() {}, removeEventListener() {} },
    createElement: make,
    createElementNS: (ns, tag) => make(tag),
    createTextNode: (text) => ({ tag: '#text', textContent: text }),
    getElementById: () => null,
    addEventListener() {},
    removeEventListener() {},
  };
}

test('menu：一级四项 + 「更多」真的挂到 DOM 上（上一版这里是空的）', () => {
  const doc = fakeDom();
  const menu = createMenu({ doc, onAction() {} });
  menu.show({ left: 100, top: 200, right: 160, bottom: 220, width: 60, height: 20 }, {
    phrase: '推倒重来',
    selection: '推倒重来',
    editable: false,
    hasSelection: true,
    hasExplain: true,
  });
  assert.equal(menu.isOpen(), true);
  const layer = doc.body.children.find((node) => node.attrs.id === 'knest-menu-layer');
  assert.ok(layer !== undefined, '菜单根节点必须挂上');
  const box = layer.children[0];
  assert.equal(box.className, 'knest-menu');
  const actions = box.children
    .filter((node) => node.attrs['data-action'] !== undefined)
    .map((node) => node.attrs['data-action']);
  assert.deepEqual(actions, ['copy', 'query', 'rephrase', 'mark-domain', 'annotate', 'save']);
  const more = box.children.find((node) => node.attrs['data-nav'] === 'more');
  assert.ok(more !== undefined, '必须有「更多」入口');
  assert.equal(box.children.filter((node) => node.className === 'knest-mdiv').length, 1);
  menu.hide();
  assert.equal(menu.isOpen(), false);
});

test('menuItemsFor：选中才可用，复制释义要先有释义', () => {
  const { top, more } = menuItemsFor({ hasSelection: true, selection: '词', hasExplain: true, hasDomain: true });
  assert.deepEqual(top.map((item) => item.action), ['copy', 'query', 'rephrase', 'mark-domain', 'annotate', 'save']);
  assert.equal(top.every((item) => item.disabled === false), true);
  assert.deepEqual(more.map((item) => item.action), ['copy-explain', 'example', 'translate', 'speak', 'copy-quote', 'locate', 'clear-notes']);
  assert.equal(more.every((item) => item.disabled === false), true);

  /* 标出同领域：只有拿到 domain 才可用 */
  const noDomain = menuItemsFor({ hasSelection: true, selection: '暴击', hasDomain: false });
  assert.equal(noDomain.top.find((item) => item.action === 'mark-domain').disabled, true);
  const withDomain = menuItemsFor({ hasSelection: true, selection: '暴击', hasDomain: true });
  assert.equal(withDomain.top.find((item) => item.action === 'mark-domain').disabled, false);

  const bare = menuItemsFor({ hasSelection: false, selection: '' });
  assert.equal(bare.top.find((item) => item.action === 'copy').disabled, true);
  assert.equal(bare.top.find((item) => item.action === 'save').disabled, true);
  assert.equal(bare.top.find((item) => item.action === 'query').disabled, false, '没有选区时查询仍然可以问整句');
  assert.equal(bare.more.find((item) => item.action === 'copy-explain').disabled, true);

  const noExplain = menuItemsFor({ hasSelection: true, selection: '词', hasExplain: false });
  assert.equal(noExplain.more.find((item) => item.action === 'copy-explain').disabled, true);
  assert.equal(noExplain.top.find((item) => item.action === 'copy').disabled, false);
});

test('buildCard：domain 进卡片，超长削到 10 字', () => {
  const card = buildCard({ phrase: '暴击', data: { here: '游戏里指伤害翻倍', domain: '游戏' } });
  assert.equal(card.domain, '游戏');
  const long = buildCard({ phrase: 'x', data: { here: 'y', domain: '一二三四五六七八九十十一' } });
  assert.ok(long.domain.length <= 10);
  const none = buildCard({ phrase: 'x', data: { here: 'y' } });
  assert.equal(none.domain, '');
});

test('parentContextOf：把上一张卡片压成上级概念上下文', () => {
  const node = {
    text: 'pointer-events:none',
    model: {
      lead: 'CSS 声明，让元素不响应鼠标/触摸事件，点击会穿透到下层。',
      literal: '指针事件为无。',
      evidence: [{ quote: 'pointer-events:none', why: '示例' }, { quote: '让元素点不到', why: '示例' }],
    },
  };
  const block = parentContextOf(node);
  assert.ok(block.includes('【上级概念】pointer-events:none'), block);
  assert.ok(block.includes('点击会穿透到下层'));
  assert.ok(block.includes('通常含义：指针事件为无。'));
  assert.ok(block.includes('它在这段对话里的依据：「pointer-events:none」、「让元素点不到」'));

  /* 空节点 → 空串，不会往上下文里塞垃圾 */
  assert.equal(parentContextOf(null), '');
  assert.equal(parentContextOf({ model: {} }), '');
  assert.equal(parentContextOf({ text: 'x', model: { lead: '' } }).includes('【上级概念】'), true);
});

test('searchCards：词 / 释义 / 原文 / 领域 四个字段都参与匹配', () => {
  const cards = [
    { phrase: '推倒重来', lead: '整体推翻重写', domain: '工程', evidence: [{ quote: '前端设计太烂' }] },
    { phrase: '暴击', lead: '伤害翻倍', domain: '游戏', evidence: [] },
  ];
  assert.equal(searchCards(cards, '推倒').length, 1);
  assert.equal(searchCards(cards, '翻倍').length, 1, '按释义命中');
  assert.equal(searchCards(cards, '太烂').length, 1, '按原文引用命中');
  assert.equal(searchCards(cards, '游戏').length, 1, '按领域命中');
  assert.equal(searchCards(cards, '').length, 2, '空关键词返回全部');
  assert.equal(searchCards(cards, '不存在').length, 0);
  assert.equal(searchCards(cards, '', { domain: '工程' }).length, 1, '领域过滤');
});

test('contextAroundRange：从句子里取周边原文，词不在时退化为开头一段', () => {
  const text = '粘度是流体的内摩擦，单位 Pa·s，物理意义是速度梯度为一层时单位面积上的摩擦力。';
  const range = {
    startContainer: { nodeType: 1, tagName: 'P', textContent: text, parentNode: null },
  };
  const got = contextAroundRange(range, '内摩擦', 10);
  assert.ok(got.includes('内摩擦'), got);
  assert.ok(got.length <= text.length);

  const miss = contextAroundRange(range, '不存在的词', 5);
  assert.equal(typeof miss, 'string');
  assert.equal(contextAroundRange(null, 'x'), '');
});
