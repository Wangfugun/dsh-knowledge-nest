/**
 * 独立版的解释服务：给注入到别的客户端里的「词林」提供 POST /explain。
 *
 * 用法：
 *   node tools/serve-standalone.mjs            # 监听 127.0.0.1:7331
 *   PORT=7400 node tools/serve-standalone.mjs
 *
 * 钥匙来源与插件一致：环境变量 → 配置文件 → ~/.dsh/.credentials.yaml。
 * 想用本地免费模型，就设 KNEST_PROVIDER / OPENAI_BASE_URL + OPENAI_MODEL。
 */
import { createServer } from 'node:http';

import { createExplainer } from '../lib/explain.js';
import { buildBody, SYSTEM_PROMPT } from '../lib/prompt.js';
import { shapeExplanation } from '../lib/shape.js';

const PORT = Number(process.env.PORT ?? 7331);
const HOST = process.env.HOST ?? '127.0.0.1';
const MAX_BODY = 128 * 1024;

const explainer = createExplainer({});

/**
 * 读请求体。
 * @param {import('node:http').IncomingMessage} req - 请求。
 * @returns {Promise<string>} 文本。
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
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
 * 回 JSON。
 * @param {import('node:http').ServerResponse} res - 响应。
 * @param {number} status - 状态码。
 * @param {object} payload - 载荷。
 * @returns {void}
 */
function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'POST, OPTIONS',
  });
  res.end(body);
}

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }
  if (req.method === 'GET') {
    sendJson(res, 200, { ok: true, status: explainer.status(), promptBytes: Buffer.byteLength(SYSTEM_PROMPT) });
    return;
  }
  if (req.method !== 'POST' || !req.url?.startsWith('/explain')) {
    sendJson(res, 404, { ok: false, error: { code: 'not-found', message: '只支持 POST /explain' } });
    return;
  }

  try {
    const raw = await readBody(req);
    const body = raw.trim() === '' ? {} : JSON.parse(raw);
    const result = await explainer.explain({
      phrase: body?.phrase,
      sentence: body?.sentence ?? '',
      context: body?.context ?? '',
      fingerprint: body?.fingerprint ?? '',
      mode: body?.mode ?? 'default',
      model: body?.model ?? '',
      force: body?.force === true,
    });
    sendJson(res, 200, {
      ok: true,
      data: result.data,
      cached: result.cached === true,
      model: result.model,
      ms: result.ms,
      usage: result.usage,
    });
  } catch (error) {
    const code = typeof error?.code === 'string' ? error.code : 'internal';
    const message = typeof error?.message === 'string' ? error.message : String(error);
    sendJson(res, 502, { ok: false, error: { code, message } });
  }
});

server.listen(PORT, HOST, () => {
  const status = explainer.status();
  console.log(`词林独立服务  http://${HOST}:${PORT}`);
  console.log(`模型        ${status.model}  (key ${status.keyConfigured ? '已配置' : '未配置'})`);
  console.log(`用法        POST /explain  { phrase, context, mode }`);
});
