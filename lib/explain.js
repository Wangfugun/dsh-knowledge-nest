/**
 * 解释编排：缓存 → 闸门 → 出网 → 收敛。
 *
 * 一次调用只做一条链路，没有第二条分支：
 *   同词同对话 → 命缓存直接返回（0 出网）
 *   → 没命中就排队过闸门（同 key 单飞）
 *   → 打一次 chat/completions（硬超时）
 *   → 收敛成有限形状 → 只把成功写进缓存。
 *
 * 失败一律 throw `NestError`，由路由层翻成 HTTP。**任何失败都不写缓存**：
 * 一次 429 不该让一个词 30 天没解释。
 */
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { createCache } from './cache.js';
import { createGate } from './gate.js';
import { NestError } from './errors.js';
import { CONFIG_DIR, dshHome, maskKey, readConfig, resolveKey } from './key.js';
import { PHRASE_LIMIT, buildBody, buildMessages, modeOf } from './prompt.js';
import { fallbackExplanation, parseModelJson, shapeExplanation } from './shape.js';

/**
 * 缓存键：词 + 对话指纹 + 模式。
 * 指纹变了（对话新增了消息）就当成新问题；模式不同（释义 / 换说法 / 例子 / 翻译）也各算一份。
 */
export function cacheKeyOf(phrase, fingerprint, mode, lang, limit) {
  const p = typeof phrase === 'string' ? phrase : '';
  const b = typeof fingerprint === 'string' ? fingerprint : '';
  const md = typeof mode === 'string' && mode !== '' ? mode : 'default';
  /* 语言与字数进 key：换语言必须重新问，不能吃旧语言的缓存 */
  const lg = typeof lang === 'string' && lang !== '' ? lang : '';
  const lm = Number.isFinite(limit) ? String(Math.round(limit)) : '';
  const raw = `${md}\u0001${lg}\u0001${lm}\u0001${b}\u0001${p}`;
  return createHash('sha1').update(raw, 'utf8').digest('hex').slice(0, 20);
}

/**
 * 造解释器。
 * @param {object} [options] - 注入点（测试 / 换模型 / 换宿主）。
 * @param {string} [options.home] - 数据目录（默认取 provider.dshHome）。
 * @param {Record<string,string|undefined>} [options.env] - 环境变量。
 * @param {Function} [options.transport] - fetch 替身。
 * @param {()=>number} [options.now] - 时钟。
 * @param {string} [options.model] - 强制模型（优先于配置文件）。
 * @param {object} [options.cache] - 现成缓存（测试可换成内存版）。
 * @param {object} [options.gate] - 现成闸门。
 * @param {{readConfig:Function,resolveKey:Function,maskKey:Function,dshHome:Function,configDir:string}} [options.provider]
 *   配置与钥匙的来源（默认 = DSH：配置文件 + 环境变量 + `.credentials.yaml`）。
 *   独立 MCP Server 会注入自己的 provider，从而完全不碰 DSH_HOME。
 * @returns {{explain:Function,status:Function,clearCache:Function,cache:object,gate:object}} 解释器。
 */
export function createExplainer(options = {}) {
  const env = options.env ?? process.env;
  /* 唯一缝：谁提供"配置 + 钥匙 + 数据目录"。缺省就是 DSH 那一套，行为与以前完全一致。 */
  const provider = options.provider ?? {
    readConfig,
    resolveKey,
    maskKey,
    dshHome,
    configDir: CONFIG_DIR,
  };
  const home = typeof options.home === 'string'
    ? options.home
    : (typeof provider.dshHome === 'function' ? provider.dshHome(env) : dshHome(env));
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const transport = typeof options.transport === 'function' ? options.transport : globalThis.fetch;
  const cache = options.cache ?? createCache({ file: join(home, provider.configDir ?? CONFIG_DIR, 'explain-cache.json'), now });
  const gate = options.gate ?? createGate({ maxActive: 3, minGapMs: 250, now });

  /** 最近一次真实出网的用量：状态页与卡片脚注都读它，让"花了多少"是看得见的。 */
  let lastUsage = { prompt: 0, completion: 0, total: 0, cached: 0 };

  /**
   * 打一次模型。
   * @param {object} args - 参数。
   * @param {string} args.key - API key。
   * @param {object} args.config - 配置。
   * @param {string} args.model - 模型名。
   * @param {{role:string,content:string}[]} args.messages - 消息。
   * @returns {Promise<{data:object,model:string,ms:number}>} 收敛后的结果。
   */
  const requestOnce = async ({ key, config, model, messages }) => {
    const started = now();
    const body = buildBody({ model, messages, maxTokens: config.maxTokens });
    let response;
    try {
      response = await transport(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(config.timeoutMs),
      });
    } catch (error) {
      const message = error !== null && error !== undefined && typeof error.message === 'string'
        ? error.message
        : String(error);
      const timeout = /abort|timeout/iu.test(message);
      throw new NestError(timeout ? 'timeout' : 'network', timeout ? '模型响应超时' : `连不上模型接口：${message}`, {
        retryable: true,
      });
    }

    if (!response.ok) {
      let detail = '';
      try {
        detail = String(await response.text()).slice(0, 300);
      } catch {
        detail = '';
      }
      const status = response.status;
      if (status === 401 || status === 403) {
        throw new NestError('unauthorized', '模型接口拒绝了这把钥匙', { status });
      }
      if (status === 429) {
        throw new NestError('rate-limited', '模型接口限流了', { status, retryable: true });
      }
      if (status === 400 && /model/iu.test(detail)) {
        throw new NestError('model-unavailable', '这个模型名接口不认', { status, detail });
      }
      throw new NestError('http', `模型接口返回 ${status}`, { status, detail, retryable: status >= 500 });
    }

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      throw new NestError('bad-json', '模型接口返回的不是 JSON', { retryable: true });
    }
    const content = payload?.choices?.[0]?.message?.content;
    const raw = typeof content === 'string' ? content : '';
    if (raw.trim() === '') throw new NestError('empty', '模型这次没给内容', { retryable: true });

    const parsed = parseModelJson(raw);
    const data = shapeExplanation(parsed) ?? fallbackExplanation(raw);
    if (data === null) throw new NestError('empty', '模型给的内容收敛后是空的', { retryable: true });

    const rawUsage = payload?.usage ?? {};
    const usage = {
      prompt: Number.isFinite(rawUsage.prompt_tokens) ? rawUsage.prompt_tokens : 0,
      completion: Number.isFinite(rawUsage.completion_tokens) ? rawUsage.completion_tokens : 0,
      total: Number.isFinite(rawUsage.total_tokens) ? rawUsage.total_tokens : 0,
      cached: Number.isFinite(rawUsage.prompt_cache_hit_tokens) ? rawUsage.prompt_cache_hit_tokens : 0,
    };
    lastUsage = usage;

    return { data, model, ms: now() - started, usage };
  };

  return {
    cache,
    gate,
    /**
     * 解释一个圈出来的词/句。
     * @param {{phrase:string, sentence?:string, context?:string, fingerprint?:string}} input - 请求。
     * @returns {Promise<{data:object, cached:boolean, model:string, ms:number}>} 结果。
     */
    async explain(input) {
      const config = provider.readConfig(home);
      if (config.enabled === false) throw new NestError('disabled', '解释功能被配置关掉了');

      const phrase = typeof input?.phrase === 'string' ? input.phrase.trim() : '';
      if (phrase === '') throw new NestError('bad-request', '没有圈出任何文本');
      if (phrase.length > PHRASE_LIMIT) throw new NestError('bad-request', `圈出的文本太长（上限 ${PHRASE_LIMIT} 字）`);

      const resolved = provider.resolveKey({ home, env });
      if (resolved.key === '') {
        throw new NestError('no-key', '没有可用的 DeepSeek key（配置文件、环境变量、凭据文件都没找到）');
      }

      const context = typeof input?.context === 'string' ? input.context : '';
      const fingerprint = typeof input?.fingerprint === 'string' && input.fingerprint !== ''
        ? input.fingerprint
        : createHash('sha1').update(context, 'utf8').digest('hex').slice(0, 16);
      const modeName = typeof input?.mode === 'string' && input.mode !== '' ? input.mode : 'default';
      const mode = modeOf(modeName);

      /* 语言与字数先算出来：它们要进缓存 key，才能做到「换语言不吃旧缓存」。 */
      const lang = typeof input?.lang === 'string' && input.lang !== ''
        ? input.lang
        : (typeof config?.lang === 'string' && config.lang !== '' ? config.lang : 'zh-CN');
      const limit = Number.isFinite(input?.limit)
        ? Number(input.limit)
        : (Number.isFinite(config?.charLimit) ? Number(config.charLimit) : 90);

      const key = cacheKeyOf(phrase, fingerprint, mode === modeOf('default') ? 'default' : modeName, lang, limit);

      /* force 就是强制重问：以前这里无条件查缓存，force 传了也没用。 */
      const hit = input?.force === true ? null : cache.get(key);
      if (hit !== null) {
        return {
          data: hit.data,
          cached: true,
          model: String(hit.model ?? 'cache'),
          ms: 0,
          usage: hit.usage ?? { prompt: 0, completion: 0, total: 0, cached: 0 },
        };
      }

      const messages = buildMessages({
        phrase,
        sentence: input?.sentence,
        context,
        mode: modeName,
        lang,
        limit,
      });
      /* 请求里可以点名模型（设置面板会带），但只认形状合法的小写名字；
         服务器端默认值优先于配置文件的写法见 key.js。 */
      const requested = typeof input?.model === 'string' ? input.model.trim() : '';
      const model = /^[a-z0-9][a-z0-9.-]{1,39}$/u.test(requested)
        ? requested
        : (typeof options.model === 'string' && options.model !== '' ? options.model : config.model);

      const started = now();
      const result = await gate.run(key, async () => {
        try {
          return await requestOnce({ key: resolved.key, config, model, messages });
        } catch (error) {
          /* 模型名不被认：退到备用模型再试一次（只退一次，不递归）。 */
          if (error instanceof NestError && error.code === 'model-unavailable' && config.fallbackModel !== '' && config.fallbackModel !== model) {
            return requestOnce({ key: resolved.key, config, model: config.fallbackModel, messages });
          }
          throw error;
        }
      });

      cache.set(key, { data: result.data, model: result.model, phrase, usage: result.usage, mode: modeName });
      return { data: result.data, cached: false, model: result.model, ms: now() - started, usage: result.usage };
    },
    /**
     * 状态（不揭钥匙，只给指纹）。
     * @returns {object} 状态快照。
     */
    status() {
      const config = provider.readConfig(home);
      const resolved = provider.resolveKey({ home, env });
      return {
        enabled: config.enabled,
        model: typeof options.model === 'string' && options.model !== '' ? options.model : config.model,
        fallbackModel: config.fallbackModel,
        baseUrl: config.baseUrl,
        keyConfigured: resolved.key !== '',
        keySource: resolved.source,
        keyFingerprint: provider.maskKey(resolved.key),
        cache: cache.stats(),
        gate: gate.stats(),
        lastUsage,
      };
    },
    /**
     * 清缓存。
     * @returns {boolean} 是否成功。
     */
    clearCache() {
      return cache.clear();
    },
  };
}
