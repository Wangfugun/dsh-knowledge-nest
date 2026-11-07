/**
 * 文件读取路由：只读、只读文本、只读工作区内。
 *
 * 四个闸口各自一条用例：正常读取、越权（403）、非法后缀（415）、超限（413）。
 * fs 全是 mock——这里验的是**路由的行为**，不是宿主的文件系统。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  READ_PATH,
  MAX_FILE_BYTES,
  TEXT_EXTENSIONS,
  hasTraversal,
  extensionOf,
  collectText,
  workspaceRootOf,
  createReadHandler,
  inject,
} from '../index.js';

/** 造一个能跑 handler 的假 req/res。 */
function callRoute(handler, { method = 'GET', url = '/', headers = {} } = {}) {
  const req = { method, url, headers };
  return new Promise((resolve) => {
    const res = {
      status: 0,
      headers: {},
      body: '',
      writeHead(status, extra) {
        this.status = status;
        this.headers = extra ?? {};
        return this;
      },
      end(payload) {
        this.body = String(payload ?? '');
        let json = null;
        try {
          json = JSON.parse(this.body);
        } catch {
          json = null;
        }
        resolve({ status: this.status, json, headers: this.headers, raw: this.body });
      },
    };
    Promise.resolve(handler(req, res)).catch((error) => resolve({ status: -1, error }));
  });
}

/** 假 fs：默认一切正常，可逐项覆盖。 */
function fakeFs(overrides = {}) {
  return {
    resolve: async (path) => `/workspace/${String(path).replace(/^\/+/u, '')}`,
    contains: async () => true,
    stat: async () => ({ type: 'file', size: 20 }),
    streamText: async () => 'const answer = 42;\n',
    ...overrides,
  };
}

const ROOT = '/workspace';

test('路由常量与注入声明', () => {
  assert.equal(READ_PATH, '/knowledge-nest/read');
  assert.equal(MAX_FILE_BYTES, 1024 * 1024);
  assert.deepEqual(inject, ['webServer', 'fs']);
  assert.equal(TEXT_EXTENSIONS.has('.md'), true);
  assert.equal(TEXT_EXTENSIONS.has('.exe'), false);
});

test('读取成功：返回 {ok:true, text}', async () => {
  const handler = createReadHandler({ fs: fakeFs(), workspaceRoot: ROOT });
  const out = await callRoute(handler, { url: '/knowledge-nest/read?path=src%2Findex.js' });
  assert.equal(out.status, 200);
  assert.equal(out.json.ok, true);
  assert.equal(out.json.text, 'const answer = 42;\n');
  assert.equal(out.json.extension, '.js');
  assert.ok(out.json.bytes > 0);
});

test('越权：路径里有 .. → 403', async () => {
  const handler = createReadHandler({ fs: fakeFs(), workspaceRoot: ROOT });
  const out = await callRoute(handler, { url: '/knowledge-nest/read?path=..%2F..%2Fetc%2Fpasswd.md' });
  assert.equal(out.status, 403);
  assert.equal(out.json.error.code, 'forbidden');
});

test('越权：解析后不在工作区内 → 403', async () => {
  const handler = createReadHandler({
    fs: fakeFs({
      resolve: async () => '/elsewhere/notes.md',
      contains: async () => false,
    }),
    workspaceRoot: ROOT,
  });
  const out = await callRoute(handler, { url: '/knowledge-nest/read?path=notes.md' });
  assert.equal(out.status, 403);
  assert.equal(out.json.error.code, 'forbidden');
});

test('后缀不在白名单：.exe → 415', async () => {
  const handler = createReadHandler({ fs: fakeFs(), workspaceRoot: ROOT });
  const out = await callRoute(handler, { url: '/knowledge-nest/read?path=tools%2Frun.exe' });
  assert.equal(out.status, 415);
  assert.equal(out.json.error.code, 'unsupported-type');
});

test('大小超限：2MB 流 → 413', async () => {
  const twoMb = 'x'.repeat(2 * 1024 * 1024);
  const handler = createReadHandler({
    fs: fakeFs({
      stat: async () => ({ type: 'file', size: twoMb.length }),
      streamText: async () => twoMb,
    }),
    workspaceRoot: ROOT,
  });
  const out = await callRoute(handler, { url: '/knowledge-nest/read?path=big.md' });
  assert.equal(out.status, 413);
  assert.equal(out.json.error.code, 'too-large');
});

test('大小超限：stat 小但流很长（边读边超）也算 413', async () => {
  const chunk = 'y'.repeat(64 * 1024);
  async function* stream() {
    for (let index = 0; index < 40; index += 1) yield chunk;
  }
  const handler = createReadHandler({
    fs: fakeFs({ streamText: async () => stream() }),
    workspaceRoot: ROOT,
  });
  const out = await callRoute(handler, { url: '/knowledge-nest/read?path=grow.md' });
  assert.equal(out.status, 413);
  assert.equal(out.json.error.code, 'too-large');
});

test('缺参数 / 非 GET / 目录', async () => {
  const handler = createReadHandler({ fs: fakeFs(), workspaceRoot: ROOT });
  const missing = await callRoute(handler, { url: '/knowledge-nest/read' });
  assert.equal(missing.status, 400);

  const post = await callRoute(handler, { method: 'POST', url: '/knowledge-nest/read?path=a.md' });
  assert.equal(post.status, 405);

  /* 目录本身没后缀，会先被 415 挡掉；带后缀但其实是目录才走到 400 */
  const noExt = await callRoute(handler, { url: '/knowledge-nest/read?path=docs' });
  assert.equal(noExt.status, 415);

  const dir = createReadHandler({ fs: fakeFs({ stat: async () => ({ type: 'directory' }) }), workspaceRoot: ROOT });
  const isDir = await callRoute(dir, { url: '/knowledge-nest/read?path=docs%2FREADME.md' });
  assert.equal(isDir.status, 400);
});

test('hasTraversal / extensionOf / workspaceRootOf', () => {
  assert.equal(hasTraversal('a/../b.md'), true);
  assert.equal(hasTraversal('a\\..\\b.md'), true);
  assert.equal(hasTraversal('a/..b/c.md'), false);
  assert.equal(hasTraversal('docs/readme.md'), false);

  assert.equal(extensionOf('src/a.TS'), '.ts');
  assert.equal(extensionOf('Makefile'), '');
  assert.equal(extensionOf('dir.with.dot/file'), '');

  assert.equal(workspaceRootOf({ get: () => ({ root: '/ws' }) }), '/ws');
  assert.equal(typeof workspaceRootOf({}), 'string');
});

test('collectText：字符串 / 异步迭代 / {text} 都认', async () => {
  assert.deepEqual(await collectText('abc'), { text: 'abc', bytes: 3 });
  assert.equal((await collectText({ text: 'hey' })).text, 'hey');

  async function* gen() {
    yield 'ab';
    yield Buffer.from('cd');
  }
  assert.equal((await collectText(gen())).text, 'abcd');

  await assert.rejects(() => collectText('x'.repeat(MAX_FILE_BYTES + 1)), /上限/u);
});

test('严格代理：访问未注入的服务不会把注册流程打断（回归）', () => {
  const strict = {
    get(name) { if (name === 'workspace') throw new Error('service not found'); return undefined; },
    get workspace() { throw new Error('Cannot access workspace before injection'); },
  };
  let root = '';
  assert.doesNotThrow(() => { root = workspaceRootOf(strict); });
  assert.equal(typeof root, 'string');
  assert.notEqual(root, '');
});
