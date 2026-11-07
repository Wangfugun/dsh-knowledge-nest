/**
 * 检查模型端点是否可用（本地推理优先）。
 *
 * 用法：
 *   node tools/check-model.mjs                 # 读当前环境变量 / ~/.knest/config.json
 *   KNEST_PROVIDER=ollama OPENAI_MODEL=qwen2.5:7b node tools/check-model.mjs
 *
 * 它只做两件事：能不能连上、模型能不能吐出一段 JSON。不写入任何东西。
 */
import { resolveModel, maskKey } from '../src/model.js';

const model = resolveModel(process.env);

console.log('端点    ', model.baseUrl || '(未配置)');
console.log('模型    ', model.model || '(未配置)');
console.log('钥匙    ', model.apiKey === '' ? '(无)' : maskKey(model.apiKey));
console.log('来源    ', model.source);
console.log('超时    ', model.timeoutMs + 'ms');
console.log('');

if (model.baseUrl === '' || model.model === '') {
  console.error('端点或模型名缺失，先设 KNEST_PROVIDER=ollama 或 OPENAI_BASE_URL/OPENAI_MODEL。');
  process.exit(1);
}

/* 1. 列模型：Ollama 与 LM Studio 都支持 /v1/models */
try {
  const res = await fetch(`${model.baseUrl}/models`, {
    headers: model.apiKey === '' ? {} : { authorization: `Bearer ${model.apiKey}` },
    signal: AbortSignal.timeout(Math.min(model.timeoutMs, 15_000)),
  });
  if (res.ok) {
    const body = await res.json();
    const names = Array.isArray(body?.data) ? body.data.map((item) => item.id).slice(0, 8) : [];
    console.log('可用模型', names.length === 0 ? '(端点没列出模型)' : names.join(', '));
  } else {
    console.log('列模型   HTTP', res.status, '(不一定致命，有的端点不开放这个接口)');
  }
} catch (error) {
  console.error('连不上端点：', String(error?.message ?? error));
  console.error('本地推理的话，先确认 Ollama / LM Studio 已经在跑。');
  process.exit(1);
}

/* 2. 发一次最小请求，验证真的能出话 */
const started = Date.now();
try {
  const res = await fetch(`${model.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(model.apiKey === '' ? {} : { authorization: `Bearer ${model.apiKey}` }),
    },
    body: JSON.stringify({
      model: model.model,
      messages: [
        { role: 'system', content: '只输出 JSON，形如 {"ok":true,"word":"收到了"}。' },
        { role: 'user', content: '回一句确认。' },
      ],
      max_tokens: 60,
      stream: false,
    }),
    signal: AbortSignal.timeout(model.timeoutMs),
  });
  const text = await res.text();
  console.log('');
  console.log('耗时    ', Date.now() - started, 'ms');
  console.log('状态    ', res.status);
  console.log('返回    ', text.slice(0, 300));
  if (!res.ok) process.exit(1);
  console.log('');
  console.log('可以用了。');
} catch (error) {
  console.error('调用失败：', String(error?.message ?? error));
  process.exit(1);
}
