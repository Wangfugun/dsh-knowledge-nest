/**
 * 真机冒烟：用真的 key、真的 DeepSeek 接口跑一次解释，再跑一次看缓存。
 * 用法：node tools/smoke-explain.mjs
 */
import { createExplainer } from '../lib/explain.js';
import { buildContext } from '../client/transcript.js';
import { buildCard } from '../client/card.js';

const messages = [
  { id: 'u1', role: 'you', text: '我想把这个项目推倒重来，用户可以鼠标右键按住，圈住一个词或者一句话，圈住的句子和词会变成绿色' },
  { id: 'a1', role: 'ai', text: '明白了。现在是左键选区加弹出百科，改成右键拖选以后要处理 contextmenu 被宿主吞掉的问题，绿色高亮也不能改宿主 DOM。' },
  { id: 'u2', role: 'you', text: '然后 AI 就会根据上下文对用户的词进行解释，这个词或者这句话在这一整个对话里是什么意思' },
  { id: 'a2', role: 'ai', text: '那解释要按语境来写：先说它在这段对话里指什么，再给依据，最后才是通用含义。流程图和气泡也一起重做。' },
];

const phrase = '推倒重来';
const { context, fingerprint } = buildContext(messages, { phrase });
const explainer = createExplainer({});

console.log('== status ==');
console.log(JSON.stringify(explainer.status(), null, 1));

console.log('\n== first call ==');
const t0 = Date.now();
const first = await explainer.explain({ phrase, context, fingerprint, sentence: messages[0].text });
console.log(`cached=${first.cached} model=${first.model} ms=${Date.now() - t0}`);
console.log(JSON.stringify(first.data, null, 1));

console.log('\n== second call (should hit cache, no network) ==');
const second = await explainer.explain({ phrase, context, fingerprint });
console.log(`cached=${second.cached} ms=${second.ms}`);

console.log('\n== card as the browser would render it ==');
console.log(JSON.stringify(buildCard({ phrase, data: first.data, count: 2, model: first.model, cached: first.cached, ms: first.ms }), null, 1));
