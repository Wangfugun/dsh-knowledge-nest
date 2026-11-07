/**
 * dsh-knowledge-nest —— Host 半边。
 *
 * 插件在浏览器里只做三件事：圈词、变绿、画卡片。**一切模型调用都在这里**：
 *
 *   POST   /knowledge-nest/explain   {phrase, sentence, context, fingerprint}
 *                                  → {ok, data, cached, model, ms}
 *   GET    /knowledge-nest/explain   → {ok, status}            （钥匙配没配、缓存/闸门状态）
 *   DELETE /knowledge-nest/explain   → {ok, cleared}           （清解释缓存）
 *
 * 为什么走 `ctx.webServer.register`：与 dsh-purge 的 `/redteam/api` 同款接缝，
 * `register` 返回 disposer，套进 `ctx.effect` 后插件卸载即摘路由。本机实测可用。
 *
 * 为什么 key 不出浏览器：浏览器只发"词 + 对话上下文"，钥匙一直在 host 进程里。
 */
import { asNestError, NestError } from './lib/errors.js';
import { join } from 'node:path';

import { createExplainer } from './lib/explain.js';
import { writeAnnotations } from './lib/annotations.js';
import { createCardStore } from './lib/cards.js';

/** 插件名（loader 条目名与 client bundle 的 id 都必须是这个）。 */
export const name = 'dsh-knowledge-nest';

/** 只依赖 Web 服务器的路由注册能力，外加宿主文件系统服务。 */
export const inject = ['webServer', 'fs'];

/** 路由路径（浏览器侧 client/api.js 里是同一个字符串）。 */
export const EXPLAIN_PATH = '/knowledge-nest/explain';

/** 文件读取路由（只读、只读文本、只读工作区内）。 */
export const READ_PATH = '/knowledge-nest/read';

/** 批注落盘路由。 */
export const ANNOTATE_PATH = '/knowledge-nest/annotations';

/** 卡片仓库路由（GET 搜索 / POST 写入）。 */
export const CARDS_PATH = '/knowledge-nest/cards';

/** 单文件上限：1MB。 */
export const MAX_FILE_BYTES = 1024 * 1024;

/** 允许读取的文本后缀（白名单，其他一律 415）。 */
export const TEXT_EXTENSIONS = new Set([
  '.md', '.markdown', '.txt', '.text', '.log', '.rst',
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.json', '.jsonc',
  '.css', '.scss', '.less', '.html', '.htm', '.xml', '.svg',
  '.yml', '.yaml', '.toml', '.ini', '.cfg', '.conf', '.env',
  '.csv', '.tsv', '.sql', '.sh', '.bash', '.ps1', '.bat',
  '.py', '.go', '.rs', '.java', '.kt', '.c', '.h', '.cc', '.cpp', '.hpp', '.cs', '.rb', '.php',
  '.vue', '.svelte', '.astro', '.graphql', '.proto', '.dockerfile',
]);

/** 请求体上限：上下文最多几千字，128KB 足够，也挡得住误传整段会话 JSON。 */
const MAX_BODY_BYTES = 128 * 1024;

/**
 * 读请求体。
 * @param {import('node:http').IncomingMessage} req - 请求。
 * @returns {Promise<string>} 原始文本；超限抛错。
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const done = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };
    req.on('data', (chunk) => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > MAX_BODY_BYTES) {
        done(reject, new NestError('too-large', '请求体太大'));
        try {
          req.destroy();
        } catch {
          /* 已经关了 */
        }
        return;
      }
      chunks.push(buffer);
    });
    req.on('end', () => done(resolve, Buffer.concat(chunks).toString('utf8')));
    req.on('error', (error) => done(reject, error));
  });
}

/**
 * 发 JSON 响应。
 * @param {import('node:http').ServerResponse} res - 响应。
 * @param {number} status - 状态码。
 * @param {object} payload - 响应体。
 * @returns {void}
 */
function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

/**
 * 来源校验。
 *
 * 规则：**带了 Origin 就必须同源**；没带 Origin 的放行（桌面端 origin 常是
 * `app://` / `null`，`curl` 与单测也没有 Origin）。
 *
 * 为什么不再"回环一律放行"：浏览器发起的跨站请求会带 Origin，而它的 socket 往往
 * 也是 127.0.0.1——只看 socket 等于没校验。同源（Host 相同）才是真正想要的边界。
 *
 * @param {import('node:http').IncomingMessage} req - 请求。
 * @returns {boolean} 是否放行。
 */
function originAllowed(req) {
  const origin = req.headers.origin;
  if (origin === undefined || origin === '' || origin === 'null') return true;
  const host = typeof req.headers.host === 'string' ? req.headers.host : '';
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * 错误码 → HTTP 状态。
 * @param {NestError} error - 归一化错误。
 * @returns {number} 状态码。
 */
function statusFor(error) {
  switch (error.code) {
    case 'bad-request':
    case 'too-large':
      return 400;
    case 'no-key':
    case 'disabled':
      return 503;
    case 'unauthorized':
      return 401;
    case 'rate-limited':
      return 429;
    case 'timeout':
      return 504;
    case 'network':
    case 'http':
    case 'bad-json':
    case 'empty':
    case 'model-unavailable':
      return 502;
    default:
      return 500;
  }
}

/**
 * 造路由 handler（拆出来是为了能在测试里直接喂假 req/res）。
 * @param {{explainer:object}} deps - 解释器。
 * @returns {Function} (req, res) => Promise<void>
 */
export function createRouteHandler(deps) {
  const explainer = deps.explainer;
  return async function handler(req, res) {
    if (!originAllowed(req)) {
      sendJson(res, 403, { ok: false, error: { code: 'cross-origin', message: '跨源请求被拒绝', retryable: false } });
      return;
    }

    if (req.method === 'GET') {
      sendJson(res, 200, { ok: true, status: explainer.status(), routes: { ...routeState }, diag: { ...diagState } });
      return;
    }

    if (req.method === 'DELETE') {
      const cleared = explainer.clearCache();
      sendJson(res, 200, { ok: true, cleared });
      return;
    }

    if (req.method !== 'POST') {
      res.writeHead(405, { allow: 'GET, POST, DELETE', 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: { code: 'method', message: '只支持 GET / POST / DELETE', retryable: false } }));
      return;
    }

    try {
      const raw = await readBody(req);
      const trimmed = raw.trim();
      const body = trimmed === '' ? {} : JSON.parse(trimmed);
      const result = await explainer.explain({
        phrase: body?.phrase,
        sentence: body?.sentence,
        context: body?.context,
        fingerprint: body?.fingerprint,
        model: body?.model,
        mode: body?.mode,
      });
      sendJson(res, 200, {
        ok: true,
        data: result.data,
        cached: result.cached === true,
        model: result.model,
        ms: result.ms,
      });
    } catch (error) {
      const nest = asNestError(error);
      if (nest.code === 'internal' && /JSON/iu.test(nest.message)) {
        sendJson(res, 400, { ok: false, error: { code: 'bad-json', message: '请求体不是合法 JSON', retryable: false } });
        return;
      }
      sendJson(res, statusFor(nest), { ok: false, error: nest.toJSON() });
    }
  };
}

/* ───────────────────────── 文件读取（只读通道） ───────────────────────── */

/**
 * 安全地取一个服务。
 *
 * cordis 的 ctx 是代理：访问未注入的服务属性会直接抛，可选链挡不住它。
 * 所以取服务一律走这里，取不到就回 undefined。
 * @param {object} ctx - 上下文。
 * @param {string} name - 服务名。
 * @returns {any} 服务或 undefined。
 */
function safeService(ctx, name) {
  /* ctx.get() 有可能返回 undefined（服务只挂在属性上），所以不能拿到就返回 */
  try {
    const viaGet = typeof ctx?.get === 'function' ? ctx.get(name) : undefined;
    if (viaGet !== undefined && viaGet !== null) return viaGet;
  } catch {
    /* 换属性通路再试 */
  }
  try {
    return ctx?.[name];
  } catch {
    return undefined;
  }
}

/** 两条路由是否真的挂上了（挂不上时从 GET /explain 一眼看出）。 */
export const routeState = { explain: false, read: false, cards: false };

/** 运行期诊断：fs 拿没拿到、工作区根是谁。 */
export const diagState = { fs: 'unknown', resolve: 'unknown', cwd: '', root: '', cards: '' };

/**
 * 造一个失败响应体。
 * @param {string} code - 机器可读错误码。
 * @param {string} message - 人话。
 * @returns {{ok:false, error:{code:string, message:string, retryable:boolean}}} 响应体。
 */
function readFail(code, message) {
  return { ok: false, error: { code, message, retryable: false } };
}

/**
 * 路径里有没有 `..` 段（越权第一道闸；第二道是 fs.contains）。
 * @param {string} raw - 原始路径（已解码）。
 * @returns {boolean} 是否可疑。
 */
export function hasTraversal(raw) {
  const text = typeof raw === 'string' ? raw.replace(/\\/gu, '/') : '';
  return text.split('/').some((segment) => segment === '..');
}

/**
 * 取小写后缀（含点）。没有后缀返回空串。
 * @param {string} raw - 路径。
 * @returns {string} 例如 `.md`。
 */
export function extensionOf(raw) {
  const text = typeof raw === 'string' ? raw : '';
  const slash = Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\'));
  const dot = text.lastIndexOf('.');
  if (dot <= slash || dot === text.length - 1) return '';
  return text.slice(dot).toLowerCase();
}

/**
 * 把 streamText 的返回值收敛成一段文本。
 *
 * 宿主可能给字符串、异步可迭代、Web Stream、Node Readable 或 `{text}` 包装，
 * 这里全部认；边收边计数，超过上限立刻抛 `too-large`（不把 2MB 读进内存再说）。
 *
 * @param {unknown} source - streamText 的返回。
 * @param {number} [maxBytes] - 上限。
 * @returns {Promise<{text:string, bytes:number}>} 文本与字节数。
 */
export async function collectText(source, maxBytes = MAX_FILE_BYTES) {
  if (typeof source === 'string') {
    const bytes = Buffer.byteLength(source, 'utf8');
    if (bytes > maxBytes) throw Object.assign(new Error('文件超过大小上限'), { code: 'too-large' });
    return { text: source, bytes };
  }
  if (source !== null && typeof source === 'object' && typeof source.text === 'string') {
    return collectText(source.text, maxBytes);
  }

  const chunks = [];
  let bytes = 0;
  let settled = false;
  const append = (piece) => {
    if (settled) return;
    const buffer = Buffer.isBuffer(piece) ? piece : Buffer.from(String(piece), 'utf8');
    bytes += buffer.length;
    if (bytes > maxBytes) {
      throw Object.assign(new Error('文件超过大小上限'), { code: 'too-large' });
    }
    chunks.push(buffer);
  };

  if (source !== null && typeof source === 'object' && typeof source[Symbol.asyncIterator] === 'function') {
    for await (const piece of source) append(piece);
    return { text: Buffer.concat(chunks).toString('utf8'), bytes };
  }

  if (source !== null && typeof source === 'object' && typeof source.getReader === 'function') {
    const reader = source.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done === true) break;
      append(value);
    }
    return { text: Buffer.concat(chunks).toString('utf8'), bytes };
  }

  if (source !== null && typeof source === 'object' && typeof source.on === 'function') {
    await new Promise((resolve, reject) => {
      const stop = (error) => {
        if (settled) return;
        settled = true;
        try {
          source.destroy?.();
        } catch {
          /* 已经结束 */
        }
        reject(error);
      };
      source.on('data', (piece) => {
        try {
          append(piece);
        } catch (error) {
          stop(error);
        }
      });
      source.on('end', () => {
        if (settled) return;
        settled = true;
        resolve(undefined);
      });
      source.on('error', stop);
    });
    return { text: Buffer.concat(chunks).toString('utf8'), bytes };
  }

  throw Object.assign(new Error('宿主没有给出可读的文本流'), { code: 'read-error' });
}

/**
 * 找当前工作区根目录。
 *
 * 宿主没有把 workspace 作为稳定服务暴露时，退回进程 cwd——两者在桌面端通常一致。
 * @param {object} ctx - cordis 上下文。
 * @returns {string} 根目录。
 */
export function workspaceRootOf(ctx) {
  const candidates = [];
  try {
    const workspace = safeService(ctx, 'workspace');
    if (workspace !== null && workspace !== undefined && typeof workspace === 'object') {
      candidates.push(workspace.root, workspace.path, workspace.directory, workspace.cwd,
        workspace.current?.path, workspace.current?.root);
    }
  } catch {
    /* 没这个服务就算了 */
  }
  /* 兜底：有的宿主只把根目录挂在 ctx.workspace 上，同样要防它抛 */
  try {
    const direct = ctx?.workspace;
    if (direct !== null && direct !== undefined) candidates.push(direct.root, direct.path);
  } catch {
    /* 代理拒绝访问就不问了 */
  }
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate !== '') return candidate;
  }
  return typeof process !== 'undefined' && typeof process.cwd === 'function' ? process.cwd() : '.';
}

/**
 * 造 `GET /knowledge-nest/read?path=…` 的 handler。
 *
 * 四道闸，顺序固定：同源 → 方法 → 路径形状 → 后缀 → 工作区归属 → 大小。
 * 注意这里**不抛 NestError**：文件错误的语义（403/413/415）和模型错误的映射不一样。
 *
 * @param {{fs:object, workspaceRoot:string, maxBytes?:number}} deps - 依赖。
 * @returns {Function} (req, res) => Promise<void>
 */
export function createReadHandler(deps) {
  const fs = deps?.fs;
  const workspaceRoot = typeof deps?.workspaceRoot === 'string' && deps.workspaceRoot !== '' ? deps.workspaceRoot : '.';
  const maxBytes = Number.isFinite(deps?.maxBytes) ? deps.maxBytes : MAX_FILE_BYTES;

  return async function readHandler(req, res) {
    if (!originAllowed(req)) {
      sendJson(res, 403, readFail('cross-origin', '跨源请求被拒绝'));
      return;
    }
    if (req.method !== 'GET') {
      res.writeHead(405, { allow: 'GET', 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(readFail('method', '只支持 GET')));
      return;
    }

    let url = null;
    try {
      url = new URL(typeof req.url === 'string' ? req.url : '/', 'http://knest.local');
    } catch {
      sendJson(res, 400, readFail('bad-request', '请求地址不合法'));
      return;
    }

    const raw = url.searchParams.get('path') ?? '';
    if (raw.trim() === '') {
      sendJson(res, 400, readFail('bad-request', '缺少 path 参数'));
      return;
    }
    if (raw.includes('\0')) {
      sendJson(res, 400, readFail('bad-request', '路径含非法字符'));
      return;
    }
    if (hasTraversal(raw)) {
      sendJson(res, 403, readFail('forbidden', '路径里不允许出现 ..'));
      return;
    }

    const extension = extensionOf(raw);
    if (!TEXT_EXTENSIONS.has(extension)) {
      sendJson(res, 415, readFail('unsupported-type', `不支持的文件类型：${extension === '' ? '无后缀' : extension}`));
      return;
    }

    let target = '';
    try {
      if (typeof fs?.resolve !== 'function') {
        sendJson(res, 503, readFail('fs-unavailable', '宿主没有提供文件系统服务（ctx.fs 不可用）'));
        return;
      }
      const resolved = await fs.resolve(raw);
      target = typeof resolved === 'string' ? resolved : String(resolved?.path ?? '');
    } catch (error) {
      const detail = typeof error?.message === 'string' ? error.message : String(error);
      sendJson(res, 404, readFail('not-found', `文件不存在或无法解析：${detail}`));
      return;
    }
    if (target === '') {
      sendJson(res, 404, readFail('not-found', '文件不存在或无法解析：宿主没给出绝对路径'));
      return;
    }

    let inside = false;
    try {
      inside = (await fs.contains(workspaceRoot, target)) === true;
    } catch {
      inside = false;
    }
    if (!inside) {
      sendJson(res, 403, readFail('forbidden', '这个路径不在当前工作区内'));
      return;
    }

    let info = null;
    try {
      info = await fs.stat(target);
    } catch {
      sendJson(res, 404, readFail('not-found', '文件不存在'));
      return;
    }
    if (typeof info?.type === 'string' && info.type !== 'file') {
      sendJson(res, 400, readFail('bad-request', '这不是一个普通文件'));
      return;
    }
    if (Number(info?.size) > maxBytes) {
      sendJson(res, 413, readFail('too-large', `文件超过 ${Math.round(maxBytes / 1024)}KB`));
      return;
    }

    try {
      const source = await fs.streamText(target);
      const { text, bytes } = await collectText(source, maxBytes);
      sendJson(res, 200, { ok: true, text, path: target, bytes, extension });
    } catch (error) {
      const code = typeof error?.code === 'string' ? error.code : 'read-error';
      if (code === 'too-large') {
        sendJson(res, 413, readFail('too-large', `文件超过 ${Math.round(maxBytes / 1024)}KB`));
        return;
      }
      const message = typeof error?.message === 'string' ? error.message : String(error);
      sendJson(res, 500, readFail('read-error', `读取失败：${message}`));
    }
  };
}

/**
 * 造 `POST /knowledge-nest/annotations` 的 handler。
 *
 * 只写 AGENTS.local.md 里的标记块；空数组表示"把块删掉"。
 * @param {{workspaceRoot:string, file?:string}} deps - 依赖。
 * @returns {Function} (req, res) => Promise<void>
 */
export function createAnnotationsHandler(deps) {
  const workspaceRoot = typeof deps?.workspaceRoot === 'string' && deps.workspaceRoot !== '' ? deps.workspaceRoot : '.';
  const file = typeof deps?.file === 'string' && deps.file !== '' ? deps.file : 'AGENTS.local.md';

  return async function annotationsHandler(req, res) {
    if (!originAllowed(req)) {
      sendJson(res, 403, readFail('cross-origin', '跨源请求被拒绝'));
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { allow: 'POST', 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(readFail('method', '只支持 POST')));
      return;
    }
    let body = {};
    try {
      const raw = await readBody(req);
      const trimmed = raw.trim();
      body = trimmed === '' ? {} : JSON.parse(trimmed);
    } catch {
      sendJson(res, 400, readFail('bad-json', '请求体不是合法 JSON'));
      return;
    }
    try {
      const result = writeAnnotations({
        workspaceRoot,
        file,
        entries: Array.isArray(body?.entries) ? body.entries : [],
        window: body?.window === 'user' ? 'user' : 'assistant',
      });
      sendJson(res, 200, { ok: true, ...result });
    } catch (error) {
      const message = typeof error?.message === 'string' ? error.message : String(error);
      sendJson(res, 500, readFail('write-error', '写入失败：' + message));
    }
  };
}

/**
 * 造 `/knowledge-nest/cards` 的 handler：GET 搜索、POST 写入。
 * @param {{store:object}} deps - 卡片仓库。
 * @returns {Function} (req, res) => Promise<void>
 */
export function createCardsHandler(deps) {
  const store = deps?.store;
  return async function cardsHandler(req, res) {
    if (!originAllowed(req)) {
      sendJson(res, 403, readFail('cross-origin', '跨源请求被拒绝'));
      return;
    }
    if (store === undefined || store === null) {
      sendJson(res, 503, readFail('store-unavailable', '卡片仓库不可用'));
      return;
    }
    if (req.method === 'GET') {
      let url = null;
      try {
        url = new URL(typeof req.url === 'string' ? req.url : '/', 'http://knest.local');
      } catch {
        sendJson(res, 400, readFail('bad-request', '请求地址不合法'));
        return;
      }
      const query = url.searchParams.get('q') ?? '';
      const domain = url.searchParams.get('domain') ?? '';
      const limit = Number(url.searchParams.get('limit') ?? 0) || undefined;
      try {
        const rows = store.search(query, { domain, limit });
        sendJson(res, 200, { ok: true, rows, stats: store.stats() });
      } catch (error) {
        sendJson(res, 500, readFail('read-error', String(error?.message ?? error)));
        return;
      }
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { allow: 'GET, POST', 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(readFail('method', '只支持 GET / POST')));
      return;
    }
    let body = {};
    try {
      const raw = await readBody(req);
      const trimmed = raw.trim();
      body = trimmed === '' ? {} : JSON.parse(trimmed);
    } catch {
      sendJson(res, 400, readFail('bad-json', '请求体不是合法 JSON'));
      return;
    }
    try {
      const result = store.upsert(Array.isArray(body?.cards) ? body.cards : [body?.card ?? body]);
      sendJson(res, 200, { ok: true, ...result });
    } catch (error) {
      sendJson(res, 500, readFail('write-error', String(error?.message ?? error)));
    }
  };
}

/**
 * 插件入口。
 * @param {object} ctx - cordis 上下文（已注入 webServer + fs）。
 * @param {object} [config] - loader 给的插件配置（目前只用 model 覆盖）。
 * @returns {void}
 */
export function apply(ctx, config) {
  const explainer = createExplainer({
    model: typeof config?.model === 'string' ? config.model : undefined,
  });
  const handler = createRouteHandler({ explainer });

  const warn = (error) => {
    const message = error !== null && error !== undefined && typeof error.message === 'string'
      ? error.message
      : String(error);
    console.warn('[dsh-knowledge-nest] 路由注册失败：' + message);
  };

  try {
    ctx.effect(() => {
      try {
        const dispose = ctx.webServer.register({ kind: 'exact', path: EXPLAIN_PATH, handler });
        routeState.explain = true;
        return () => {
          routeState.explain = false;
          return typeof dispose === 'function' ? dispose() : undefined;
        };
      } catch (error) {
        warn(error);
        return () => {};
      }
    });
  } catch (error) {
    warn(error);
  }

  /* 文件读取通道：只读、只读文本、只读工作区内。 */
  try {
    const fsService = safeService(ctx, 'fs');
    diagState.fs = fsService === undefined || fsService === null ? 'missing' : typeof fsService;
    diagState.resolve = typeof fsService?.resolve;
    diagState.cwd = typeof process !== 'undefined' && typeof process.cwd === 'function' ? process.cwd() : '';
    diagState.root = workspaceRootOf(ctx);
    const readHandler = createReadHandler({ fs: fsService, workspaceRoot: diagState.root });
    ctx.effect(() => {
      try {
        const dispose = ctx.webServer.register({ kind: 'exact', path: READ_PATH, handler: readHandler });
        routeState.read = true;
        return () => {
          routeState.read = false;
          return typeof dispose === 'function' ? dispose() : undefined;
        };
      } catch (error) {
        warn(error);
        return () => {};
      }
    });
  } catch (error) {
    warn(error);
  }

  /* 卡片仓库：$DSH_HOME/knowledge-nest/cards.jsonl */
  try {
    const home = typeof process !== 'undefined' && process.env?.DSH_HOME
      ? process.env.DSH_HOME
      : (typeof process !== 'undefined' && typeof process.cwd === 'function' ? process.cwd() : '.');
    const store = createCardStore({ dir: join(home, 'knowledge-nest') });
    diagState.cards = store.file;
    const cardsHandler = createCardsHandler({ store });
    ctx.effect(() => {
      try {
        const dispose = ctx.webServer.register({ kind: 'exact', path: CARDS_PATH, handler: cardsHandler });
        routeState.cards = true;
        return () => {
          routeState.cards = false;
          return typeof dispose === 'function' ? dispose() : undefined;
        };
      } catch (error) {
        warn(error);
        return () => {};
      }
    });
  } catch (error) {
    warn(error);
  }

  /* 批注落盘：把摘要写进工作区的 AGENTS.local.md 标记块。 */
  try {
    const annotationsHandler = createAnnotationsHandler({ workspaceRoot: diagState.root, file: config?.annotationsFile });
    ctx.effect(() => {
      try {
        return ctx.webServer.register({ kind: 'exact', path: ANNOTATE_PATH, handler: annotationsHandler });
      } catch (error) {
        warn(error);
        return () => {};
      }
    });
  } catch (error) {
    warn(error);
  }
}
