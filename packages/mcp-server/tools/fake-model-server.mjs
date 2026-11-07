/**
 * 假的 OpenAI 兼容端点：给 Inspector / 手工联调用，不联网、不花钱。
 *
 * 用法：
 *   node tools/fake-model-server.mjs --port 8787
 *   OPENAI_BASE_URL=http://127.0.0.1:8787/v1 OPENAI_API_KEY=sk-x OPENAI_MODEL=fake \
 *   npx @modelcontextprotocol/inspector --cli node src/index.js --method tools/call ...
 */
import { createServer } from 'node:http';

const args = process.argv.slice(2);
const portIndex = args.indexOf('--port');
const port = portIndex >= 0 ? Number(args[portIndex + 1]) : 8787;

const CARD = {
  here: '在这段对话里指整体推翻重做。',
  kind: '动作',
  literal: '把原有的东西全部推翻。',
  confidence: 'high',
  readings: [{ label: '整体重构', note: '保留行为重写结构' }],
  evidence: [{ quote: '全部重做', why: '呼应上下文' }],
  links: [],
};

const server = createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    const payload = {
      choices: [{ message: { content: JSON.stringify(CARD) } }],
      usage: { prompt_tokens: 520, completion_tokens: 210, total_tokens: 730, prompt_cache_hit_tokens: 0 },
    };
    const text = JSON.stringify(payload);
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
    res.end(text);
    console.error(`[fake-model] ${req.method} ${req.url} -> 200`);
  });
});

server.listen(port, '127.0.0.1', () => {
  console.error(`[fake-model] listening on http://127.0.0.1:${port}/v1`);
});
