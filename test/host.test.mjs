/**
 * Host 侧：钥匙解析、磁盘缓存、闸门、模型输出收敛、提示词。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveKey, readConfig, readCredentialKey, maskKey, dshHome, CONFIG_FILE } from '../lib/key.js';
import { createCache, CACHE_FORMAT } from '../lib/cache.js';
import { createGate } from '../lib/gate.js';
import { parseModelJson, shapeExplanation, fallbackExplanation, LIMITS } from '../lib/shape.js';
import { buildMessages, buildBody, clampContext, SYSTEM_PROMPT } from '../lib/prompt.js';
import { cacheKeyOf } from '../lib/explain.js';

/** 造一个临时 DSH 家目录。 */
function makeHome(mutate) {
  const home = mkdtempSync(join(tmpdir(), 'knest-'));
  mutate?.(home);
  return home;
}

test('resolveKey：配置文件 > 环境变量 > 凭据文件', () => {
  const home = makeHome((dir) => {
    writeFileSync(join(dir, '.credentials.yaml'), 'version: 1\nrefs:\n  DEEPSEEK_API_KEY: sk-credential-123456\n', 'utf8');
  });
  assert.equal(resolveKey({ home, env: {} }).source, 'credentials');

  assert.equal(resolveKey({ home, env: { DEEPSEEK_API_KEY: 'sk-from-env-1234567' } }).source, 'env');

  mkdirSync(join(home, 'knowledge-nest'), { recursive: true });
  writeFileSync(join(home, CONFIG_FILE), JSON.stringify({ apiKey: 'sk-from-config-12345' }), 'utf8');
  const resolved = resolveKey({ home, env: { DEEPSEEK_API_KEY: 'sk-from-env-1234567' } });
  assert.equal(resolved.source, 'config');
  assert.equal(resolved.key, 'sk-from-config-12345');
});

test('resolveKey：什么都没有就是 none', () => {
  const home = makeHome();
  assert.deepEqual(resolveKey({ home, env: {} }), { key: '', source: 'none' });
  assert.equal(readCredentialKey(home), null);
  assert.equal(maskKey(''), '');
});

test('maskKey：只露头尾', () => {
  const masked = maskKey('sk-abcdefghijklmn');
  assert.ok(masked.startsWith('sk-abc'));
  assert.equal(masked.includes('defghijkl'), false);
});

test('readConfig：坏值回默认，enabled:false 认', () => {
  const home = makeHome();
  assert.equal(readConfig(home).model, 'deepseek-flash');
  assert.equal(readConfig(home).enabled, true);
  mkdirSync(join(home, 'knowledge-nest'), { recursive: true });
  writeFileSync(join(home, CONFIG_FILE), JSON.stringify({ enabled: false, model: '  ', maxTokens: 99999, timeoutMs: 'x', baseUrl: 'https://api.deepseek.com/' }), 'utf8');
  const config = readConfig(home);
  assert.equal(config.enabled, false);
  assert.equal(config.model, 'deepseek-flash');
  assert.equal(config.maxTokens, 4000);
  assert.equal(config.timeoutMs, 45000);
  assert.equal(config.baseUrl, 'https://api.deepseek.com');
});

test('cache：命中、过期、坏文件、版本不符', () => {
  const home = makeHome();
  const file = join(home, 'cache.json');
  let clock = 1000;
  const cache = createCache({ file, ttlMs: 100, now: () => clock });
  assert.equal(cache.get('k'), null);
  assert.equal(cache.set('k', { data: { here: 'x' } }), true);
  assert.deepEqual(cache.get('k').data, { here: 'x' });
  clock += 200;
  assert.equal(cache.get('k'), null, '过期即视为没有');
  assert.equal(cache.stats().misses >= 2, true);

  writeFileSync(file, '{不是 json', 'utf8');
  const broken = createCache({ file });
  assert.equal(broken.get('k'), null);

  writeFileSync(file, JSON.stringify({ version: CACHE_FORMAT + 1, entries: { k: { at: Date.now(), value: { a: 1 } } } }), 'utf8');
  assert.equal(createCache({ file }).get('k'), null, '版本不符整份作废');

  const good = createCache({ file });
  good.set('k2', { a: 1 });
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(raw.version, CACHE_FORMAT);
});

test('gate：并发上限 3、同 key 单飞', async () => {
  const gate = createGate({ maxActive: 3, minGapMs: 0 });
  let running = 0;
  let peak = 0;
  const task = () => new Promise((resolve) => {
    running += 1;
    peak = Math.max(peak, running);
    setTimeout(() => {
      running -= 1;
      resolve('ok');
    }, 12);
  });
  const results = await Promise.all([0, 1, 2, 3, 4].map((index) => gate.run(`k${index}`, task)));
  assert.deepEqual(results, ['ok', 'ok', 'ok', 'ok', 'ok']);
  assert.equal(peak, 3);
  assert.ok(gate.stats().peakActive <= 3);

  let calls = 0;
  const shared = () => {
    calls += 1;
    return new Promise((resolve) => setTimeout(() => resolve('same'), 15));
  };
  const [a, b] = await Promise.all([gate.run('dup', shared), gate.run('dup', shared)]);
  assert.equal(a, 'same');
  assert.equal(b, 'same');
  assert.equal(calls, 1, '同 key 只应真正跑一次');
});

test('parseModelJson：围栏、前后缀、坏 JSON', () => {
  assert.deepEqual(parseModelJson('{"a":1}'), { a: 1 });
  assert.deepEqual(parseModelJson('```json\n{"a":2}\n```'), { a: 2 });
  assert.deepEqual(parseModelJson('前面一句 {"a":3} 后面一句'), { a: 3 });
  assert.equal(parseModelJson('不是 JSON'), null);
  assert.equal(parseModelJson('[1,2]'), null);
  assert.equal(parseModelJson(''), null);
});

test('shapeExplanation：削长度、丢坏项、兜底 kind/confidence', () => {
  const shaped = shapeExplanation({
    here: '在这里指重做',
    kind: '不认识的类型',
    confidence: 'HIGH',
    readings: [{ label: 'a', note: 'b' }],
    evidence: [{ quote: '原话', why: 'why' }],
    links: [{ label: 'x', children: [{ label: 'y' }] }],
  });
  assert.equal(shaped.kind, '其它');
  assert.equal(shaped.confidence, 'high');
  assert.equal(shaped.evidence[0].quote, '原话');
  assert.equal(shaped.links[0].children.length, 1);
  assert.equal(shapeExplanation({}), null);
  assert.equal(shapeExplanation({ literal: '没有 here' }), null);

  const long = shapeExplanation({ here: 'x'.repeat(500) });
  assert.ok(long.here.length <= LIMITS.here);

  assert.equal(fallbackExplanation(''), null);
  assert.equal(fallbackExplanation('一段没有结构的话').here.length > 0, true);
});

test('prompt：system 里有 schema，用户消息里有原文', () => {
  assert.ok(SYSTEM_PROMPT.includes('"here"'));
  assert.ok(SYSTEM_PROMPT.includes('逐字'));
  const messages = buildMessages({ phrase: '推倒重来', sentence: '我想推倒重来', context: '你：推倒重来' });
  assert.equal(messages.length, 2);
  assert.equal(messages[1].role, 'user');
  assert.ok(messages[1].content.includes('推倒重来'));
  assert.ok(messages[1].content.includes('它所在的那句话'));

  const body = buildBody({ model: 'deepseek-flash', messages, maxTokens: 500 });
  assert.equal(body.model, 'deepseek-flash');
  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.deepEqual(body.thinking, { type: 'disabled' });
  assert.equal(buildBody({ model: 'glm-4', messages }).thinking, undefined);
});

test('clampContext：超预算时保头保尾', () => {
  const text = `HEAD${'中'.repeat(9000)}TAIL`;
  const clipped = clampContext(text, 1000);
  assert.ok(clipped.startsWith('HEAD'));
  assert.ok(clipped.endsWith('TAIL'));
  assert.ok(clipped.includes('中间省略'));
  assert.ok(clipped.length <= 1000);
  assert.equal(clampContext('短文本'), '短文本');
});

test('cacheKeyOf：词与指纹都参与', () => {
  assert.equal(cacheKeyOf('a', 'b'), cacheKeyOf('a', 'b'));
  assert.notEqual(cacheKeyOf('a', 'b'), cacheKeyOf('a', 'c'));
  assert.notEqual(cacheKeyOf('a', 'b'), cacheKeyOf('b', 'a'));
});

test('dshHome：优先环境变量', () => {
  assert.equal(dshHome({ DSH_HOME: 'C:\\tmp\\dsh' }), 'C:\\tmp\\dsh');
  assert.ok(dshHome({}).endsWith('.dsh'));
});

test('domain：原样保留，超长截到 10 字以内，缺失给空串', () => {
  const ok = shapeExplanation({ here: '这是一句解释', domain: '游戏' });
  assert.equal(ok.domain, '游戏');

  const long = shapeExplanation({ here: '这是一句解释', domain: '一二三四五六七八九十十一十二' });
  assert.ok(long.domain.length <= 10, 'domain 长度必须 ≤ 10');
  assert.ok(long.domain.endsWith('…'), '截断要带省略号');

  const none = shapeExplanation({ here: '这是一句解释' });
  assert.equal(none.domain, '');
});
