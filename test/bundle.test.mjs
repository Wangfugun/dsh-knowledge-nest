/**
 * 包壳与契约：client.js 必须是刚刚生成的、不能带模块语法、必须带齐接线。
 * 旧的实现里"改了 client/*.js 忘了 build"是最常见的一类线上事故。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

import { build } from '../tools/build-client.mjs';
import { KNEST_CSS, KNEST_STYLE_REV } from '../client/styles.js';
import { VIEW_OPTIONS, viewInjected, SETTINGS_SECTION } from '../client/view.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const bundle = readFileSync(join(ROOT, 'client.js'), 'utf8');

test('client.js 与源文件同步（忘了 build 就会红）', () => {
  assert.equal(bundle, build());
});

test('bundle 是 classic script：没有模块语法', () => {
  assert.equal(/^import\s/mu.test(bundle), false);
  assert.equal(/^export\s/mu.test(bundle), false);
  assert.equal(bundle.includes('__ModuleLoader__.load'), true);
  assert.equal(bundle.includes("id: 'dsh-knowledge-nest'"), true);
  assert.equal(bundle.includes('createPlugin({ h, React })'), true);
});

test('样式：版本号在、暗亮两套令牌都在、动效有降级', () => {
  assert.equal(KNEST_STYLE_REV, 'r2');
  assert.ok(KNEST_CSS.includes('data-knest-theme="dark"'));
  assert.ok(KNEST_CSS.includes('data-knest-theme="light"'));
  assert.ok(KNEST_CSS.includes('::highlight(knest-echo)'));
  assert.ok(KNEST_CSS.includes('prefers-reduced-motion'));
  assert.ok(KNEST_CSS.includes('--kn-echo'));
  assert.ok(KNEST_CSS.indexOf('.knest-tnode{') >= 0, '画布节点样式必须在');
});

test('槽位契约：conversation.view 必须带 inject', () => {
  assert.equal(VIEW_OPTIONS.name, 'conversation.view');
  assert.equal(VIEW_OPTIONS.id, 'knowledge');
  assert.equal(VIEW_OPTIONS.label, '知识库');
  assert.deepEqual(viewInjected('s1'), { sessionId: 's1' });
  assert.deepEqual(viewInjected(undefined), { sessionId: '' });
  assert.equal(SETTINGS_SECTION.name, 'settings.section');
  assert.equal(SETTINGS_SECTION.id, 'knowledge-nest');
});

test('bundle 里必须有的接线都在', () => {
  for (const needle of [
    'attachSelector',
    'createPainter',
    'CSS.highlights',
    'knest-echo',
    'buildContext',
    'layoutMap',
    'createTreeBoard',
    'knest-tnode',
    'knest-board',
    'explain',
  ]) {
    assert.ok(bundle.includes(needle), `bundle 里缺少 ${needle}`);
  }
});
