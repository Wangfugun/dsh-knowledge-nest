/**
 * 把豆包网页版包装成一个 OpenAI 兼容接口。
 *
 * 为什么要这一层：词林的解释链路（提示词、JSON 收敛、缓存、并发闸门）都在 `lib/explain.js` 里，
 * 它只会往 `baseUrl/chat/completions` 发 OpenAI 格式的请求。与其改那条核心链路，
 * 不如在本地起一个假接口，把请求转给豆包，再把结果转回来——零改动复用全部逻辑。
 *
 * 用法：
 *   node tools/web-provider.mjs           默认 127.0.0.1:7333
 *   node tools/web-provider.mjs --port=7400 --cdp=9335
 *
 * 前提：浏览器开着 doubao.com 且已登录。
 */
import { createServer } from 'node:http';

import { askDoubao, probeDoubao, DEFAULT_CDP_PORT } from './doubao.js';

/** 默认监听端口。 */
export const DEFAULT_PORT = 7333;

/** 假装自己是个模型名。 */
export const MODEL_ID = 'doubao-web';

/**
 * 把 OpenAI 的 messages 拼成一段给豆包的文本。
 *
 * 豆包网页版是单轮对话，没有 system/assistant 的概念，
 * 所以把 system 放最前、user 放后面，用换行分隔。
 *
 * @param {Array<{role:string, content:string}>} messages - OpenAI 消息数组。
 * @returns {string} 拼好的文本。
 */
export function flattenMessages(messages) {
  if (!Array.isArray(messages)) return '';
  const system = [];
  const rest = [];
  for (const item of messages) {
    const role = typeof item?.role === 'string' ? item.role : 'user';
    const content = typeof item?.content === 'string'
      ? item.content
      : Array.isArray(item?.content)
        ? item.content.map((part) => (typeof part?.text === 'string' ? part.text : '')).join('')
        : '';
    if (content.trim() === '') continue;
    if (role === 'system') system.push(content.trim());
    else rest.push(content.trim());
  }
  return [...system, ...rest].join('\n\n');
}

/**
 * 读请求体。
 * @param {import('node:http').IncomingMessage} req - 请求。
 * @param {number} [limit] - 上限。
 * @returns {Promise<string>} 文本。
 */
function readBody(req, limit = 512 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('请求体太大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * 起一个 OpenAI 兼容服务，把请求转给豆包。
 *
 * @param {{port?:number, cdpPort?:number, timeoutMs?:number, onLog?:Function}} [options] - 配置。
 * @returns {Promise<{port:number, url:string, close:Function, state:Function}>} 句柄。
 */
export async function startWebProvider(options = {}) {
  const port = Number(options.port ?? DEFAULT_PORT);
  const cdpPort = Number(options.cdpPort ?? DEFAULT_CDP_PORT);
  const timeoutMs = Number(options.timeoutMs ?? 90_000);
  const onLog = typeof options.onLog === 'function' ? options.onLog : () => {};

  let lastError = '';
  let calls = 0;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const path = url.pathname.replace(/\/{2,}/gu, '/').replace(/\/$/u, '') || '/';

    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type, authorization',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'cache-control': 'no-store',
    };

    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors);
      res.end();
      return;
    }

    const sendJson = (status, payload) => {
      const body = JSON.stringify(payload);
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...cors });
      res.end(body);
    };

    /* 列表：客户端有时会先探这个 */
    if (req.method === 'GET' && (path === '/v1/models' || path === '/models')) {
      sendJson(200, {
        object: 'list',
        data: [{ id: MODEL_ID, object: 'model', owned_by: 'doubao-web' }],
      });
      return;
    }

    /* 健康检查 */
    if (req.method === 'GET' && (path === '/' || path === '/health')) {
      const status = await probeDoubao({ port: cdpPort });
      sendJson(200, {
        ok: status.ok,
        model: MODEL_ID,
        cdpPort,
        calls,
        lastError,
        message: status.message,
      });
      return;
    }

    if (req.method !== 'POST' || !/\/chat\/completions$/u.test(path)) {
      sendJson(404, { error: { message: '只支持 POST /v1/chat/completions', type: 'not_found' } });
      return;
    }

    let payload = {};
    try {
      const raw = await readBody(req);
      payload = raw.trim() === '' ? {} : JSON.parse(raw.replace(/^\uFEFF/u, ''));
    } catch (error) {
      sendJson(400, { error: { message: `请求体解析失败：${String(error?.message ?? error).slice(0, 120)}`, type: 'bad_request' } });
      return;
    }

    const prompt = flattenMessages(payload.messages);
    if (prompt === '') {
      sendJson(400, { error: { message: 'messages 是空的', type: 'bad_request' } });
      return;
    }

    const started = Date.now();
    const answer = await askDoubao({ prompt, port: cdpPort, timeoutMs });
    calls += 1;

    if (answer.ok !== true) {
      lastError = `${answer.code}: ${answer.message ?? ''}`.slice(0, 200);
      onLog(`失败 ${lastError}`);
      sendJson(502, {
        error: {
          message: `豆包没给出回答（${answer.code}）：${answer.message ?? ''}`,
          type: 'upstream_error',
          code: answer.code,
        },
      });
      return;
    }

    const ms = Date.now() - started;
    const promptTokens = Math.ceil(prompt.length / 3);
    const completionTokens = Math.ceil(String(answer.text).length / 3);
    onLog(`成功 ${ms}ms，${completionTokens} token`);

    sendJson(200, {
      id: `chatcmpl-doubao-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: typeof payload.model === 'string' && payload.model !== '' ? payload.model : MODEL_ID,
      choices: [{
        index: 0,
        message: { role: 'assistant', content: answer.text },
        finish_reason: 'stop',
      }],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
      },
    });
  });

  const ok = await new Promise((resolve) => {
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => resolve(true));
  });
  if (!ok) return null;

  return {
    port,
    url: `http://127.0.0.1:${port}/v1`,
    close: () => new Promise((resolve) => server.close(() => resolve(true))),
    state: () => ({ calls, lastError, cdpPort }),
  };
}
