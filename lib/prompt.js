/**
 * 提示词：把"这段对话 + 圈出来的字"压成一次尽量小、尽量稳的请求。
 *
 * 三条经验（真跑过、也真花过钱）：
 *  1. **schema 写进 system**，并明确"只输出 JSON"——DeepSeek 会老实照做；
 *  2. **evidence.quote 必须逐字来自对话**：不这么要求，模型就会编一句"原话"，
 *     而那正是这个功能唯一不能出错的地方；这一段不能省；
 *  3. **上下文按字算钱**（中文约 1 字 1 token）：4000 字上下文 ≈ 2400 prompt token，
 *     实测一次圈词能到 3000+ token。所以默认只给"命中那条消息 ±1 条、每条 180 字"。
 */

/** 上下文允许的最大字符数（兜底上限；真实预算见 client/transcript.js 的 DEPTHS）。 */
export const CONTEXT_BUDGET = 4000;

/** 圈出文本的上限。 */
export const PHRASE_LIMIT = 200;

/**
 * 追加任务：同一个 schema，换一种活儿干。
 *
 * 为什么不做第二套 schema：前端只有一条渲染路径（here / evidence / links 那几段），
 * 换 schema 等于让卡片分叉。变体只改「here 里写什么」，其余字段允许留空。
 */
export const MODES = Object.freeze({
  default: { label: '', task: '' },
  rephrase: {
    label: '换个说法',
    task: '这次不要辨析词义：用大白话把它的意思重讲一遍，假设读者完全不懂这个领域；here 放这段大白话（≤120 字），literal 留空，links 最多 2 条。',
  },
  example: {
    label: '举个例子',
    task: '这次不要辨析词义：给它一个具体例子（一句话场景 + 一句话结果），让读者秒懂；here 放例子（≤140 字），literal 留空，links 留空。',
  },
  translate: {
    label: '翻译',
    task: '这次只做翻译：圈出的文本是中文就译成英文，是英文就译成中文，保持术语原样；here 只放译文，不要再解释，literal / readings / links 全部留空，confidence 给 high。',
  },
});

/** 合法的模式名。 */
export function modeOf(name) {
  return typeof name === 'string' && MODES[name] !== undefined ? MODES[name] : MODES.default;
}

/** system 提示词（压到 300 字上下：schema 保留，规则只留会改变输出的那几条）。 */
export const SYSTEM_PROMPT = [
  '你是对话语境释义器。用户圈出对话里的一个词或一句话，问它在**这段对话里**是什么意思。',
  '只输出 JSON，不要代码块、不要前后缀：',
  '{"here":"它在这段对话里指什么，1-2 句，≤120 字","kind":"术语|动作|指代|评价|其它",',
  '"domain":"所属领域，2-6 字（如 游戏/计算机/物理/金融/医疗），拿不准就填空字符串",',
  '"literal":"不看语境时的通常含义，1 句","readings":[{"label":"另一种读法","note":"为什么"}],',
  '"evidence":[{"quote":"对话原话，逐字 10-40 字","why":"它说明了什么"}],',
  '"links":[{"label":"相关概念","note":"一句话","children":[{"label":"更细","note":"一句话"}]}],',
  '"confidence":"high|medium|low"}',
  '硬规则：quote 必须逐字出现在对话里；看不出来就降低 confidence 并把可能读法放进 readings；',
  '若上下文里给了【上级概念】，说明这个词是从上一张卡片点开展开的：即使对话原文没出现过它，',
  '也要顺着上级概念说清它在这里具体指什么（例如「CSS 属性」在 pointer-events 的语境下就是布局属性声明），',
  '不要回答「对话中未提供上下文」；这时 quote 可以留空、confidence 用 medium。',
  'domain 只填**一个**最贴切的领域名，宁空勿滥；',
  'readings≤3、evidence≤4、links≤5、children≤3 且不再嵌套；全中文（专有名词除外）。',
].join('\n');

/**
 * 把上下文裁到预算内：**保头也保尾**，中间省略。
 *
 * 为什么不是直接 slice：对话的开头往往定义了术语，结尾才是"现在"的语境；
 * 砍掉任何一头都会让 `here` 失真。
 *
 * @param {unknown} context - 原始对话文本。
 * @param {number} [budget] - 预算字符数。
 * @returns {string} 裁剪后的文本。
 */
export function clampContext(context, budget = CONTEXT_BUDGET) {
  const text = typeof context === 'string' ? context.trim() : '';
  const max = Number.isFinite(budget) ? Math.max(200, Math.floor(budget)) : CONTEXT_BUDGET;
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.4);
  const tail = max - head - 12;
  return `${text.slice(0, head)}\n…（中间省略）…\n${text.slice(text.length - tail)}`;
}

/**
 * 拼出请求里的 messages。
 * @param {{phrase:unknown, sentence?:unknown, context?:unknown}} input - 圈出的文本、所在句、对话上下文。
 * @returns {{role:string,content:string}[]} 两条消息。
 */
export function buildMessages(input) {
  const phrase = typeof input?.phrase === 'string' ? input.phrase.trim() : '';
  const sentence = typeof input?.sentence === 'string' ? input.sentence.trim() : '';
  const context = clampContext(input?.context);
  const mode = modeOf(input?.mode);
  const parts = [];
  if (context !== '') {
    parts.push('【这段对话】');
    parts.push(context);
    parts.push('');
  }
  parts.push(`【圈出的文本】${phrase}`);
  if (sentence !== '' && sentence !== phrase) {
    parts.push('');
    parts.push(`【它所在的那句话】${sentence.slice(0, 300)}`);
  }
  parts.push('');
  parts.push(mode.task === ''
    ? '问：这个圈出的文本，在这一整段对话里是什么意思？'
    : `【这次要做的】${mode.task}`);
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: parts.join('\n') },
  ];
}

/**
 * 请求体（拆出来是为了纯函数可测，也方便换模型）。
 * @param {{model:string, messages:object[], maxTokens?:number}} input - 组装参数。
 * @returns {object} OpenAI 兼容请求体。
 */
export function buildBody(input) {
  const body = {
    model: input.model,
    messages: input.messages,
    temperature: 0.2,
    max_tokens: Number.isFinite(input.maxTokens) ? input.maxTokens : 700,
    response_format: { type: 'json_object' },
  };
  /* DeepSeek 默认开着思考；这句释义不需要，关掉更快也更省。别的家不认这个字段，所以按域名带。 */
  if (typeof input.model === 'string' && input.model.startsWith('deepseek')) {
    body.thinking = { type: 'disabled' };
  }
  return body;
}
