/**
 * 模型探针：确认 key 能用、模型名、JSON 输出是否听话、延迟多少。
 * 用法：node tools/smoke-model.mjs
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const readKey = () => {
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY.trim();
  const home = process.env.DSH_HOME || join(homedir(), '.dsh');
  const raw = readFileSync(join(home, '.credentials.yaml'), 'utf8');
  const match = raw.match(/DEEPSEEK_API_KEY:\s*(\S+)/u);
  return match ? match[1].trim() : '';
};

const key = readKey();
if (!key) {
  console.log('no key');
  process.exit(1);
}

const system = [
  '你是一个“对话语境释义器”。用户会圈出某段对话里的一个词或一句话，问它在这段对话里是什么意思。',
  '只输出一个 JSON 对象，不要 markdown、不要解释你的做法。字段如下：',
  '{"here":"在这段对话里它指什么（1-2 句）","literal":"脱离语境时的通常含义（1 句）",',
  '"readings":[{"label":"一种可能读法","note":"为什么这么读"}],',
  '"evidence":[{"quote":"对话里的原话片段","why":"它说明什么"}],',
  '"links":[{"label":"相关概念","note":"一句话","children":[{"label":"更细的概念","note":"一句话"}]}],',
  '"confidence":"high|medium|low"}',
  '规则：evidence.quote 必须是用户给的对话里**逐字出现**的片段；读不准就把 confidence 放低并给出 readings；中文回答；here 不超过 120 字。',
].join('\n');

const context = [
  '【对话】',
  '你：我想把这个项目推倒重来，用户可以鼠标右键按住，圈住一个词或者一句话',
  '回答：明白了。你现在的实现是左键选区加弹出百科，改成右键拖选以后要处理 contextmenu 被宿主吞掉的问题。',
  '你：那个流程图和气泡也太烂了，全部重做',
  '回答：流程图我建议改成「会话竖轴 + 节点」，气泡则按「语境释义优先、百科其次」重排。',
].join('\n');

const user = [
  context,
  '',
  '【圈出的文本】推倒重来',
  '',
  '【它所在的那句话】我想把这个项目推倒重来，用户可以鼠标右键按住，圈住一个词或者一句话',
  '',
  '问：这个圈出的文本，在这一整段对话里是什么意思？',
].join('\n');

for (const model of ['deepseek-flash', 'deepseek-v4-pro']) {
  const t0 = Date.now();
  try {
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.2,
        max_tokens: 800,
        response_format: { type: 'json_object' },
        thinking: { type: 'disabled' },
      }),
      signal: AbortSignal.timeout(60000),
    });
    const text = await res.text();
    const ms = Date.now() - t0;
    if (!res.ok) {
      console.log(`\n=== ${model} FAILED ${res.status} (${ms}ms) ===\n${text.slice(0, 400)}`);
      continue;
    }
    const body = JSON.parse(text);
    const content = body?.choices?.[0]?.message?.content ?? '';
    console.log(`\n=== ${model} ok ${ms}ms usage=${JSON.stringify(body.usage)} ===`);
    console.log(content.slice(0, 1200));
  } catch (error) {
    console.log(`\n=== ${model} THROW ${Date.now() - t0}ms ===\n${String(error && error.message)}`);
  }
}
