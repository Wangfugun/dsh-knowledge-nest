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
export const CONTEXT_BUDGET = 3000;

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
    task: '这次把术语换成大白话：假设对方是这个领域之外的人，不许用任何行话、缩写、书面腔，就用平时说话的方式讲清楚它在这里到底指什么。here 放这段大白话（≤120 字），literal 留空，links 最多 2 条。',
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

/**
 * system 提示词。
 *
 * 压缩原则：只留会改变输出的规则，示例合并成一行，能省的形容词全省。
 * 实测这段约 400 token，是每次请求的固定开销，所以每砍 100 字就省一次的钱。
 */
export const SYSTEM_PROMPT = [
  '你是对话语境释义器：用户圈出对话里的词，问它在这段对话里指什么。只输出 JSON，无代码块无前后缀。',
  '{"here":"语境义，1-2句≤120字","kind":"术语|动作|指代|评价|其它","domain":"领域2-6字，如 计算机/物理/金融，拿不准填空串",',
  '"literal":"通常含义1句","readings":[{"label":"另一种读法","note":"为何"}],',
  '"evidence":[{"quote":"原文逐字10-40字","why":"说明什么"}],',
  '"links":[{"label":"相关概念","note":"一句","children":[{"label":"更细","note":"一句"}]}],',
  '"confidence":"high|medium|low"}',
  '规则：quote 必须逐字见于对话；看不出就降 confidence 并把可能读法放进 readings；',
  '若给了【上级概念】，说明这个词是从上张卡片展开的，即使原文没出现也要顺它说清此处所指，',
  '不许答"未提供上下文"，此时 quote 可空、confidence 用 medium。',
  'domain 只填一个最贴切的，宁空勿滥；readings≤3、evidence≤4、links≤5、children≤3 且不再嵌套；全中文，专有名词除外。',
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
  /* 语言与长度规则拼在 system 末尾：用户设成什么语言，就用什么语言答。
     这一段是手写的指令，不是把中文提示词丢给翻译接口。 */
  const rule = outputRule({ depth: input?.depth, lang: input?.lang, limit: input?.limit });
  const system = rule === '' ? SYSTEM_PROMPT : `${SYSTEM_PROMPT}\n\n${rule}`;

  return [
    { role: 'system', content: system },
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
    max_tokens: Number.isFinite(input.maxTokens) ? input.maxTokens : 600,
    response_format: { type: 'json_object' },
  };
  /* DeepSeek 默认开着思考；这句释义不需要，关掉更快也更省。别的家不认这个字段，所以按域名带。 */
  if (typeof input.model === 'string' && input.model.startsWith('deepseek')) {
    body.thinking = { type: 'disabled' };
  }
  return body;
}

/**
 * 详细度：直接换算成提示词里允许的字数。
 * 用户拖动「解释长度」滑块时，这个值会跟着变。
 */
export const DEPTH_LIMITS = Object.freeze({ brief: 40, normal: 90, deep: 200 });

/**
 * 按详细度取字数上限。
 * @param {string} depth - brief / normal / deep。
 * @returns {number} 字数上限。
 */
export function limitOf(depth) {
  return DEPTH_LIMITS[depth] ?? DEPTH_LIMITS.normal;
}

/**
 * 输出语言的名字。提示词里直接写这个，让模型用该语言作答。
 * 不用机器翻译——每种语言的指令都是手写的。
 */
export const LANG_NAMES = Object.freeze({
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
  en: 'English',
  ja: '日本語',
  ko: '한국어',
  de: 'Deutsch',
  fr: 'Français',
  es: 'Español',
  ru: 'Русский',
});

/**
 * 组装「输出要求」那一段，跟着详细度和语言走。
 * @param {{depth?:string, lang?:string}} [prefs] - 偏好。
 * @returns {string} 追加到 system 提示词末尾的一段话。
 */
export function outputRule(prefs = {}) {
  /* 滑块给具体字数；没给就按档位折。 */
  const limit = Number.isFinite(prefs.limit) && prefs.limit > 0
    ? Math.round(prefs.limit)
    : limitOf(prefs.depth);
  const lang = LANG_NAMES[prefs.lang] ?? LANG_NAMES['zh-CN'];

  /* 中文用中文写指令；其他语言一律用英文写，避免中英夹在一起让模型犹豫。 */
  if (lang === LANG_NAMES['zh-CN'] || lang === LANG_NAMES['zh-TW']) {
    const grain = limit <= 50
      ? '用一句话说清，不展开、不举例。'
      : limit <= 160
        ? '给两层意思就够，别铺垫。'
        : '先一句话结论，再补细节或例子，讲透为止。';
    return `输出语言：${lang}。解释长度：${grain}here 字段不超过 ${limit} 字。`;
  }

  const grain = limit <= 50
    ? 'One sentence, no elaboration, no example.'
    : limit <= 160
      ? 'Two points is enough; skip the wind-up.'
      : 'Lead with the conclusion, then add detail or an example.';
  return `Output language: ${lang}. Write every field in ${lang}; keep the picked word untranslated.
Length: ${grain} The "here" field must stay under ${limit} characters.`;
}

