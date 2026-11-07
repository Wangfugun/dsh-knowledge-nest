/**
 * 路由与编排：真 HTTP 形状、真错误码、真缓存行为。
 * 用假 transport，不出网、不花钱。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createExplainer } from '../lib/explain.js';
import { createGate } from '../lib/gate.js';
import { createRouteHandler, EXPLAIN_PATH, name, inject } from '../index.js';
import { CONFIG_FILE } from '../lib/key.js';

/** 带钥匙的临时家目录。 */
function makeHome() {
  const home = mkdtempSync(join(tmpdir(), 'knest-route-'));
  writeFileSync(join(home, '.credentials.yaml'), 'version: 1\nrefs:\n  DEEPSEEK_API_KEY: sk-test-abcdef123456\n', 'utf8');
  return home;
}

/** 内存缓存替身。 */
function memoryCache() {
  const map = new Map();
  return {
    map,
    get: (key) => map.get(key) ?? null,
    set: (key, value) => {
      map.set(key, value);
      return true;
    },
    stats: () => ({ entries: map.size, hits: 0, misses: 0, writes: map.size, format: 1, file: 'mem' }),
    clear: () => {
      map.clear();
      return true;
    },
  };
}

/** 造解释器。 */
function makeExplainer({ transport, home = makeHome(), cache = memoryCache() }) {
  return createExplainer({
    home,
    env: {},
    transport,
    cache,
    gate: createGate({ maxActive: 2, minGapMs: 0 }),
  });
}

/** 成功的模型响应。 */
const okResponse = (payload = { here: '在这里指重做', kind: '动作', confidence: 'high', evidence: [{ quote: '全部重做', why: '呼应' }] }) => ({
  ok: true,
  status: 200,
  json: async () => ({ choices: [{ message: { content: JSON.stringify(payload) } }] }),
  text: async () => '',
});

/** 假请求。 */
function makeReq({ method = 'GET', body = null, headers = {} } = {}) {
  const handlers = {};
  const req = {
    method,
    headers: { host: '127.0.0.1:50517', ...headers },
    socket: { remoteAddress: '127.0.0.1' },
    on(event, callback) {
      handlers[event] = handlers[event] ?? [];
      handlers[event].push(callback);
      return req;
    },
    destroy() {},
  };
  setImmediate(() => {
    if (body !== null) for (const callback of handlers.data ?? []) callback(Buffer.from(body));
    for (const callback of handlers.end ?? []) callback();
  });
  return req;
}

/** 假响应。 */
function makeRes() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    writeHead(status, headers) {
      this.statusCode = status;
      this.headers = headers ?? {};
    },
    end(chunk) {
      this.body = chunk ?? '';
    },
  };
}

const body = JSON.stringify({
  phrase: '推倒重来',
  sentence: '我想把这个项目推倒重来',
  context: '你：我想把这个项目推倒重来\n答：好',
  fingerprint: 'fp1',
});

test('POST：一次成功、二次命中缓存', async () => {
  let calls = 0;
  const explainer = makeExplainer({
    transport: async () => {
      calls += 1;
      return okResponse();
    },
  });
  const handler = createRouteHandler({ explainer });

  const first = makeRes();
  await handler(makeReq({ method: 'POST', body }), first);
  assert.equal(first.statusCode, 200);
  const parsed = JSON.parse(first.body);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.here, '在这里指重做');
  assert.equal(parsed.cached, false);

  const second = makeRes();
  await handler(makeReq({ method: 'POST', body }), second);
  assert.equal(JSON.parse(second.body).cached, true);
  assert.equal(calls, 1, '第二次不该再出网');
});

test('POST：没钥匙 → 503 且错误码可读', async () => {
  const home = mkdtempSync(join(tmpdir(), 'knest-empty-'));
  const explainer = makeExplainer({ home, transport: async () => okResponse() });
  const res = makeRes();
  await createRouteHandler({ explainer })(makeReq({ method: 'POST', body }), res);
  assert.equal(res.statusCode, 503);
  assert.equal(JSON.parse(res.body).error.code, 'no-key');
});

test('POST：429 → 429，且不写缓存', async () => {
  const cache = memoryCache();
  const explainer = makeExplainer({
    cache,
    transport: async () => ({ ok: false, status: 429, text: async () => 'slow down', json: async () => ({}) }),
  });
  const res = makeRes();
  await createRouteHandler({ explainer })(makeReq({ method: 'POST', body }), res);
  assert.equal(res.statusCode, 429);
  assert.equal(JSON.parse(res.body).error.code, 'rate-limited');
  assert.equal(cache.map.size, 0);
});

test('POST：模型名不认 → 自动退到备用模型', async () => {
  const seen = [];
  const explainer = makeExplainer({
    transport: async (url, init) => {
      const model = JSON.parse(init.body).model;
      seen.push(model);
      if (seen.length === 1) {
        return { ok: false, status: 400, text: async () => '{"error":{"message":"Model Not Exist"}}', json: async () => ({}) };
      }
      return okResponse({ here: '备用模型给的答案' });
    },
  });
  const res = makeRes();
  await createRouteHandler({ explainer })(makeReq({ method: 'POST', body }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).data.here, '备用模型给的答案');
  assert.deepEqual(seen, ['deepseek-flash', 'deepseek-v4-pro']);
});

test('POST：模型吐了非 JSON → 降级成一张纯文本卡，而不是报错', async () => {
  const explainer = makeExplainer({
    transport: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: '这段对话里它指的是整体推翻重做。' } }] }),
      text: async () => '',
    }),
  });
  const res = makeRes();
  await createRouteHandler({ explainer })(makeReq({ method: 'POST', body }), res);
  assert.equal(res.statusCode, 200);
  const parsed = JSON.parse(res.body);
  assert.equal(parsed.data.confidence, 'low');
  assert.match(parsed.data.here, /整体推翻重做/u);
});

test('路由：GET 状态 / DELETE 清缓存 / 405 / 403 / 400', async () => {
  const explainer = makeExplainer({ transport: async () => okResponse() });
  const handler = createRouteHandler({ explainer });

  const status = makeRes();
  await handler(makeReq({ method: 'GET' }), status);
  assert.equal(status.statusCode, 200);
  const parsedStatus = JSON.parse(status.body);
  assert.equal(parsedStatus.ok, true);
  assert.equal(parsedStatus.status.keyConfigured, true);
  assert.equal(parsedStatus.status.keyFingerprint.startsWith('sk-tes'), true);

  const cleared = makeRes();
  await handler(makeReq({ method: 'DELETE' }), cleared);
  assert.equal(JSON.parse(cleared.body).cleared, true);

  const wrong = makeRes();
  await handler(makeReq({ method: 'PUT' }), wrong);
  assert.equal(wrong.statusCode, 405);

  const cross = makeRes();
  await handler(makeReq({ method: 'GET', headers: { origin: 'https://evil.example' } }), cross);
  assert.equal(cross.statusCode, 403);

  const bad = makeRes();
  await handler(makeReq({ method: 'POST', body: '{不是 json' }), bad);
  assert.equal(bad.statusCode, 400);
  assert.equal(JSON.parse(bad.body).error.code, 'bad-json');
});

test('路由：空词 400，超长 400', async () => {
  const explainer = makeExplainer({ transport: async () => okResponse() });
  const handler = createRouteHandler({ explainer });
  const empty = makeRes();
  await handler(makeReq({ method: 'POST', body: JSON.stringify({ phrase: '  ' }) }), empty);
  assert.equal(empty.statusCode, 400);

  const long = makeRes();
  await handler(makeReq({ method: 'POST', body: JSON.stringify({ phrase: 'x'.repeat(400) }) }), long);
  assert.equal(long.statusCode, 400);
});

test('路由：插件契约（名字、注入、路径）', () => {
  assert.equal(name, 'dsh-knowledge-nest');
  assert.deepEqual(inject, ['webServer', 'fs'], '文件读取通道需要宿主 fs 服务');
  assert.equal(EXPLAIN_PATH, '/knowledge-nest/explain');
});

test('explain：配置里 enabled:false 直接拒绝', async () => {
  const home = makeHome();
  mkdirSync(join(home, 'knowledge-nest'), { recursive: true });
  writeFileSync(join(home, CONFIG_FILE), JSON.stringify({ enabled: false }), 'utf8');
  const explainer = makeExplainer({ home, transport: async () => okResponse() });
  await assert.rejects(
    () => explainer.explain({ phrase: '推倒重来', context: 'x' }),
    (error) => error.code === 'disabled',
  );
});

test('explain：超时翻成 timeout 错误码', async () => {
  const explainer = makeExplainer({
    transport: async () => {
      throw new Error('The operation was aborted due to timeout');
    },
  });
  await assert.rejects(
    () => explainer.explain({ phrase: '推倒重来', context: 'x' }),
    (error) => error.code === 'timeout' && error.retryable === true,
  );
});
