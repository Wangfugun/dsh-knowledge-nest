/**
 * 本地推理：预设、无钥匙放行、超时可调。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveModel, isLocalEndpoint, LOCAL_PRESETS } from '../src/model.js';

test('KNEST_PROVIDER=ollama：端点与钥匙都能自动补齐', () => {
  const r = resolveModel({ KNEST_PROVIDER: 'ollama', OPENAI_MODEL: 'qwen2.5:7b' });
  assert.equal(r.baseUrl, LOCAL_PRESETS.ollama.baseUrl);
  assert.equal(r.apiKey, 'ollama');
  assert.equal(r.model, 'qwen2.5:7b');
  assert.equal(r.source, 'env-openai');
});

test('只给本地地址、不给钥匙：仍然可用', () => {
  const r = resolveModel({ OPENAI_BASE_URL: 'http://127.0.0.1:11434/v1', OPENAI_MODEL: 'qwen2.5:7b' });
  assert.equal(r.apiKey, 'local');
  assert.equal(r.source, 'env-openai');
  assert.equal(r.model, 'qwen2.5:7b');
});

test('远程地址没钥匙：照旧判为未配置', () => {
  const r = resolveModel({ OPENAI_BASE_URL: 'https://api.example.com/v1', OPENAI_MODEL: 'x' });
  assert.equal(r.source, 'none');
  assert.equal(r.apiKey, '');
});

test('isLocalEndpoint 认得本机形态', () => {
  assert.equal(isLocalEndpoint('http://127.0.0.1:11434/v1'), true);
  assert.equal(isLocalEndpoint('http://localhost:1234/v1'), true);
  assert.equal(isLocalEndpoint('https://api.deepseek.com'), false);
});

test('超时与 token 可以用环境变量调', () => {
  const r = resolveModel({ KNEST_PROVIDER: 'ollama', OPENAI_MODEL: 'm', KNEST_TIMEOUT_MS: '120000', KNEST_MAX_TOKENS: '900' });
  assert.equal(r.timeoutMs, 120000);
  assert.equal(r.maxTokens, 900);
});
