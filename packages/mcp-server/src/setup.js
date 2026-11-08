/**
 * 本地配置页：给没有 UI 的 MCP 客户端补一个能填钥匙的界面。
 *
 * 为什么这么做：MCP 只能传文本回文本，客户端不会给我们画界面的入口。
 * 但 stdio server 是本地进程，它自己可以监听一个回环端口，用户用浏览器打开就行。
 *
 * 约束：
 *   - 只监听 127.0.0.1，不对外；
 *   - 每次打开带一个一次性令牌，防止别的网页偷偷 POST 过来；
 *   - 钥匙写进 config.json 后立刻生效（每次调用都会重新读配置）。
 */
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname } from 'node:path';

import { LOCAL_PRESETS, configPath, createModelProvider, isLocalEndpoint, knestHome, maskKey, resolveModel } from './model.js';
import { createExplainer } from '../../../lib/explain.js';

/** 默认端口。 */
export const DEFAULT_SETUP_PORT = 7332;

/** 供应商预设（配置页上的选项）。 */
const PRESETS = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    hint: '最省事：地址与模型都有默认值，只要一把钥匙',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-flash',
    keyLabel: 'sk-...',
    needsKey: true,
  },
  {
    id: 'custom',
    label: '其他 OpenAI 兼容接口',
    hint: '自己填地址、模型与钥匙。阿里云、硅基流动、自家网关都算',
    baseUrl: '',
    model: '',
    keyLabel: 'sk-...',
    needsKey: true,
  },
  {
    id: 'ollama',
    label: '本机 Ollama',
    hint: '不花钱，也不出网。需要先在本机跑着 Ollama',
    baseUrl: LOCAL_PRESETS.ollama.baseUrl,
    model: '',
    keyLabel: '不需要',
    needsKey: false,
  },
  {
    id: 'lmstudio',
    label: '本机 LM Studio',
    hint: '同样不花钱。在 LM Studio 里启动本地服务后再选这个',
    baseUrl: LOCAL_PRESETS.lmstudio.baseUrl,
    model: '',
    keyLabel: '不需要',
    needsKey: false,
  },
];

/**
 * 读当前配置（给页面回显用，钥匙只回掩码）。
 * @param {Record<string,string|undefined>} env - 环境变量。
 * @returns {object} 状态。
 */
function readState(env) {
  const model = resolveModel(env);
  const file = configPath(env);
  let saved = {};
  try {
    if (existsSync(file)) {
      saved = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/u, ''));
    }
  } catch {
    saved = {};
  }
  return {
    home: knestHome(env),
    configPath: file,
    configExists: existsSync(file),
    effective: {
      baseUrl: model.baseUrl,
      model: model.model,
      source: model.source,
      keyMasked: maskKey(model.apiKey),
      timeoutMs: model.timeoutMs,
    },
    saved: {
      baseUrl: typeof saved.baseUrl === 'string' ? saved.baseUrl : '',
      model: typeof saved.model === 'string' ? saved.model : '',
      apiKeyMasked: maskKey(typeof saved.apiKey === 'string' ? saved.apiKey : ''),
      maxTokens: saved.maxTokens ?? '',
      timeoutMs: saved.timeoutMs ?? '',
    },
    presets: PRESETS,
  };
}

/**
 * 写配置。只覆盖用户填了的字段，其余保留。
 * @param {Record<string,string|undefined>} env - 环境变量。
 * @param {{preset?:string, baseUrl?:string, model?:string, apiKey?:string, timeoutMs?:number, maxTokens?:number}} input - 表单。
 * @returns {{ok:boolean, message:string, state?:object}} 结果。
 */
function saveConfig(env, input) {
  const presetId = typeof input?.preset === 'string' ? input.preset : '';
  const preset = PRESETS.find((item) => item.id === presetId) ?? null;

  const baseUrl = String(input?.baseUrl ?? '').trim() || preset?.baseUrl || '';
  const model = String(input?.model ?? '').trim() || preset?.model || '';
  const apiKey = String(input?.apiKey ?? '').trim();

  const file = configPath(env);
  let current = {};
  try {
    if (existsSync(file)) current = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/u, ''));
  } catch {
    current = {};
  }

  const existingKey = typeof current.apiKey === 'string' ? current.apiKey.trim() : '';

  if (baseUrl === '') return { ok: false, message: '接口地址不能为空' };
  if (model === '') return { ok: false, message: '模型名不能为空' };
  /* 留空 = 沿用已保存的钥匙。以前这里会直接拒绝，用户只好每次重贴 */
  if (!isLocalEndpoint(baseUrl) && apiKey === '' && existingKey === '') {
    return { ok: false, message: '远程接口需要钥匙（第一次填写后再改模型可以留空）' };
  }

  const next = {
    ...current,
    baseUrl,
    model,
    /* 本地端点不需要钥匙；远程端点必须写 */
    apiKey: isLocalEndpoint(baseUrl) ? (apiKey === '' ? 'local' : apiKey) : (apiKey === '' ? existingKey : apiKey),
  };
  if (input?.timeoutMs !== undefined && input.timeoutMs !== '') {
    const value = Number(input.timeoutMs);
    if (Number.isFinite(value)) next.timeoutMs = Math.min(Math.max(value, 5_000), 600_000);
  }
  if (input?.maxTokens !== undefined && input.maxTokens !== '') {
    const value = Number(input.maxTokens);
    if (Number.isFinite(value)) next.maxTokens = Math.min(Math.max(value, 200), 4_000);
  }
  delete next.enabled;
  next.enabled = true;

  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return { ok: true, message: `已写入 ${file}`, state: readState(env) };
}

/**
 * 试一次真实请求，确认这套参数能出话。
 * @param {{baseUrl:string, model:string, apiKey:string, timeoutMs?:number}} input - 参数。
 * @returns {Promise<{ok:boolean, message:string, detail?:string}>} 结果。
 */
async function testConnection(input) {
  const baseUrl = String(input?.baseUrl ?? '').trim().replace(/\/+$/u, '');
  const model = String(input?.model ?? '').trim();
  const apiKey = String(input?.apiKey ?? '').trim();
  const timeoutMs = Number(input?.timeoutMs) || 20_000;
  if (baseUrl === '' || model === '') return { ok: false, message: '先填地址与模型名' };

  const started = Date.now();
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(apiKey === '' || apiKey === 'local' ? {} : { authorization: `Bearer ${apiKey}` }),
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: '回一个字：好' }],
        max_tokens: 16,
        stream: false,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    const ms = Date.now() - started;
    if (!res.ok) {
      return { ok: false, message: `接口回了 ${res.status}`, detail: text.slice(0, 300) };
    }
    let said = '';
    try {
      said = JSON.parse(text)?.choices?.[0]?.message?.content ?? '';
    } catch {
      said = '';
    }
    return { ok: true, message: `${ms}ms 内拿到回复`, detail: String(said).slice(0, 80) };
  } catch (error) {
    return { ok: false, message: '连不上', detail: String(error?.message ?? error).slice(0, 200) };
  }
}

/**
 * 配置页的 HTML。
 * @param {string} token - 一次性令牌。
 * @returns {string} HTML。
 */
function pageHtml(token) {
  return `<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>词林 · 配置</title>
<style>
:root{--bg:#0f1115;--panel:#171a21;--line:#262b36;--ink:#e6e9ef;--dim:#8d94a3;--brand:#4d7cff;--ok:#3ecf8e;--bad:#ff6b6b}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.7 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
.wrap{max-width:720px;margin:0 auto;padding:32px 20px 64px}
h1{font-size:20px;margin:0 0 6px}
.sub{color:var(--dim);font-size:13px;margin-bottom:24px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:18px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px 14px;cursor:pointer;transition:.15s}
.card:hover{border-color:#3a4354}
.card[data-on="1"]{border-color:var(--brand);box-shadow:0 0 0 1px var(--brand) inset}
.card b{display:block;font-weight:600;margin-bottom:2px}
.card span{color:var(--dim);font-size:12px}
label{display:block;font-size:13px;color:var(--dim);margin:14px 0 6px}
input{width:100%;background:#0c0e13;border:1px solid var(--line);border-radius:8px;color:var(--ink);padding:9px 11px;font:inherit;outline:none}
input:focus{border-color:var(--brand)}
.row{display:flex;gap:10px}
.row>div{flex:1}
button{background:var(--brand);border:0;color:#fff;border-radius:8px;padding:10px 18px;font:inherit;cursor:pointer;font-weight:600}
button:disabled{opacity:.5;cursor:default}
button.ghost{background:transparent;border:1px solid var(--line);color:var(--ink);font-weight:500}
.actions{display:flex;gap:10px;margin-top:22px;align-items:center}
.msg{margin-top:16px;padding:11px 13px;border-radius:8px;font-size:13px;display:none;white-space:pre-wrap;word-break:break-all}
.msg[data-kind="ok"]{display:block;background:rgba(62,207,142,.1);border:1px solid rgba(62,207,142,.35)}
.msg[data-kind="bad"]{display:block;background:rgba(255,107,107,.1);border:1px solid rgba(255,107,107,.35)}
.now{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin-bottom:22px;font-size:13px}
.now code{color:var(--brand);font-size:12px}
.now div{margin:3px 0;color:var(--dim)}
.now b{color:var(--ink);font-weight:500}
</style></head><body><div class="wrap">
<h1>词林 · 配置</h1>
<div class="sub">这个页面只在本机打开，钥匙写进 config.json，不经过任何服务器。</div>
<div class="now" id="now">读取中…</div>
<div class="grid" id="presets"></div>

<div id="form">
  <label>接口地址（base_url，OpenAI 兼容）</label>
  <input id="baseUrl" placeholder="https://api.deepseek.com">
  <label>模型名</label>
  <input id="model" placeholder="deepseek-flash">
  <label id="keyLabel">钥匙</label>
  <input id="apiKey" type="password" placeholder="sk-...">
  <div class="row">
    <div><label>超时（毫秒，可选）</label><input id="timeoutMs" placeholder="45000"></div>
    <div><label>回答上限 token（可选）</label><input id="maxTokens" placeholder="700"></div>
  </div>
  <div class="actions">
    <button id="save">保存并测试</button>
    <button class="ghost" id="testOnly">只测试</button>
  </div>
</div>
<div class="msg" id="msg"></div>
</div>
<script>
const TOKEN = ${JSON.stringify(token)};
const $ = (id) => document.getElementById(id);
let picked = 'deepseek';
let state = null;

function say(kind, text) {
  const box = $('msg');
  box.dataset.kind = kind;
  box.textContent = text;
}

function paintNow(s) {
  const eff = s.effective;
  $('now').innerHTML =
    '<div>配置目录 <b>' + s.home + '</b></div>' +
    '<div>当前生效 <b>' + (eff.baseUrl || '（未配置）') + '</b> · ' + (eff.model || '（无模型）') + '</div>' +
    '<div>钥匙 ' + (eff.keyMasked || '（无）') + ' · 来源 ' + eff.source + '</div>';
}

function pick(id) {
  picked = id;
  const preset = state.presets.find((p) => p.id === id);
  document.querySelectorAll('.card').forEach((el) => { el.dataset.on = el.dataset.id === id ? '1' : '0'; });
  $('baseUrl').value = preset.baseUrl || '';
  $('model').value = preset.model || state.saved.model || '';
  $('keyLabel').textContent = preset.needsKey ? '钥匙' : '钥匙（本机端点不需要，留空即可）';
  $('apiKey').placeholder = preset.needsKey ? 'sk-...' : '留空';
}

async function load() {
  const res = await fetch('/state?token=' + encodeURIComponent(TOKEN));
  state = await res.json();
  paintNow(state);
  $('presets').innerHTML = state.presets.map((p) =>
    '<div class="card" data-id="' + p.id + '" data-on="0"><b>' + p.label + '</b><span>' + p.hint + '</span></div>'
  ).join('');
  document.querySelectorAll('.card').forEach((el) => {
    el.addEventListener('click', () => pick(el.dataset.id));
  });
  if (state.saved.baseUrl) {
    const guess = state.presets.find((p) => p.baseUrl && state.saved.baseUrl.startsWith(p.baseUrl.replace(/\\/v1$/,'')));
    pick(guess ? guess.id : 'custom');
    $('baseUrl').value = state.saved.baseUrl;
    $('model').value = state.saved.model;
  } else {
    pick('deepseek');
  }
  if (state.saved.timeoutMs) $('timeoutMs').value = state.saved.timeoutMs;
  if (state.saved.maxTokens) $('maxTokens').value = state.saved.maxTokens;
}

async function post(path, body) {
  const res = await fetch(path + '?token=' + encodeURIComponent(TOKEN), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

function form() {
  return {
    preset: picked,
    baseUrl: $('baseUrl').value,
    model: $('model').value,
    apiKey: $('apiKey').value,
    timeoutMs: $('timeoutMs').value,
    maxTokens: $('maxTokens').value,
  };
}

$('save').addEventListener('click', async () => {
  $('save').disabled = true;
  say('ok', '正在保存…');
  const saved = await post('/save', form());
  if (!saved.ok) { say('bad', saved.message); $('save').disabled = false; return; }
  paintNow(saved.state);
  say('ok', saved.message + '\\n正在测试…');
  const tested = await post('/test', form());
  say(tested.ok ? 'ok' : 'bad',
    (tested.ok ? '保存成功，测试通过：' : '已保存，但测试没过：') + tested.message +
    (tested.detail ? '\\n' + tested.detail : ''));
  $('save').disabled = false;
});

$('testOnly').addEventListener('click', async () => {
  $('testOnly').disabled = true;
  say('ok', '正在测试…');
  const tested = await post('/test', form());
  say(tested.ok ? 'ok' : 'bad', tested.message + (tested.detail ? '\\n' + tested.detail : ''));
  $('testOnly').disabled = false;
});

load().catch((err) => say('bad', '页面读取失败：' + err.message));
</script></body></html>`;
}

/**
 * 起配置页服务。
 *
 * @param {{env?:Record<string,string|undefined>, port?:number, onSaved?:Function}} [options] - 配置。
 * @returns {Promise<{port:number, url:string, close:Function}|null>} 成功返回句柄；端口被占用返回 null。
 */
export async function startSetupServer(options = {}) {
  const env = options.env ?? process.env;
  const port = options.port ?? Number(env.KNEST_SETUP_PORT ?? DEFAULT_SETUP_PORT);
  const token = randomBytes(12).toString('hex');
  /* 解释器复用本包的 provider：读的就是同一个 config.json */
  const explainer = createExplainer({ provider: createModelProvider(env), env });

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    /* 用户手拼地址时很容易带出 `//state` 这种双斜杠，规整一下再路由 */
    const path = url.pathname.replace(/\/{2,}/gu, '/').replace(/\/$/u, '') || '/';
    const given = url.searchParams.get('token') ?? '';

    /* 注入到宿主页面里的设置面板来源是 file://，它的 Origin 是字符串 "null"。
       这类请求没有令牌可带，按来源放行；外部网页的 Origin 是域名，照样会被拒。 */
    const origin = req.headers.origin ?? '';
    /* 三种都算「本机页面」：
       - 浏览器对 file:// 页面发跨源请求时，Origin 是字符串 "null"；
       - 有的版本直接不带这个头（空串）；
       - 少数环境写成 file://。
       外部网页一定会带自己的域名，落不到这三个分支里。 */
    const fromLocalPage = origin === 'null' || origin === 'file://' || origin === '';
    const cors = {
      'access-control-allow-origin': 'null',
      'access-control-allow-headers': 'content-type',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'cache-control': 'no-store',
    };

    /* 预检：跨源 POST 必过这一关，不回就直接失败 */
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors);
      res.end();
      return;
    }

    if (given !== token && fromLocalPage !== true) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8', ...cors });
      res.end('令牌不对，请从终端里那条带 token 的地址打开');
      return;
    }

    const json = (status, payload) => {
      const body = JSON.stringify(payload);
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...cors });
      res.end(body);
    };

    if (req.method === 'GET' && (path === '/' || path === '/index.html')) {
      const body = pageHtml(token);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...cors });
      res.end(body);
      return;
    }

    if (req.method === 'GET' && path === '/state') {
      json(200, readState(env));
      return;
    }

    /* 解释请求也走这个端口：界面只需要记一个地址 */
    if (req.method === 'POST' && path === '/explain') {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', async () => {
        let body = {};
        try {
          const raw = Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/u, '').trim();
          body = raw === '' ? {} : JSON.parse(raw);
        } catch {
          json(400, { ok: false, error: { code: 'bad-request', message: '请求体不是合法 JSON' } });
          return;
        }
        try {
          const result = await explainer.explain({
            phrase: body?.phrase,
            sentence: body?.sentence ?? '',
            context: body?.context ?? '',
            fingerprint: body?.fingerprint ?? '',
            mode: body?.mode ?? 'default',
            model: body?.model ?? '',
            force: body?.force === true,
            /* 语言与字数：面板切了语言，解释就用那个语言答 */
            lang: body?.lang,
            limit: body?.limit,
          });
          json(200, {
            ok: true,
            data: result.data,
            cached: result.cached === true,
            model: result.model,
            ms: result.ms,
            usage: result.usage,
          });
        } catch (error) {
          const code = typeof error?.code === 'string' ? error.code : 'internal';
          const message = typeof error?.message === 'string' ? error.message : String(error);
          json(502, { ok: false, error: { code, message } });
        }
      });
      return;
    }

    if (req.method === 'POST' && (path === '/save' || path === '/test')) {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', async () => {
        let body = {};
        try {
          /* 有些工具（PowerShell 的 ConvertTo-Json、老编辑器）会带 BOM，剥掉再解析 */
          const raw = Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/u, '').trim();
          body = raw === '' ? {} : JSON.parse(raw);
        } catch {
          json(400, { ok: false, message: '表单不是合法 JSON' });
          return;
        }
        if (path === '/save') {
          const result = saveConfig(env, body);
          if (result.ok === true && typeof options.onSaved === 'function') {
            try {
              options.onSaved(result.state);
            } catch {
              /* 忽略回调异常 */
            }
          }
          json(result.ok === true ? 200 : 400, result);
          return;
        }
        const tested = await testConnection(body);
        json(200, tested);
      });
      return;
    }

    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', ...cors });
    res.end('没有这个页面');
  });

  const ok = await new Promise((resolve) => {
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => resolve(true));
  });
  if (!ok) return null;

  return {
    port,
    url: `http://127.0.0.1:${port}/?token=${token}`,
    close: () => new Promise((resolve) => server.close(() => resolve(true))),
  };
}
