/**
 * 知识树画布：连线几何（纯函数）+ 画布 DOM 行为。
 *
 * 重点盯三件事：
 *   1) 连线的 d 属性坐标对不对（父 (0,0) → 子 (100,100) 是用户点名的用例）；
 *   2) 拖节点后连线跟着重算；
 *   3) 3 层封顶、删父节点连带删子节点。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createFakeDom } from '../tools/fake-dom.mjs';
import {
  createTreeBoard,
  edgeFor,
  pathFor,
  depthOf,
  descendantsOf,
  placeChild,
  MAX_LEVELS,
  NODE_W,
} from '../client/tree-board.js';

/** 假 DOM 里所有节点都是 180×160（见 tools/fake-dom.mjs 的 offset 取值）。 */
const SIZE = { w: 180, h: 160 };

test('edgeFor：父 (0,0) → 子 (100,100) 走竖向，端点落在底边中点与顶边中点', () => {
  const edge = edgeFor({ x: 0, y: 0 }, { x: 100, y: 100 }, SIZE, SIZE);
  assert.equal(edge.orientation, 'vertical');
  assert.equal(edge.x1, 90, '父底边中点 x = 0 + 180/2');
  assert.equal(edge.y1, 160, '父底边 y = 0 + 160');
  assert.equal(edge.x2, 190, '子顶边中点 x = 100 + 180/2');
  assert.equal(edge.y2, 100, '子顶边 y = 100');

  const d = pathFor(edge);
  assert.ok(d.startsWith('M 90 160 C '), d);
  assert.ok(d.endsWith(' 190 100'), d);
  assert.equal(d, 'M 90 160 C 90 200 190 60 190 100');
});

test('edgeFor：横向错开很远时改走左右边中点', () => {
  const edge = edgeFor({ x: 0, y: 0 }, { x: 600, y: 40 }, SIZE, SIZE);
  assert.equal(edge.orientation, 'horizontal');
  assert.equal(edge.x1, 180, '父右边');
  assert.equal(edge.y1, 80, '父竖向中点');
  assert.equal(edge.x2, 600, '子左边');
  assert.equal(edge.y2, 120);
  assert.ok(pathFor(edge).startsWith('M 180 80 C '));
});

test('三节点链路：根 → 子 → 孙，三条线各自成立', () => {
  const root = { x: 0, y: 0 };
  const child = { x: 100, y: 100 };
  const grand = { x: 100, y: 356 };
  const e1 = pathFor(edgeFor(root, child, SIZE, SIZE));
  const e2 = pathFor(edgeFor(child, grand, SIZE, SIZE));
  assert.equal(e1, 'M 90 160 C 90 200 190 60 190 100');
  assert.equal(e2, 'M 190 260 C 190 308 190 308 190 356');
  assert.notEqual(e1, e2);
});

test('depthOf / descendantsOf / placeChild', () => {
  const nodes = [
    { id: 'a', parentId: null },
    { id: 'b', parentId: 'a' },
    { id: 'c', parentId: 'b' },
    { id: 'd', parentId: 'c' },
  ];
  assert.equal(depthOf(nodes, 'a'), 0);
  assert.equal(depthOf(nodes, 'b'), 1);
  assert.equal(depthOf(nodes, 'd'), 3);
  assert.equal(depthOf(nodes, 'nope'), -1);
  assert.deepEqual(descendantsOf(nodes, 'b').sort(), ['b', 'c', 'd']);
  assert.deepEqual(descendantsOf(nodes, 'a').sort(), ['a', 'b', 'c', 'd']);

  /* 第一个孩子落在父节点正下方居中 */
  const spot = placeChild([{ id: 'a', parentId: null, x: 0, y: 0 }], { id: 'a', x: 0, y: 0 }, SIZE, 0);
  assert.equal(spot.x, 0 + SIZE.w / 2 - 300 / 2);
  assert.ok(spot.y > 0);
  assert.equal(NODE_W, 300);
});

test('画布 DOM：真建节点 + 真画线，d 属性带正确坐标', () => {
  const { doc } = createFakeDom();
  const board = createTreeBoard({ doc });
  board.mount();

  board.openRoot({ id: 'a', text: '推倒重来', model: { lead: '整体重做' } });
  board.addChild('a', { id: 'b', text: '流程图', x: 0, y: 0, model: { lead: '会话竖轴' } });
  board.move('b', 100, 100);

  const d = board.edgePath('a', 'b');
  assert.ok(d.includes('M 90 160'), `d=${d}`);
  assert.ok(d.includes('190 100'), `d=${d}`);
  assert.equal(board.count(), 2);

  /* 拖拽改坐标 → 连线立刻重算 */
  board.move('b', 0, 260);
  assert.ok(board.edgePath('a', 'b').includes('M 90 160'));
  assert.ok(board.edgePath('a', 'b').endsWith(' 90 260'));
});

test('画布：最多 4 层，第 5 层加不进去', () => {
  const { doc } = createFakeDom();
  const board = createTreeBoard({ doc });
  board.mount();
  board.openRoot({ id: 'l1', text: '一', model: {} });
  board.addChild('l1', { id: 'l2', text: '二', model: {} });
  board.addChild('l2', { id: 'l3', text: '三', model: {} });
  board.addChild('l3', { id: 'l4', text: '四', model: {} });
  assert.equal(board.count(), 4);
  assert.equal(MAX_LEVELS, 4);
  const fifth = board.addChild('l4', { id: 'l5', text: '五', model: {} });
  assert.equal(fifth, null, '第 5 层必须被拒绝');
  assert.equal(board.count(), 4);
});

test('画布：删父节点连带删掉后代', () => {
  const { doc } = createFakeDom();
  const board = createTreeBoard({ doc });
  board.mount();
  board.openRoot({ id: 'a', text: '甲', model: {} });
  board.addChild('a', { id: 'b', text: '乙', model: {} });
  board.addChild('b', { id: 'c', text: '丙', model: {} });
  assert.equal(board.count(), 3);
  const removed = board.remove('b');
  assert.equal(removed, 2, 'b 与 c 一起删');
  assert.equal(board.count(), 1);
  assert.equal(board.edgePath('b', 'c'), '');
});

test('画布：折叠只影响高度，不删节点', () => {
  const { doc } = createFakeDom();
  const board = createTreeBoard({ doc });
  board.mount();
  board.openRoot({ id: 'a', text: '甲', model: {} });
  board.toggleCollapse('a');
  const node = board.nodes.find((item) => item.id === 'a');
  assert.equal(node.collapsed, true);
  assert.equal(board.count(), 1);
});

test('画布不掺和同领域标色：只留 data-domain，也没有阅读区 API', () => {
  const { doc } = createFakeDom();
  const board = createTreeBoard({ doc });
  board.mount();
  board.openRoot({ id: 'a', text: '暴击', model: { lead: '伤害翻倍', domain: '游戏' } });

  const root = doc.getElementById('knest-board');
  const node = root.querySelector('.knest-tnode');
  assert.equal(node.getAttribute('data-domain'), '游戏', '领域信息仍留在节点上');
  assert.equal(node.getAttribute('data-mark'), null, '画布不再上橙色标记');
  assert.equal(root.querySelector('.knest-reader'), null, '阅读区已移除');
  assert.equal(typeof board.openReader, 'undefined', 'openReader 已移除');
  assert.equal(typeof board.pickSelection, 'undefined', 'pickSelection 已移除');
});

test('同句去重：同一段文字不会长出第二个节点', () => {
  const { doc } = createFakeDom();
  const board = createTreeBoard({ doc });
  board.mount();
  board.openRoot({ id: 'a', text: '扩展能力', model: { lead: 'x' } });

  /* 换个 id 再开同一个词：应当复用，不新增 */
  const again = board.openRoot({ id: 'b', text: '扩展能力', model: { lead: 'y' } });
  assert.equal(again.id, 'a');
  assert.equal(board.count(), 1);

  board.addChild('a', { id: 'c', text: '扩展能力', model: { lead: 'z' } });
  assert.equal(board.count(), 1, '子节点同名也复用');
  assert.equal(board.findByText('扩展能力').id, 'a');
  assert.equal(board.findByText('不存在的词'), null);
});

test('缩放：zoomBy 被夹在 40%~220%，view() 能读回倍率', () => {
  const { doc } = createFakeDom();
  const board = createTreeBoard({ doc });
  board.mount();
  board.openRoot({ id: 'a', text: '甲', model: {} });
  assert.equal(board.view().scale, 1);

  board.zoomBy(2);
  assert.ok(board.view().scale > 1 && board.view().scale <= 2.2, String(board.view().scale));

  board.zoomBy(100);
  assert.equal(board.view().scale, 2.2, '上限 220%');

  board.zoomBy(0.001);
  assert.equal(board.view().scale, 0.4, '下限 40%');

  board.zoomTo(1);
  assert.equal(board.view().scale, 1);
});

test('挂载即隐藏：没节点之前画布和 HUD 都不该露面', () => {
  const { doc } = createFakeDom();
  const board = createTreeBoard({ doc });
  board.mount();
  const root = doc.getElementById('knest-board');
  assert.equal(root.getAttribute('data-open'), 'false', '挂载时必须是隐藏态');

  board.openRoot({ id: 'a', text: '甲', model: {} });
  assert.equal(root.getAttribute('data-open'), 'true', '有节点才露面');

  board.clear();
  assert.equal(root.getAttribute('data-open'), 'false', '清空后重新藏起来');
});

test('snapshot / restore：位置、父子、折叠都还原，刷新不丢图', () => {
  const { doc } = createFakeDom();
  const a = createTreeBoard({ doc });
  a.mount();
  a.openRoot({ id: 'r', text: '根', model: { lead: 'x' } });
  a.addChild('r', { id: 'c', text: '子', model: { lead: 'y' } });
  a.move('c', 120, 240);
  a.toggleCollapse('c');

  const snap = a.snapshot();
  assert.equal(snap.nodes.length, 2);
  assert.equal(snap.nodes.find((n) => n.id === 'c').x, 120);

  const b = createTreeBoard({ doc });
  b.mount();
  const restored = b.restore(snap);
  assert.equal(restored, 2, '两个节点都回来了');
  const child = b.nodes.find((n) => n.id === 'c');
  assert.equal(child.x, 120);
  assert.equal(child.collapsed, true);
  assert.equal(child.parentId, 'r');
});
