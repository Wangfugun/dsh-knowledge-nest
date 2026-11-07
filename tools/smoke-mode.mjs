/**
 * 变体模式冒烟：同一个词，分别用「换个说法 / 举个例子 / 翻译」问一次，看输出是否还对得上 schema。
 * 用法：node tools/smoke-mode.mjs
 */
import { createExplainer } from '../lib/explain.js';
import { buildContext } from '../client/transcript.js';

const messages = [
  { id: 'u1', role: 'you', text: '我想把这个项目推倒重来，用户可以鼠标右键按住，圈住一个词或者一句话' },
  { id: 'a1', role: 'ai', text: '明白了。现在是左键选区加弹出百科，改成右键拖选以后要处理 contextmenu 被宿主吞掉的问题。' },
  { id: 'u2', role: 'you', text: '然后 AI 就会根据上下文对用户的词进行解释，这个词或者这句话在这一整个对话里是什么意思' },
  { id: 'a2', role: 'ai', text: '那解释要按语境来写：先说它在这段对话里指什么，再给依据，最后才是通用含义。' },
];

const phrase = '推倒重来';
const { context, fingerprint } = buildContext(messages, { phrase });
const explainer = createExplainer({});

for (const mode of ['rephrase', 'example', 'translate']) {
  try {
    const result = await explainer.explain({ phrase, context, fingerprint, mode });
    const usage = result.usage ?? {};
    console.log(`\n=== ${mode} (${usage.total ?? 0} token) ===`);
    console.log(result.data.here);
    console.log(`evidence=${result.data.evidence.length} links=${result.data.links.length} conf=${result.data.confidence}`);
  } catch (error) {
    console.log(`\n=== ${mode} 失败：${error.message}`);
  }
}
