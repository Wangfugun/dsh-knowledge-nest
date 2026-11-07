/**
 * 模型来源：把「key / baseUrl / model」从环境变量或配置文件里取出来。
 *
 * 这里**不看 DSH_HOME，也不读 .credentials.yaml**——独立包要能在任何机器上跑。
 * 查找顺序（先到先得）：
 *   1. 环境变量：`OPENAI_API_KEY` + `OPENAI_BASE_URL`（任意 OpenAI 兼容接口）
 *      或 `DEEPSEEK_API_KEY`（默认 base 指向 DeepSeek）；
 *   2. 配置文件：`$KNEST_CONFIG`，否则 `$KNEST_HOME/config.json`（默认 `~/.knest/config.json`）。
 *
 * 模型名不猜：baseUrl 指向 DeepSeek 时默认 `deepseek-flash`；其它兼容接口必须显式给
 * `OPENAI_MODEL` / `DEEPSEEK_MODEL`，否则调用时返回 `no-model`，而不是发一个不存在的名字出去。
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** DeepSeek 的默认地址与模型。 */
export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
export const DEEPSEEK_MODEL = 'deepseek-flash';
export const DEEPSEEK_FALLBACK_MODEL = 'deepseek-v4-pro';

/** OpenAI 官方兼容端点（只在只给了 OPENAI_API_KEY 时兜底用）。 */
export const OPENAI_BASE_URL = 'https://api.openai.com/v1';

/** 默认上限。 */
export const DEFAULT_MAX_TOKENS = 700;
export const DEFAULT_TIMEOUT_MS = 45_000;

/**
 * 数据目录（缓存与默认配置都放这儿）。
 * @param {Record<string,string|undefined>} [env] - 环境变量。
 * @returns {string} 绝对路径。
 */
export function knestHome(env = process.env) {
  const fromEnv = typeof env?.KNEST_HOME === 'string' ? env.KNEST_HOME.trim() : '';
  return fromEnv !== '' ? fromEnv : join(homedir(), '.knest');
}

/**
 * 配置文件路径。
 * @param {Record<string,string|undefined>} [env] - 环境变量。
 * @returns {string} 路径。
 */
export function configPath(env = process.env) {
  const explicit = typeof env?.KNEST_CONFIG === 'string' ? env.KNEST_CONFIG.trim() : '';
  return explicit !== '' ? explicit : join(knestHome(env), 'config.json');
}

/**
 * 容错读配置文件。
 * @param {Record<string,string|undefined>} [env] - 环境变量。
 * @returns {object} 对象（读不到就是空对象）。
 */
export function readConfigFile(env = process.env) {
  try {
    const file = configPath(env);
    if (!existsSync(file)) return {};
    const raw = readFileSync(file, 'utf8').replace(/^\uFEFF/u, '');
    const parsed = JSON.parse(raw);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * 文本裁剪。
 * @param {unknown} value - 任意值。
 * @returns {string} 去空白后的字符串。
 */
function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * 数字收敛。
 * @param {unknown} value - 任意值。
 * @param {number} fallback - 兜底。
 * @param {number} min - 下限。
 * @param {number} max - 上限。
 * @returns {number} 结果。
 */
function num(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

/**
 * 解析最终的模型配置。
 * @param {Record<string,string|undefined>} [env] - 环境变量。
 * @returns {{enabled:boolean, apiKey:string, baseUrl:string, model:string, fallbackModel:string,
 *            maxTokens:number, timeoutMs:number, source:'env-openai'|'env-deepseek'|'config'|'none'}} 配置。
 */
export function resolveModel(env = process.env) {
  const file = readConfigFile(env);

  const openaiKey = text(env?.OPENAI_API_KEY);
  const deepseekKey = text(env?.DEEPSEEK_API_KEY);
  const fileKey = text(file.apiKey);

  let apiKey = '';
  let source = 'none';
  if (openaiKey !== '') {
    apiKey = openaiKey;
    source = 'env-openai';
  } else if (deepseekKey !== '') {
    apiKey = deepseekKey;
    source = 'env-deepseek';
  } else if (fileKey !== '') {
    apiKey = fileKey;
    source = 'config';
  }

  const envBase = text(env?.OPENAI_BASE_URL) || text(env?.DEEPSEEK_BASE_URL);
  const fileBase = text(file.baseUrl);
  /* 地址跟着 key 的来源走：env 给的 key 就用 env/默认地址，不要把配置文件里的地址混进来。 */
  let baseUrl = '';
  if (source === 'env-openai') baseUrl = envBase || OPENAI_BASE_URL;
  else if (source === 'env-deepseek') baseUrl = envBase || DEEPSEEK_BASE_URL;
  else if (source === 'config') baseUrl = fileBase || DEEPSEEK_BASE_URL;
  baseUrl = baseUrl.replace(/\/+$/u, '');
  const looksDeepSeek = /deepseek/iu.test(baseUrl);

  const envModel = text(env?.OPENAI_MODEL) || text(env?.DEEPSEEK_MODEL);
  const fileModel = text(file.model);
  const fileFallback = text(file.fallbackModel);

  /* 三元组（key / baseUrl / model）取自同一层：env 给的 key 就整组走 env + 供应商默认，
     不要出现「DeepSeek 的 key + 别家配置文件里的模型名」这种混搭。 */
  let model = '';
  let fallbackModel = '';
  if (source === 'env-openai') {
    model = envModel || (looksDeepSeek ? DEEPSEEK_MODEL : '');
    fallbackModel = looksDeepSeek ? DEEPSEEK_FALLBACK_MODEL : '';
  } else if (source === 'env-deepseek') {
    model = envModel || DEEPSEEK_MODEL;
    fallbackModel = DEEPSEEK_FALLBACK_MODEL;
  } else if (source === 'config') {
    model = fileModel || (looksDeepSeek ? DEEPSEEK_MODEL : '');
    fallbackModel = fileFallback || (looksDeepSeek ? DEEPSEEK_FALLBACK_MODEL : '');
  }

  return {
    enabled: file.enabled !== false,
    apiKey,
    baseUrl,
    model,
    fallbackModel,
    maxTokens: num(file.maxTokens, DEFAULT_MAX_TOKENS, 200, 4000),
    timeoutMs: num(file.timeoutMs, DEFAULT_TIMEOUT_MS, 5_000, 180_000),
    source,
  };
}

/**
 * 只露头尾的 key 指纹（状态用，永不回显整把钥匙）。
 * @param {string} key - 原始 key。
 * @returns {string} 指纹。
 */
export function maskKey(key) {
  const value = typeof key === 'string' ? key : '';
  if (value === '') return '';
  if (value.length <= 10) return `${value.slice(0, 2)}***`;
  return `${value.slice(0, 6)}***${value.slice(-2)} (${value.length})`;
}

/**
 * 造一个给 `createExplainer` 用的 provider（替代 DSH 那一套）。
 * @param {Record<string,string|undefined>} [env] - 环境变量。
 * @returns {{readConfig:Function, resolveKey:Function, maskKey:Function, dshHome:Function, configDir:string}} provider。
 */
export function createModelProvider(env = process.env) {
  return {
    /** 每次调用都重新解析：改环境变量或改配置文件无需重启进程。 */
    readConfig: () => {
      const resolved = resolveModel(env);
      return {
        enabled: resolved.enabled,
        apiKey: '',
        model: resolved.model,
        fallbackModel: resolved.fallbackModel,
        baseUrl: resolved.baseUrl,
        maxTokens: resolved.maxTokens,
        timeoutMs: resolved.timeoutMs,
      };
    },
    resolveKey: () => {
      const resolved = resolveModel(env);
      return { key: resolved.apiKey, source: resolved.source === 'none' ? 'none' : resolved.source };
    },
    maskKey,
    dshHome: () => knestHome(env),
    configDir: '',
  };
}
