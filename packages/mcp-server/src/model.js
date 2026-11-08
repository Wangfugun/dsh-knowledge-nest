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

/** 本地推理的默认端点：不花钱，也不需要钥匙。 */
export const LOCAL_PRESETS = {
  ollama: { baseUrl: 'http://127.0.0.1:11434/v1', model: '', key: 'ollama' },
  lmstudio: { baseUrl: 'http://127.0.0.1:1234/v1', model: '', key: 'lmstudio' },
  vllm: { baseUrl: 'http://127.0.0.1:8000/v1', model: '', key: 'vllm' },
};

/**
 * 这个 baseUrl 是不是本地端点（本地端点允许没有钥匙）。
 * @param {string} baseUrl - 端点。
 * @returns {boolean} 是否本地。
 */
export function isLocalEndpoint(baseUrl) {
  return /127\.0\.0\.1|localhost|0\.0\.0\.0|::1|host\.docker\.internal/iu.test(String(baseUrl ?? ''));
}

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
 * 这个路径是不是落在 Windows 的系统盘（通常是 C:）。
 *
 * 只用来发提醒，不改变行为：有的机器（尤其本机）明令禁止往 C 盘写，
 * 而默认的 `~/.knest` 恰好就在 C 盘。让客户端日志里能一眼看到这件事。
 *
 * @param {string} path - 绝对路径。
 * @returns {boolean} 是否在系统盘。
 */
export function isOnSystemDrive(path) {
  const text = typeof path === 'string' ? path.trim() : '';
  if (text === '') return false;
  const drive = process.env.SystemDrive || 'C:';
  return text.slice(0, 2).toUpperCase() === `${drive.slice(0, 2).toUpperCase()}`;
}

/**
 * 启动自检：把「配置从哪来、能不能用、有没有踩坑」整理成几行字。
 *
 * 只读，不写文件、不发请求；调用方负责打到 stderr。
 *
 * @param {Record<string,string|undefined>} [env] - 环境变量。
 * @returns {{lines:string[], warnings:string[], model:object}} 诊断结果。
 */
export function startupDiagnostics(env = process.env) {
  const model = resolveModel(env);
  const home = knestHome(env);
  const explicitHome = typeof env?.KNEST_HOME === 'string' && env.KNEST_HOME.trim() !== '';
  const lines = [
    `home      ${home}${explicitHome ? '' : '（默认值）'}`,
    `config    ${configPath(env)}`,
    `endpoint  ${model.baseUrl || '(未配置)'}`,
    `model     ${model.model || '(未配置)'}`,
    `key       ${model.apiKey === '' ? '(无)' : maskKey(model.apiKey)}  来源 ${model.source}`,
    `timeout   ${model.timeoutMs}ms   maxTokens ${model.maxTokens}`,
  ];

  const warnings = [];
  if (!explicitHome && isOnSystemDrive(home)) {
    warnings.push(
      `数据目录落在系统盘（${home}）。若这台机器不允许写 C 盘，请在客户端配置里设 KNEST_HOME 到别的盘。`,
    );
  }
  if (model.source === 'none') {
    warnings.push('没有找到任何钥匙：设 DEEPSEEK_API_KEY 或 OPENAI_API_KEY，或写进 config.json 的 apiKey。');
  }
  if (model.model === '') {
    warnings.push('没有模型名：非 DeepSeek 端点必须显式给 OPENAI_MODEL。');
  }
  if (isLocalEndpoint(model.baseUrl) && model.source === 'none') {
    warnings.push('本地端点不需要钥匙，但需要模型名与已经跑起来的推理服务。');
  }
  return { lines, warnings, model };
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

  const presetName = text(env?.KNEST_PROVIDER).toLowerCase();
  const preset = LOCAL_PRESETS[presetName] ?? null;
  const openaiKey = text(env?.OPENAI_API_KEY) || (preset === null ? '' : preset.key);
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

  const envBase = text(env?.OPENAI_BASE_URL) || text(env?.DEEPSEEK_BASE_URL) || (preset === null ? '' : preset.baseUrl);
  const fileBase = text(file.baseUrl);

  /* 没有钥匙但端点指向本机：本地推理不需要钥匙，直接放行 */
  if (source === 'none' && envBase !== '' && isLocalEndpoint(envBase)) {
    apiKey = preset?.key ?? 'local';
    source = 'env-openai';
  } else if (source === 'none' && fileBase !== '' && isLocalEndpoint(fileBase)) {
    apiKey = 'local';
    source = 'config';
  }
  /* 地址跟着 key 的来源走：env 给的 key 就用 env/默认地址，不要把配置文件里的地址混进来。 */
  let baseUrl = '';
  if (source === 'env-openai') baseUrl = envBase || OPENAI_BASE_URL;
  else if (source === 'env-deepseek') baseUrl = envBase || DEEPSEEK_BASE_URL;
  else if (source === 'config') baseUrl = fileBase || DEEPSEEK_BASE_URL;
  baseUrl = baseUrl.replace(/\/+$/u, '');
  const looksDeepSeek = /deepseek/iu.test(baseUrl);

  const envModel = text(env?.OPENAI_MODEL) || text(env?.DEEPSEEK_MODEL) || (preset === null ? '' : preset.model);
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

  const local = isLocalEndpoint(baseUrl);
  return {
    enabled: file.enabled !== false,
    apiKey: apiKey === '' && local ? (preset?.key ?? 'local') : apiKey,
    baseUrl,
    model,
    fallbackModel,
    maxTokens: num(env?.KNEST_MAX_TOKENS ?? file.maxTokens, DEFAULT_MAX_TOKENS, 200, 4000),
    timeoutMs: num(env?.KNEST_TIMEOUT_MS ?? file.timeoutMs, DEFAULT_TIMEOUT_MS, 5_000, 600_000),
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
