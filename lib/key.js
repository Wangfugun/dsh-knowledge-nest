/**
 * 钥匙从哪来。
 *
 * 顺序（先到先得，且每一步都能单独说清"为什么没拿到"）：
 *   1. `$DSH_HOME/knowledge-nest/explain.json` 里手填的 apiKey —— 用户显式配置优先；
 *   2. 进程环境变量 `DEEPSEEK_API_KEY`；
 *   3. `$DSH_HOME/.credentials.yaml` 的 `refs:`（DSH 自己存 key 的地方，本机就有）。
 *
 * 为什么要读凭据文件：桌面端启动时并不一定把 key 导进环境变量（本机实测就是没导），
 * 而 DSH 把密钥落在这份 YAML 里。只读 `refs.DEEPSEEK_API_KEY` 这一行，其余内容不碰、
 * 不外传、不打日志。
 *
 * 纯文件 IO，没有任何网络行为；读不到就返回 null，由调用方决定怎么报错。
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** 插件配置目录（相对 $DSH_HOME）。 */
export const CONFIG_DIR = 'knowledge-nest';

/** 插件配置文件（模型、地址、手填 key）。 */
export const CONFIG_FILE = join(CONFIG_DIR, 'explain.json');

/** 默认对话模型。 */
export const DEFAULT_MODEL = 'deepseek-flash';

/** 备用模型（flash 挂了才会用到）。 */
export const FALLBACK_MODEL = 'deepseek-v4-pro';

/** 默认接口地址（OpenAI 兼容）。 */
export const DEFAULT_BASE_URL = 'https://api.deepseek.com';

/**
 * DSH 家目录。
 * @param {Record<string,string|undefined>} [env] - 环境变量表（测试可注入）。
 * @returns {string} 绝对路径。
 */
export function dshHome(env = process.env) {
  const fromEnv = typeof env?.DSH_HOME === 'string' ? env.DSH_HOME.trim() : '';
  return fromEnv !== '' ? fromEnv : join(homedir(), '.dsh');
}

/**
 * 容错读 JSON：文件不在 / 坏 JSON 一律当空对象。
 * @param {string} file - 路径。
 * @returns {object} 对象（永不为 null）。
 */
export function readJsonSafe(file) {
  try {
    if (!existsSync(file)) return {};
    const raw = readFileSync(file, 'utf8').replace(/^\uFEFF/u, '');
    const parsed = JSON.parse(raw);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * 读插件配置。
 * @param {string} home - DSH 家目录。
 * @returns {{apiKey:string, model:string, fallbackModel:string, baseUrl:string, maxTokens:number, timeoutMs:number, enabled:boolean}} 归一化配置。
 */
export function readConfig(home) {
  const raw = readJsonSafe(join(home, CONFIG_FILE));
  const text = (value) => (typeof value === 'string' ? value.trim() : '');
  const num = (value, fallback, min, max) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(Math.max(n, min), max);
  };
  return {
    apiKey: text(raw.apiKey),
    model: text(raw.model) || DEFAULT_MODEL,
    fallbackModel: text(raw.fallbackModel) || FALLBACK_MODEL,
    baseUrl: text(raw.baseUrl).replace(/\/+$/u, '') || DEFAULT_BASE_URL,
    maxTokens: num(raw.maxTokens, 900, 200, 4000),
    timeoutMs: num(raw.timeoutMs, 45_000, 5_000, 180_000),
    enabled: raw.enabled === false ? false : true,
  };
}

/**
 * 从 DSH 凭据文件里抠出 DeepSeek key。
 *
 * 只认 `refs:` 段下的 `DEEPSEEK_API_KEY:`，形如 `DEEPSEEK_API_KEY: sk-…`。
 * 不解析 YAML、不读其它字段：这份文件里还有会话令牌，碰得越少越好。
 *
 * @param {string} home - DSH 家目录。
 * @returns {{value:string, source:string}|null} 命中结果。
 */
export function readCredentialKey(home) {
  try {
    const file = join(home, '.credentials.yaml');
    if (!existsSync(file)) return null;
    if (statSync(file).size > 2 * 1024 * 1024) return null;
    const raw = readFileSync(file, 'utf8');
    const match = raw.match(/^[ \t]*DEEPSEEK_API_KEY:[ \t]*(\S+)[ \t]*$/mu);
    if (!match) return null;
    const value = match[1].replace(/^["']|["']$/gu, '').trim();
    if (value === '' || value.length < 12) return null;
    return { value, source: 'credentials' };
  } catch {
    return null;
  }
}

/**
 * 解析最终使用的 key。
 * @param {{home?:string, env?:Record<string,string|undefined>}} [options] - 覆盖项（测试用）。
 * @returns {{key:string, source:'config'|'env'|'credentials'|'none'}} 结果；没有就是 `{key:'', source:'none'}`。
 */
export function resolveKey(options = {}) {
  const env = options.env ?? process.env;
  const home = typeof options.home === 'string' ? options.home : dshHome(env);

  const config = readConfig(home);
  if (config.apiKey !== '') return { key: config.apiKey, source: 'config' };

  const fromEnv = typeof env.DEEPSEEK_API_KEY === 'string' ? env.DEEPSEEK_API_KEY.trim() : '';
  if (fromEnv !== '') return { key: fromEnv, source: 'env' };

  const fromCredentials = readCredentialKey(home);
  if (fromCredentials) return { key: fromCredentials.value, source: 'credentials' };

  return { key: '', source: 'none' };
}

/**
 * 只露前 6 位 + 长度：状态页要能让人确认"配的是哪把钥匙"，又不能把钥匙印在屏幕上。
 * @param {string} key - 原始 key。
 * @returns {string} 指纹（空 key 返回空串）。
 */
export function maskKey(key) {
  const text = typeof key === 'string' ? key : '';
  if (text === '') return '';
  if (text.length <= 10) return `${text.slice(0, 2)}***`;
  return `${text.slice(0, 6)}***${text.slice(-2)} (${text.length})`;
}
