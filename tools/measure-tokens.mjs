/**
 * 量 token：同一段对话，按三个档位各问一次，打印 usage，看钱花在哪。
 * 用法：node tools/measure-tokens.mjs
 */
import { createExplainer } from '../lib/explain.js';
import { buildContext } from '../client/transcript.js';

const filler = '这一段是为了把上下文撑到真实长度：我们在讨论圈词插件的交互、流程图、亮暗主题、缓存与闸门，还有为什么 token 会变多。';
const messages = [];
for (let index = 0; index < 14; index += 1) {
  messages.push({
    id: `m${index}`,
    role: index % 2 === 0 ? 'you' : 'ai',
    text: filler.repeat(Math.ceil(320 / filler.length)).slice(0, 320),
  });
}
messages[6].text = `我要说的是推倒重来这件事：${messages[6].text.slice(0, 200)}`;

const phrase = '推倒重来';
const explainer = createExplainer({});

for (const depth of ['compact', 'standard', 'deep']) {
  const { context, fingerprint } = buildContext(messages, { phrase, depth });
  const t0 = Date.now();
  const result = await explainer.explain({ phrase, context, fingerprint: `${depth}-${Date.now()}` });
  const usage = result.usage ?? {};
  console.log(
    `${depth.padEnd(9)} context=${String(context.length).padStart(4)} 字  ` +
    `prompt=${String(usage.prompt).padStart(5)}  completion=${String(usage.completion).padStart(4)}  ` +
    `total=${String(usage.total).padStart(5)}  cached=${String(usage.cached).padStart(4)}  ${Date.now() - t0}ms`,
  );
}
