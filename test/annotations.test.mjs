/**
 * 批注：标记块拼接（宿主侧）+ 批注器行为（浏览器侧）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { MARK_START, MARK_END, renderEntry, renderBlock, spliceBlock, writeAnnotations } from '../lib/annotations.js';
import { createAnnotator } from '../client/annotate.js';
import { createFakeDom } from '../tools/fake-dom.mjs';

test('renderEntry / renderBlock：一条批注一行，空集合不生成块', () => {
  assert.equal(renderEntry({ phrase: '前端太烂', note: '前端需重做' }), '- 「前端太烂」 → 改为「前端需重做」');
  assert.equal(renderEntry({ phrase: '这行', note: '' }), '- 「这行」 → （标记删除）');
  assert.equal(renderEntry({}), '');

  const block = renderBlock({ entries: [{ phrase: 'a', note: 'b' }], window: 'user' });
  assert.ok(block.startsWith(MARK_START));
  assert.ok(block.endsWith(MARK_END));
  assert.ok(block.includes('上一次用户消息'));

  assert.equal(renderBlock({ entries: [] }), '');
});

test('spliceBlock：替换旧块、保留其它内容、空块则整段删除', () => {
  const original = `# 我的说明\n\n${MARK_START}\n旧内容\n${MARK_END}\n\n尾部段落\n`;
  const replaced = spliceBlock(original, `${MARK_START}\n新内容\n${MARK_END}`);
  assert.ok(replaced.includes('我的说明'));
  assert.ok(replaced.includes('尾部段落'));
  assert.ok(replaced.includes('新内容'));
  assert.equal(replaced.includes('旧内容'), false);

  const removed = spliceBlock(original, '');
  assert.equal(removed.includes(MARK_START), false);
  assert.ok(removed.includes('我的说明'));
});

test('writeAnnotations：dryRun 不落盘，真写要留备份', () => {
  const dir = mkdtempSync(join(tmpdir(), 'knest-ann-'));
  const file = join(dir, 'AGENTS.local.md');
  writeFileSync(file, '# 原有内容\n', 'utf8');

  const dry = writeAnnotations({ workspaceRoot: dir, entries: [{ phrase: 'x', note: 'y' }], dryRun: true });
  assert.equal(dry.ok, true);
  assert.equal(readFileSync(file, 'utf8'), '# 原有内容\n', 'dryRun 不能改文件');

  const real = writeAnnotations({ workspaceRoot: dir, entries: [{ phrase: 'x', note: 'y' }] });
  assert.equal(real.written, true);
  const text = readFileSync(file, 'utf8');
  assert.ok(text.includes('# 原有内容'));
  assert.ok(text.includes('- 「x」 → 改为「y」'));
  assert.equal(existsSync(`${file}.knest.bak`), true, '写之前要备份');

  const cleared = writeAnnotations({ workspaceRoot: dir, entries: [] });
  assert.equal(cleared.removed, true);
  assert.equal(readFileSync(file, 'utf8').includes(MARK_START), false);
});

test('annotator：加/改/删/按时间取区间，支持无 Highlight 的降级', () => {
  const { doc } = createFakeDom();
  const store = new Map();
  const win = {
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
  };
  const changed = [];
  const annotator = createAnnotator({ doc, win, onchange: (list) => changed.push(list.length) });

  assert.equal(annotator.supported, false, '没有 CSS.highlights 时降级');
  assert.equal(annotator.isOn(), false);
  assert.equal(annotator.setMode(true), true);
  assert.equal(annotator.isOn(), true);

  const note = annotator.add({ phrase: '前端设计太烂了', rect: { left: 10, top: 100, width: 180 } });
  assert.ok(note !== null);
  assert.equal(annotator.list().length, 1);

  annotator.update(note.id, '改成：视觉需重做');
  assert.equal(annotator.list()[0].note, '改成：视觉需重做');
  assert.ok(changed.length >= 2, '每次改动都要通知宿主');

  assert.equal(annotator.since(Date.now() + 10_000).length, 0, '未来时间点之前没有批注');
  assert.equal(annotator.since(0).length, 1);

  annotator.remove(note.id);
  assert.equal(annotator.list().length, 0);
});

test('annotator：同一句话在同一处重复拖，不会长出新气泡', () => {
  const { doc } = createFakeDom();
  const win = { localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } };
  const annotator = createAnnotator({ doc, win });
  const rect = { left: 100, top: 200, width: 120 };
  const first = annotator.add({ phrase: '前端太烂了', rect });
  const again = annotator.add({ phrase: '前端太烂了', rect });
  assert.equal(annotator.list().length, 1, '同词同位置只留一条');
  assert.equal(again.id, first.id, '返回的是原来那条');

  const other = annotator.add({ phrase: '另一句', rect });
  assert.equal(annotator.list().length, 2);
  annotator.remove(other.id);
  assert.equal(annotator.list().length, 1);
});

test('annotator：发消息后把旧批注标为已提交（淡出），新的仍算未提交', () => {
  const { doc } = createFakeDom();
  const win = { localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } };
  const annotator = createAnnotator({ doc, win });

  annotator.add({ phrase: '旧句', rect: { left: 10, top: 10, width: 60 } });
  const marked = annotator.submitAll(Date.now() + 5);
  assert.equal(marked, 1);
  assert.equal(annotator.pending().length, 0, '全部已提交');

  annotator.add({ phrase: '新句', rect: { left: 10, top: 400, width: 60 } });
  assert.equal(annotator.pending().length, 1, '新加的还没提交');
  assert.equal(annotator.lists ?? true, true);
});
