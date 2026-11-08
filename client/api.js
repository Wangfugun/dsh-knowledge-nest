import { readPrefs } from './prefs.js';
/**
 * 浏览器侧的模型客户端：**只打本插件自己的 host 路由**，从不直连模型。
 *
 * 两层缓存：
 *   1. 内存（同一个会话里同一个词再圈一次 → 0 请求）；
 *   2. 磁盘（host 侧按 `词 + 对话指纹` 存的 30 天缓存）。
 *
 * 错误一律收敛成 `{ok:false, error:{code,message,retryable}}`，不 throw——
 * 浮层要能稳定地显示"为什么没解释"。
 */

/** 默认路由（与 index.js 的 EXPLAIN_PATH 必须一致）。 */
export const EXPLAIN_ENDPOINT = '/knowledge-nest/explain';

/** 文件读取路由（与 index.js 的 READ_PATH 必须一致）。 */
export const READ_ENDPOINT = '/knowledge-nest/read';

/** 批注落盘路由。 */
export const ANNOTATE_ENDPOINT = '/knowledge-nest/annotations';

/** 卡片仓库路由。 */
export const CARDS_ENDPOINT = '/knowledge-nest/cards';

/** 内存缓存条数上限。 */
const MEMORY_LIMIT = 120;

/**
 * 造客户端。
 * @param {{fetchImpl?:Function, endpoint?:string, timeoutMs?:number}} [options] - 注入点。
 * @returns {{explain:Function, status:Function, clearCache:Function, peek:Function, forget:Function}} 客户端。
 */
export function createExplainApi(options = {}) {
  const endpoint = typeof options.endpoint === 'string' && options.endpoint !== '' ? options.endpoint : EXPLAIN_ENDPOINT;
  const readEndpoint = typeof options.readEndpoint === 'string' && options.readEndpoint !== '' ? options.readEndpoint : READ_ENDPOINT;
  const annotateEndpoint = ANNOTATE_ENDPOINT;
  const cardsEndpoint = CARDS_ENDPOINT;
  const fetchImpl = typeof options.fetchImpl === 'function'
    ? options.fetchImpl
    : (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 70_000;

  /** @type {Map<string, object>} */
  const memory = new Map();

  const remember = (key, value) => {
    if (memory.has(key)) memory.delete(key);
    memory.set(key, value);
    while (memory.size > MEMORY_LIMIT) {
      const oldest = memory.keys().next();
      if (oldest.done) break;
      memory.delete(oldest.value);
    }
  };

  /**
   * 发请求。
   * @param {string} method - HTTP 方法。
   * @param {object} [body] - 请求体。
   * @param {string} [url] - 目标地址（默认解释路由）。
   * @returns {Promise<object>} 解析后的 JSON（失败也给对象）。
   */
  const send = async (method, body, url = endpoint) => {
    if (fetchImpl === null) {
      return { ok: false, error: { code: 'no-fetch', message: '这个环境没有 fetch', retryable: false } };
    }
    const controller = typeof globalThis.AbortController === 'function' ? new globalThis.AbortController() : null;
    const timer = controller === null ? null : setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method,
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller === null ? undefined : controller.signal,
      });
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      if (payload === null || typeof payload !== 'object') {
        return { ok: false, error: { code: 'bad-response', message: `路由返回了非 JSON（${response.status}）`, retryable: true } };
      }
      return payload;
    } catch (error) {
      const message = error !== null && error !== undefined && typeof error.message === 'string'
        ? error.message
        : String(error);
      const aborted = /abort/iu.test(message);
      return {
        ok: false,
        error: {
          code: aborted ? 'timeout' : 'network',
          message: aborted ? '等太久了，模型还没回' : `连不上插件路由：${message}`,
          retryable: true,
        },
      };
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  };

  return {
    /**
     * 解释一个词/句。
     * @param {{phrase:string, sentence?:string, context?:string, fingerprint?:string, sessionId?:string, force?:boolean}} input - 请求。
     * @returns {Promise<object>} `{ok, data, cached, model, ms}` 或 `{ok:false, error}`。
     */
    async explain(input) {
      const phrase = typeof input?.phrase === 'string' ? input.phrase.trim() : '';
      if (phrase === '') return { ok: false, error: { code: 'bad-request', message: '没有圈出文本', retryable: false } };
      const mode = typeof input?.mode === 'string' && input.mode !== '' ? input.mode : 'default';
      const prefsForCache = readPrefs();
      const key = `${input?.sessionId ?? ''}|${phrase}|${input?.fingerprint ?? ''}|${mode}|${prefsForCache.lang}|${prefsForCache.charLimit}`;
      if (input?.force !== true) {
        const hit = memory.get(key);
        if (hit !== undefined) return { ...hit, cached: true };
      }
      /* 语言与字数跟着面板走：用户切了语言，下一次解释就用那个语言答。 */
      const prefs = readPrefs();
      const payload = await send('POST', {
        phrase,
        sentence: typeof input?.sentence === 'string' ? input.sentence : '',
        context: typeof input?.context === 'string' ? input.context : '',
        fingerprint: typeof input?.fingerprint === 'string' ? input.fingerprint : '',
        model: typeof input?.model === 'string' ? input.model : '',
        mode,
        lang: prefs.lang,
        limit: prefs.charLimit,
      });
      if (payload.ok === true && payload.data !== null && typeof payload.data === 'object') {
        const result = { ok: true, data: payload.data, cached: payload.cached === true, model: payload.model, ms: payload.ms };
        remember(key, result);
        return result;
      }
      return {
        ok: false,
        error: payload?.error !== null && typeof payload?.error === 'object'
          ? payload.error
          : { code: 'unknown', message: '插件路由没有给出原因', retryable: true },
      };
    },
    /**
     * 读工作区里的一个文本文件（host 侧已做越权/后缀/大小校验）。
     *
     * 失败时同样返回 `{ok:false, error}`，不 throw——调用方只要看 ok。
     * @param {string} path - 工作区内的路径。
     * @returns {Promise<object>} `{ok:true, text, path, bytes}` 或 `{ok:false, error}`。
     */
    async readFile(path) {
      const target = typeof path === 'string' ? path.trim() : '';
      if (target === '') {
        return { ok: false, error: { code: 'bad-request', message: '没有填路径', retryable: false } };
      }
      const payload = await send('GET', undefined, `${readEndpoint}?path=${encodeURIComponent(target)}`);
      if (payload?.ok === true && typeof payload.text === 'string') {
        return { ok: true, text: payload.text, path: payload.path ?? target, bytes: payload.bytes ?? 0 };
      }
      return {
        ok: false,
        error: payload?.error !== null && typeof payload?.error === 'object'
          ? payload.error
          : { code: 'unknown', message: '插件路由没有给出原因', retryable: true },
      };
    },
    /**
     * 把批注摘要写到工作区（host 侧改写 AGENTS.local.md 的标记块）。
     * @param {{entries:object[], window:string}} input - 批注与区间。
     * @returns {Promise<object>} `{ok, file, written}` 或 `{ok:false, error}`。
     */
    async annotate(input) {
      const entries = Array.isArray(input?.entries) ? input.entries : [];
      return send('POST', { entries, window: input?.window === 'user' ? 'user' : 'assistant' }, annotateEndpoint);
    },
    /**
     * 存一张卡（host 侧按词合并进 cards.jsonl）。
     * @param {object} card - 卡片。
     * @returns {Promise<object>} 结果。
     */
    async saveCard(card) {
      return send('POST', { card }, cardsEndpoint);
    },
    /**
     * 搜索卡片。
     * @param {{q?:string, domain?:string, limit?:number}} input - 条件。
     * @returns {Promise<object>} `{ok, rows, stats}`。
     */
    async searchCards(input) {
      const q = encodeURIComponent(typeof input?.q === 'string' ? input.q : '');
      const domain = encodeURIComponent(typeof input?.domain === 'string' ? input.domain : '');
      const limit = Number.isFinite(input?.limit) ? input.limit : 200;
      return send('GET', undefined, `${cardsEndpoint}?q=${q}&domain=${domain}&limit=${limit}`);
    },
    /**
     * 读状态。
     * @returns {Promise<object>} `{ok, status}`。
     */
    async status() {
      return send('GET');
    },
    /**
     * 清 host 缓存。
     * @returns {Promise<object>} `{ok, cleared}`。
     */
    async clearCache() {
      memory.clear();
      return send('DELETE');
    },
    /**
     * 内存里有没有（不请求）。
     * @param {{phrase:string, fingerprint?:string, sessionId?:string}} input - 键。
     * @returns {object|null} 结果。
     */
    peek(input) {
      const mode = typeof input?.mode === 'string' && input.mode !== '' ? input.mode : 'default';
      const key = `${input?.sessionId ?? ''}|${input?.phrase ?? ''}|${input?.fingerprint ?? ''}|${mode}`;
      return memory.get(key) ?? null;
    },
    /**
     * 丢掉某个词的内存结果（用户点"重新解释"）。
     * @param {{phrase:string, fingerprint?:string, sessionId?:string}} input - 键。
     * @returns {void}
     */
    forget(input) {
      const mode = typeof input?.mode === 'string' && input.mode !== '' ? input.mode : 'default';
      const key = `${input?.sessionId ?? ''}|${input?.phrase ?? ''}|${input?.fingerprint ?? ''}|${mode}`;
      memory.delete(key);
    },
  };
}
