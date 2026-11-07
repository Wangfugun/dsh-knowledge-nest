/**
 * 菜单文案的代码/文本判定。
 *
 * 左栏阅读区已经拿掉（改用 DSH 自带的阅读区），这里只剩这一条纯函数：
 * 选区里有换行 / 分号 / 括号 / 赋值号 → 菜单第一项叫「解释这段代码」。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { isCodeLike } from '../client/view.js';

test('isCodeLike：有换行/分号/括号算代码，纯中文句子算文本', () => {
  assert.equal(isCodeLike('const a = 1;'), true);
  assert.equal(isCodeLike('foo(bar)'), true);
  assert.equal(isCodeLike('第一行\n第二行'), true);
  assert.equal(isCodeLike('if (x) { y }'), true);
  assert.equal(isCodeLike('a = b'), true);
  assert.equal(isCodeLike('这段代码在做什么'), false);
  assert.equal(isCodeLike('推倒重来'), false);
  assert.equal(isCodeLike(''), false);
  assert.equal(isCodeLike(null), false);
});
