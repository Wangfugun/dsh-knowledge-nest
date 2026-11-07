/**
 * 工具层单测：入参校验、出参形状、错误码、缓存与备用模型。
 *
 * 这些用例是从 DSH 插件的 `test/host.test.mjs` 搬过来的，只是把断言对象从
 * 「HTTP 路由 + JSON body」换成了「MCP tool 的入参与出参」。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createExplainer } from '../../../lib/explain.js';
import { createGate } from '../../../lib/gate.js';
import { createModelProvider, maskKey, resolveModel, configPath, knestHome } from '../src/model.js';
import { runExplainTool, countOccurrences, MODE_VALUES, TOOL_NAME } from '../src/explain-tool.js';
import { precheckModel, SERVER_NAME } from '../src/server.js';

/** 造一个临时 home 目录。 */
function makeHome(files = {}) {
  const home = mkdtempSync(join(tmpdir(), 'knest-mcp-'));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(home, name), content, 'utf8');
  }
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

/** 成功响应。 */
const okResponse = (payload = {
  here: '在这段对话里指整体推翻重做。',
  kind: '动作',
  literal: '把原有的东西全部推翻。',
  confidence: 'high',
  readings: [{ label: '整体重构', note: '保留行为重写结构' }],
  evidence: [{ quote: '全部重做', why: '呼应上下文' }],
  links: [{ label: '重构', note: '重写实现', children: [{ label: '重写', note: '丢弃旧实现' }] }],
}) => ({
  ok: true,
  status: 200,
  json: async () => ({ choices: [{ message: { content: JSON.stringify(payload) } }], usage: { prompt_tokens: 600, completion_tokens: 240, total_tokens: 840, prompt_cache_hit_tokens: 0 } }),
  text: async () => '',
});

/**
 * 造一个解释器（真编排 + 假网络）。
 * @param {{env?:object, transport?:Function}} [options] - 注入。
 * @returns {{explainer:object, cache:object, calls:object[]}} 句柄。
 */
function makeExplainer(options = {}) {
  const env = options.env ?? { KNEST_HOME: makeHome(), DEEPSEEK_API_KEY: 'sk-test-abcdef123456' };
  const calls = [];
  const transport = options.transport ?? (async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    return okResponse();
  });
  const cache = memoryCache();
  const explainer = createExplainer({
    env,
    provider: createModelProvider(env),
    transport,
    cache,
    gate: createGate({ maxActive: 2, minGapMs: 0 }),
  });
  return { explainer, cache, calls, env };
}

test('工具契约：名字与 mode 取值', () => {
  assert.equal(TOOL_NAME, 'knowledge_nest_explain');
  assert.deepEqual([...MODE_VALUES], ['explain', 'rephrase', 'example', 'translate']);
  assert.equal(SERVER_NAME, 'knowledge-nest');
});

test('happy path：返回 {ok:true, card} 且卡片字段齐全', async () => {
  const { explainer } = makeExplainer();
  const result = await runExplainTool(explainer, {
    text: '推倒重来',
    context: '你：我想把这个项目推倒重来\n答：好的，全部重做。',
  });
  assert.equal(result.ok, true);
  assert.equal(result.card.phrase, '推倒重来');
  assert.equal(result.card.lead, '在这段对话里指整体推翻重做。');
  assert.equal(result.card.mode, 'explain');
  assert.equal(result.card.evidence.length, 1);
  assert.equal(result.card.tree.length, 1);
  assert.equal(result.card.confidence.tone, 'high');
  assert.equal(result.card.meta.count, 1, 'countOccurrences 应数到 1 次');
  assert.equal(result.card.meta.usage.total, 840);
});

test('入参校验：空 text / 非法 mode 都在返回值里表达', async () => {
  const { explainer } = makeExplainer();
  const empty = await runExplainTool(explainer, { text: '   ' });
  assert.deepEqual(empty, { ok: false, code: 'bad-request', message: 'text 不能为空' });

  const badMode = await runExplainTool(explainer, { text: '推倒重来', mode: 'summarize' });
  assert.equal(badMode.ok, false);
  assert.equal(badMode.code, 'bad-mode');

  const noInput = await runExplainTool(explainer, undefined);
  assert.equal(noInput.code, 'bad-request');
});

test('缓存：同词同上下文第二次命中，不再出网', async () => {
  const { explainer, calls } = makeExplainer();
  const input = { text: '推倒重来', context: '你：推倒重来\n答：好' };
  const first = await runExplainTool(explainer, input);
  const second = await runExplainTool(explainer, input);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(second.card.meta.cached, true);
});

test('模式：translate 会换掉任务指令；不同模式各缓存一份', async () => {
  const { explainer, calls } = makeExplainer();
  await runExplainTool(explainer, { text: '推倒重来', context: 'x', mode: 'translate' });
  const body = calls[0].body;
  const userMessage = body.messages[1].content;
  assert.ok(userMessage.includes('这次只做翻译'), '应带上翻译任务指令');
  assert.equal(body.response_format.type, 'json_object');

  const again = await runExplainTool(explainer, { text: '推倒重来', context: 'x', mode: 'explain' });
  assert.equal(again.card.meta.cached, false, '换模式不应命中上一模式的缓存');
});

test('错误码：429 → rate-limited，401 → unauthorized，超时 → timeout', async () => {
  const limited = makeExplainer({
    transport: async () => ({ ok: false, status: 429, text: async () => 'slow down', json: async () => ({}) }),
  });
  const r1 = await runExplainTool(limited.explainer, { text: '词', context: '' });
  assert.equal(r1.ok, false);
  assert.equal(r1.code, 'rate-limited');

  const denied = makeExplainer({
    transport: async () => ({ ok: false, status: 401, text: async () => 'bad key', json: async () => ({}) }),
  });
  const r2 = await runExplainTool(denied.explainer, { text: '词', context: '' });
  assert.equal(r2.code, 'unauthorized');

  const timeout = makeExplainer({
    transport: async () => {
      throw new Error('The operation was aborted due to timeout');
    },
  });
  const r3 = await runExplainTool(timeout.explainer, { text: '词', context: '' });
  assert.equal(r3.code, 'timeout');
});

test('模型名不被认 → 自动退到备用模型', async () => {
  /* key / base / model 全放配置文件：三元组来自同一层，才能稳定复现这条路径 */
  const home = makeHome({
    'config.json': JSON.stringify({
      apiKey: 'sk-config-abcdef123456',
      baseUrl: 'https://api.deepseek.com',
      model: 'not-a-model',
      fallbackModel: 'deepseek-v4-pro',
    }),
  });
  const env = { KNEST_HOME: home };
  const seen = [];
  const { explainer } = makeExplainer({
    env,
    transport: async (url, init) => {
      const model = JSON.parse(init.body).model;
      seen.push(model);
      if (seen.length === 1) {
        return { ok: false, status: 400, text: async () => '{"error":{"message":"Model Not Exist"}}', json: async () => ({}) };
      }
      return okResponse({ here: '备用模型给的答案' });
    },
  });
  const result = await runExplainTool(explainer, { text: '推倒重来', context: '' });
  assert.equal(result.ok, true);
  assert.equal(result.card.lead, '备用模型给的答案');
  assert.deepEqual(seen, ['not-a-model', 'deepseek-v4-pro']);
});

test('模型吐非 JSON → 降级成纯文本卡，仍返回 ok:true', async () => {
  const { explainer } = makeExplainer({
    transport: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: '这段对话里它指的是整体推翻重做。' } }] }),
      text: async () => '',
    }),
  });
  const result = await runExplainTool(explainer, { text: '推倒重来', context: '' });
  assert.equal(result.ok, true);
  assert.equal(result.card.confidence.tone, 'low');
  assert.match(result.card.lead, /整体推翻重做/u);
});

test('前置自检：缺 key / 缺 baseUrl / 缺模型名各给各的码', async () => {
  const empty = { KNEST_HOME: makeHome() };
  assert.equal(precheckModel(empty).code, 'no-key');

  const noModel = { KNEST_HOME: makeHome(), OPENAI_API_KEY: 'sk-openai-123456', OPENAI_BASE_URL: 'https://example.invalid/v1' };
  assert.equal(precheckModel(noModel).code, 'no-model');

  const ready = { KNEST_HOME: makeHome(), DEEPSEEK_API_KEY: 'sk-test-abcdef123456' };
  assert.equal(precheckModel(ready), null);

  const { explainer } = makeExplainer({ env: empty });
  const blocked = await runExplainTool(explainer, { text: '词' }, { precheck: () => precheckModel(empty) });
  assert.equal(blocked.code, 'no-key');
});

test('model.js：环境变量优先于配置文件，baseUrl/模型名默认值正确', () => {
  const home = makeHome({
    'config.json': JSON.stringify({ apiKey: 'sk-file-key', baseUrl: 'https://file.example/v1', model: 'file-model' }),
  });
  assert.equal(knestHome({ KNEST_HOME: home }), home);
  assert.ok(configPath({ KNEST_HOME: home }).endsWith('config.json'));

  const fromFile = resolveModel({ KNEST_HOME: home });
  assert.equal(fromFile.source, 'config');
  assert.equal(fromFile.baseUrl, 'https://file.example/v1');
  assert.equal(fromFile.model, 'file-model');

  const fromEnv = resolveModel({ KNEST_HOME: home, DEEPSEEK_API_KEY: 'sk-env-key' });
  assert.equal(fromEnv.source, 'env-deepseek');
  assert.equal(fromEnv.baseUrl, 'https://api.deepseek.com');
  assert.equal(fromEnv.model, 'deepseek-flash');
  assert.equal(fromEnv.fallbackModel, 'deepseek-v4-pro');

  const fromOpenai = resolveModel({
    KNEST_HOME: home,
    OPENAI_API_KEY: 'sk-openai-key',
    OPENAI_BASE_URL: 'https://openrouter.example/v1/',
    OPENAI_MODEL: 'some-model',
  });
  assert.equal(fromOpenai.source, 'env-openai');
  assert.equal(fromOpenai.baseUrl, 'https://openrouter.example/v1');
  assert.equal(fromOpenai.model, 'some-model');

  assert.equal(maskKey(''), '');
  assert.ok(maskKey('sk-abcdefghijkl').startsWith('sk-abc'));
});

test('countOccurrences：空词与重复计数', () => {
  assert.equal(countOccurrences('', 'abc'), 0);
  assert.equal(countOccurrences('词', ''), 0);
  assert.equal(countOccurrences('推倒', '推倒重来，再推倒一次'), 2);
});
