/**
 * stdio 端到端：真的把 `src/index.js` 当一个 MCP 子进程拉起来，
 * 走 initialize → tools/list → tools/call 全链路。
 *
 * 模型接口用**本地假 HTTP 服务**顶替（127.0.0.1 随机端口），所以这条用例离线可跑、
 * 不花钱，也不会因为网络波动假红。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(HERE, '..', 'src', 'index.js');

const CARD = {
  here: '在这段对话里指整体推翻重做。',
  kind: '动作',
  literal: '把原有的东西全部推翻。',
  confidence: 'high',
  readings: [],
  evidence: [{ quote: '全部重做', why: '呼应上下文' }],
  links: [],
};

/**
 * 起一个假的 OpenAI 兼容端点。
 * @returns {Promise<{url:string, close:Function, requests:object[]}>} 句柄。
 */
function startFakeModel() {
  const requests = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        requests.push({ url: req.url, body: JSON.parse(body) });
      } catch {
        requests.push({ url: req.url, body: null });
      }
      const payload = {
        choices: [{ message: { content: JSON.stringify(CARD) } }],
        usage: { prompt_tokens: 500, completion_tokens: 200, total_tokens: 700, prompt_cache_hit_tokens: 0 },
      };
      const text = JSON.stringify(payload);
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
      res.end(text);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}/v1`,
        requests,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

/**
 * 拉起 MCP 子进程。
 * @param {object} env - 额外环境变量。
 * @returns {object} 句柄。
 */
function startServer(env) {
  const child = spawn(process.execPath, [ENTRY], {
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const pending = new Map();
  let buffer = '';
  let nextId = 1;
  const stderr = [];

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let index = buffer.indexOf('\n');
    while (index >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line !== '') {
        try {
          const message = JSON.parse(line);
          if (message.id !== undefined && pending.has(message.id)) {
            pending.get(message.id)(message);
            pending.delete(message.id);
          }
        } catch {
          /* 忽略非 JSON 行 */
        }
      }
      index = buffer.indexOf('\n');
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => stderr.push(String(chunk)));

  const send = (method, params) => new Promise((resolve, reject) => {
    const id = nextId;
    nextId += 1;
    const timer = setTimeout(() => reject(new Error(`等待 ${method} 超时；stderr=${stderr.join('')}`)), 20_000);
    pending.set(id, (message) => {
      clearTimeout(timer);
      resolve(message);
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });

  const notify = (method, params) => {
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  };

  return { child, send, notify, stderr };
}

test('stdio 全链路：initialize → tools/list → tools/call', async () => {
  const model = await startFakeModel();
  const home = mkdtempSync(join(tmpdir(), 'knest-mcp-stdio-'));
  const server = startServer({
    KNEST_HOME: home,
    OPENAI_API_KEY: 'sk-test-abcdef123456',
    OPENAI_BASE_URL: model.url,
    OPENAI_MODEL: 'test-model',
  });

  try {
    const init = await server.send('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'knest-test', version: '0.0.0' },
    });
    assert.equal(init.result.serverInfo.name, 'knowledge-nest');
    server.notify('notifications/initialized', {});

    const list = await server.send('tools/list', {});
    const tool = list.result.tools.find((item) => item.name === 'knowledge_nest_explain');
    assert.ok(tool !== undefined, 'tools/list 必须包含 knowledge_nest_explain');
    assert.ok(Object.keys(tool.inputSchema.properties).includes('text'));
    assert.ok(Object.keys(tool.inputSchema.properties).includes('context'));
    assert.ok(Object.keys(tool.inputSchema.properties).includes('mode'));

    const call = await server.send('tools/call', {
      name: 'knowledge_nest_explain',
      arguments: { text: '推倒重来', context: '你：我想把这个项目推倒重来\n答：好，全部重做。', mode: 'explain' },
    });
    assert.equal(call.result.isError, undefined, 'in-band 失败不走协议错误');
    assert.equal(call.result.structuredContent.ok, true);
    assert.equal(call.result.structuredContent.card.lead, CARD.here);

    assert.equal(model.requests.length, 1);
    assert.equal(model.requests[0].url, '/v1/chat/completions');
    assert.equal(model.requests[0].body.model, 'test-model');

    const missing = await server.send('tools/call', {
      name: 'knowledge_nest_explain',
      arguments: { text: '   ' },
    });
    assert.equal(missing.result.structuredContent.ok, false);
    assert.equal(missing.result.structuredContent.code, 'bad-request');
  } finally {
    server.child.kill();
    await model.close();
  }
});

test('stdio：没配 key 时 tools/call 返回 no-key，而不是崩', async () => {
  const home = mkdtempSync(join(tmpdir(), 'knest-mcp-nokey-'));
  const server = startServer({ KNEST_HOME: home, DEEPSEEK_API_KEY: '', OPENAI_API_KEY: '' });
  try {
    await server.send('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'knest-test', version: '0.0.0' },
    });
    server.notify('notifications/initialized', {});

    const call = await server.send('tools/call', {
      name: 'knowledge_nest_explain',
      arguments: { text: '推倒重来' },
    });
    assert.equal(call.result.structuredContent.ok, false);
    assert.equal(call.result.structuredContent.code, 'no-key');
  } finally {
    server.child.kill();
  }
});
