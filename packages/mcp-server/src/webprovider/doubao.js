/**
 * 豆包网页版 provider：借用浏览器里已登录的会话，把问题发给豆包，拿回文本。
 *
 * 为什么这么绕：豆包没有公开 API，但实测它的 `/chat/completion` 只要带上登录 Cookie 就能用，
 * 而且不需要 a_bogus 签名、不需要 msToken。于是走「CDP 连到登录着的页面，在页面上下文里发 fetch」。
 *
 * 前提（绕不开）：浏览器开着 doubao.com 且已登录。凭据在 Cookie 里，没有替代品。
 *
 * 实测记录见 docs/WEB-MODEL-PROBE.md。
 */

import { DOUBAO_BODY_TEMPLATE } from './doubao-template.js';

/** 默认调试端口。 */
export const DEFAULT_CDP_PORT = 9335;

/** 从抓包得来的基础参数，缺一不可但也不需要更多。 */
const BASE_PARAMS = {
  aid: '497858',
  device_platform: 'web',
  samantha_web: '1',
  version_code: '20800',
  pc_version: '3.44.8',
  web_platform: 'browser',
};

/**
 * 生成一个 uuid。
 * @returns {string} uuid。
 */
function uuid() {
  return globalThis.crypto?.randomUUID?.()
    ?? 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/gu, (char) => {
      const value = (Math.random() * 16) | 0;
      return (char === 'x' ? value : ((value & 0x3) | 0x8)).toString(16);
    });
}

/**
 * 在页面里跑这段：构造请求、发出去、把 SSE 拼成完整回答。
 *
 * 这段字符串会被塞进 Runtime.evaluate，所以必须自包含，不能引用外部变量。
 */
function pageScript(prompt, timeoutMs) {
  return `(async () => {
    const uuid = () => (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = Math.random()*16|0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16); }));
    const template = ${JSON.stringify(DOUBAO_BODY_TEMPLATE)};
    const body = JSON.parse(JSON.stringify(template));
    body.messages[0].local_message_id = uuid();
    body.messages[0].content_block[0].block_id = uuid();
    body.messages[0].content_block[0].content.text_block.text = ${JSON.stringify(prompt)};
    body.client_meta.local_conversation_id = 'local_' + Math.floor(Math.random() * 1e16);
    body.option.create_time_ms = Date.now();
    body.option.unique_key = uuid();

    const url = new URL('https://www.doubao.com/chat/completion');
    const params = ${JSON.stringify(BASE_PARAMS)};
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set('web_tab_id', uuid());

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ${Number(timeoutMs) || 60000});
    try {
      const res = await fetch(url.toString(), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'include',
        signal: controller.signal,
      });
      if (!res.ok) {
        const t = await res.text();
        return JSON.stringify({ ok: false, code: 'http', status: res.status, message: t.slice(0, 300) });
      }
      /* 一次性读完再解析。
         流式 reader 在这里会提前退出：豆包每个 chunk 只吐一两个字，
         中途还插「正在搜索」「搜索结果」这类块，边读边拼很容易漏掉后半段。 */
      const rawBody = await res.text();
      const lines = rawBody.split('\\n');
      let answer = '';
      let event = '';
      let sawError = '';
      for (const line of lines) {
        if (line.startsWith('event: ')) { event = line.slice(7).trim(); continue; }
        if (!line.startsWith('data: ')) continue;
        const dataText = line.slice(6);
        if (event === 'STREAM_ERROR') { sawError = dataText.slice(0, 200); continue; }
        if (event !== 'STREAM_CHUNK' && event !== 'STREAM_MSG_NOTIFY' && event !== 'FULL_MSG_NOTIFY') continue;
        let payload = null;
        try { payload = JSON.parse(dataText); } catch { continue; }
        const ops = Array.isArray(payload?.patch_op) ? payload.patch_op : [];
        for (const op of ops) {
          const blocks = op?.patch_value?.content_block;
          if (!Array.isArray(blocks)) continue;
          for (const block of blocks) {
            /* block_type 10000 才是正文；10101 是「正在搜索」，10025 是搜索结果的出处 */
            if (block?.block_type !== 10000) continue;
            const text = block?.content?.text_block?.text;
            if (typeof text === 'string' && text !== '') answer += text;
          }
        }
      }
      if (answer === '' && sawError !== '') {
        return JSON.stringify({ ok: false, code: 'stream-error', message: sawError });
      }
      return JSON.stringify({ ok: true, answer });
    } catch (e) {
      return JSON.stringify({ ok: false, code: e.name === 'AbortError' ? 'timeout' : 'network', message: String(e.message).slice(0, 200) });
    } finally {
      clearTimeout(timer);
    }
  })()`;
}

/**
 * 打开一条到指定页面的 CDP 连接。
 * @param {number} port - 调试端口。
 * @param {string} match - 页面 URL 里要包含的片段。
 * @returns {Promise<{call:Function, close:Function, page:object}>} 连接。
 */
async function connect(port, match = 'doubao') {
  let list;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(3000) });
    list = await res.json();
  } catch {
    throw Object.assign(new Error(`连不上浏览器调试端口 ${port}。用 --remote-debugging-port=${port} 启动浏览器并打开豆包。`), { code: 'no-browser' });
  }
  const page = list.find((item) => item.type === 'page' && (item.url ?? '').includes(match));
  if (page === undefined) {
    throw Object.assign(new Error(`没找到豆包页面。在浏览器里打开 https://www.doubao.com/chat/ 并登录。`), { code: 'no-page' });
  }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(Object.assign(new Error('连不上页面'), { code: 'no-page' })), { once: true });
  });

  let seq = 0;
  const pending = new Map();
  ws.addEventListener('message', (event) => {
    const payload = JSON.parse(event.data);
    if (payload.id === undefined) return;
    const waiter = pending.get(payload.id);
    if (waiter === undefined) return;
    pending.delete(payload.id);
    payload.error ? waiter.reject(new Error(JSON.stringify(payload.error))) : waiter.resolve(payload.result);
  });

  const call = (method, params) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`${method} 超时`));
      }
    }, 180_000);
  });

  return { call, close: () => ws.close(), page };
}

/**
 * 问豆包一句话，拿回纯文本。
 *
 * @param {{prompt:string, port?:number, timeoutMs?:number}} options - 参数。
 * @returns {Promise<{ok:boolean, text?:string, code?:string, message?:string}>} 结果。
 */
export async function askDoubao(options) {
  const port = Number(options?.port ?? DEFAULT_CDP_PORT);
  const prompt = typeof options?.prompt === 'string' ? options.prompt.trim() : '';
  if (prompt === '') return { ok: false, code: 'bad-request', message: '问题是空的' };

  let conn;
  try {
    conn = await connect(port);
  } catch (error) {
    return { ok: false, code: error?.code ?? 'no-browser', message: String(error?.message ?? error) };
  }

  try {
    const result = await conn.call('Runtime.evaluate', {
      expression: pageScript(prompt, options?.timeoutMs ?? 60_000),
      returnByValue: true,
      awaitPromise: true,
    });
    if (result?.exceptionDetails !== undefined) {
      return { ok: false, code: 'script', message: JSON.stringify(result.exceptionDetails).slice(0, 300) };
    }
    const raw = result?.result?.value;
    if (typeof raw !== 'string') return { ok: false, code: 'empty', message: '页面没返回东西' };
    const parsed = JSON.parse(raw);
    if (parsed.ok !== true) return { ok: false, code: parsed.code ?? 'error', message: parsed.message ?? '' };
    const text = String(parsed.answer ?? '').trim();
    if (text === '') return { ok: false, code: 'empty', message: '豆包没有返回内容' };
    return { ok: true, text };
  } catch (error) {
    return { ok: false, code: 'network', message: String(error?.message ?? error).slice(0, 200) };
  } finally {
    conn.close();
  }
}

/**
 * 检查这个 provider 现在能不能用（浏览器开着、页面在、登录着）。
 * @param {{port?:number}} [options] - 参数。
 * @returns {Promise<{ok:boolean, code?:string, message:string, page?:string}>} 状态。
 */
export async function probeDoubao(options = {}) {
  const port = Number(options.port ?? DEFAULT_CDP_PORT);
  let conn;
  try {
    conn = await connect(port);
  } catch (error) {
    return { ok: false, code: error?.code ?? 'no-browser', message: String(error?.message ?? error) };
  }
  try {
    const result = await conn.call('Runtime.evaluate', {
      expression: `(() => {
        const txt = document.body.innerText || '';
        return JSON.stringify({
          url: location.href,
          loggedIn: !/^\\s*登录\\s*$/m.test(txt),
          hasEditor: !!document.querySelector('[contenteditable="true"]'),
        });
      })()`,
      returnByValue: true,
    });
    const state = JSON.parse(result?.result?.value ?? '{}');
    if (state.loggedIn !== true) {
      return { ok: false, code: 'not-logged-in', message: '浏览器里的豆包没登录，先扫码登录', page: state.url };
    }
    return { ok: true, message: '可以用', page: state.url };
  } finally {
    conn.close();
  }
}
