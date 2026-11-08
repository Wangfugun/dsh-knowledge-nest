#!/usr/bin/env node
/**
 * 豆包一键探测：起浏览器 → 等你扫码 → 自动发消息 → 抓请求 → 出结论。
 *
 * 你要做的只有一件事：在弹出的浏览器窗口里扫码登录豆包。
 * 其余全自动。
 *
 * 用法：
 *   node tools/doubao-probe-auto.mjs
 *   node tools/doubao-probe-auto.mjs --port=9335 --keep   # 换端口 / 结束后不关浏览器
 *
 * 产出：
 *   D:\dsh-tmp\doubao-request.json   真实请求（请求头 + 请求体）
 *   D:\dsh-tmp\doubao-report.txt     人话结论
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const portArg = argv.find((a) => a.startsWith('--port='));
const PORT = Number(portArg ? portArg.slice('--port='.length) : (process.env.PROBE_PORT ?? 9335));
const KEEP = argv.includes('--keep');
const PROFILE = 'D:\\dsh-tmp\\edge-doubao-auto';
const OUT_DIR = 'D:\\dsh-tmp';
const LOGIN_TIMEOUT_MS = 15 * 60 * 1000;

/** 找浏览器。 */
function findBrowser() {
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
  return candidates.find((item) => existsSync(item)) ?? '';
}

const log = (line = '') => console.log(line);

log('');
log('豆包 · 一键探测');
log('');

const browser = findBrowser();
if (browser === '') {
  console.error('没找到 Edge 或 Chrome。装一个再来。');
  process.exit(1);
}
log(`  浏览器   ${browser}`);

mkdirSync(PROFILE, { recursive: true });

/* 端口已被占用就先确认是谁 */
let alreadyOpen = false;
try {
  const probe = await fetch(`http://127.0.0.1:${PORT}/json/list`, { signal: AbortSignal.timeout(1500) });
  alreadyOpen = probe.ok;
} catch {
  alreadyOpen = false;
}

if (!alreadyOpen) {
  log('  启动浏览器…');
  spawn(browser, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-blink-features=AutomationControlled',
    'https://www.doubao.com/chat/',
  ], { detached: true, stdio: 'ignore' }).unref();

  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 800));
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`, { signal: AbortSignal.timeout(1500) });
      if (res.ok) { alreadyOpen = true; break; }
    } catch { /* 继续等 */ }
  }
  if (!alreadyOpen) {
    console.error('浏览器起来了但调试端口没开，确认没被安全软件拦。');
    process.exit(1);
  }
}
log(`  调试端口 ${PORT} 已就绪`);
log('');

/* 连页面 */
async function findPage() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  return list.find((item) => item.type === 'page' && (item.url ?? '').includes('doubao')) ?? null;
}

let page = await findPage();
if (page === null) {
  console.error('没找到豆包页面。手动在新窗口打开 https://www.doubao.com/chat/ 再跑一次。');
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve);
  ws.addEventListener('error', () => reject(new Error('连不上页面')));
});

let seq = 0;
const pending = new Map();
const captured = [];

ws.addEventListener('message', (event) => {
  const payload = JSON.parse(event.data);
  if (payload.id !== undefined) {
    const waiter = pending.get(payload.id);
    if (waiter !== undefined) {
      pending.delete(payload.id);
      payload.error ? waiter.reject(new Error(JSON.stringify(payload.error))) : waiter.resolve(payload.result);
    }
    return;
  }
  if (payload.method === 'Network.requestWillBeSent') {
    const url = payload.params?.request?.url ?? '';
    if (/completion|samantha\/chat/i.test(url) && !/\.(js|css|png|jpe?g|svg|woff2?)(\?|$)/i.test(url)) {
      captured.push(payload.params.request);
    }
  }
});

const call = (method, params) => new Promise((resolve, reject) => {
  const id = ++seq;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});

const evaluate = async (expression) => {
  const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  return result?.result?.value;
};

await call('Network.enable');

/* 等登录 */
log('  等你在浏览器里登录豆包…');
log('  （窗口已经打开，扫码或手机号登录都行）');
log('');

let loggedIn = false;
const loginDeadline = Date.now() + LOGIN_TIMEOUT_MS;
while (Date.now() < loginDeadline) {
  await new Promise((r) => setTimeout(r, 2000));
  const state = await evaluate(`(() => {
    const txt = document.body.innerText || '';
    return JSON.stringify({
      hasLoginBtn: /^\\s*登录\\s*$/m.test(txt) || /扫码登录|手机号登录/.test(txt),
      editable: !!document.querySelector('[contenteditable="true"]'),
    });
  })()`);
  const parsed = JSON.parse(state ?? '{}');
  if (parsed.editable === true && parsed.hasLoginBtn === false) {
    loggedIn = true;
    break;
  }
}

if (!loggedIn) {
  console.error('等了几分钟还没登录成功。登录完再跑一次，或者加 --keep 保持浏览器开着。');
  if (!KEEP) ws.close();
  process.exit(1);
}

log('  登录成功。开始自动发一条测试消息…');

/* 聚焦输入框并输入 */
const box = await evaluate(`(() => {
  const el = document.querySelector('[contenteditable="true"]');
  if (!el) return null;
  el.focus();
  const r = el.getBoundingClientRect();
  return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
})()`);
const at = JSON.parse(box ?? 'null');
if (at === null) {
  console.error('找不到输入框。');
  process.exit(1);
}

await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: 'left', clickCount: 1 });
await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x, y: at.y, button: 'left', clickCount: 1 });
await new Promise((r) => setTimeout(r, 400));
await call('Input.insertText', { text: '1+1' });
await new Promise((r) => setTimeout(r, 600));

/* 点发送 */
const clicked = await evaluate(`(() => {
  const bs = [...document.querySelectorAll('button, [role="button"], div[class*="send"]')].filter((b) => b.offsetParent !== null);
  const send = bs.find((b) => /send|发送/i.test((b.getAttribute('aria-label') || '') + ' ' + (b.className || '') + ' ' + (b.title || '')));
  if (send) { send.click(); return 'ok'; }
  const el = document.querySelector('[contenteditable="true"]');
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
  return 'enter';
})()`);
log(`  发送动作：${clicked}`);

/* 等请求 */
const grabDeadline = Date.now() + 25_000;
while (Date.now() < grabDeadline && captured.length === 0) {
  await new Promise((r) => setTimeout(r, 500));
}

if (captured.length === 0) {
  log('');
  log('  自动发送没抓到请求，现在请在窗口里手动发一条消息（比如「1+1」）。');
  log('  我再等 3 分钟…');
  const manualDeadline = Date.now() + 3 * 60 * 1000;
  while (Date.now() < manualDeadline && captured.length === 0) {
    await new Promise((r) => setTimeout(r, 600));
  }
}

if (captured.length === 0) {
  console.error('');
  console.error('还是没抓到对话请求。可能这个版本的接口路径与预期不同。');
  console.error('把浏览器窗口里 F12 网络面板的截图给我也行。');
  if (!KEEP) ws.close();
  process.exit(1);
}

const request = captured[captured.length - 1];

/* 出结论 */
const headerKeys = Object.keys(request.headers);
const notable = headerKeys.filter((key) => /^(x-|ms-|cookie|authorization|x-tt|x-ms|sec-)/i.test(key));
const body = String(request.postData ?? '');

const lines = [];
lines.push('豆包网页版接口探测报告');
lines.push(`时间：${new Date().toISOString()}`);
lines.push('');
lines.push(`请求：${request.method} ${request.url}`);
lines.push('');
lines.push('一、请求头（去掉常规项）');
for (const key of notable) {
  const value = String(request.headers[key]);
  lines.push(`  ${key}: ${value.length > 100 ? `${value.slice(0, 97)}…` : value}`);
}
lines.push('');
lines.push(`二、请求体（${body.length} 字节）`);
lines.push(body.slice(0, 1500));
lines.push('');
lines.push('三、要点');
lines.push(`  - 是否带 Cookie：${headerKeys.some((k) => k.toLowerCase() === 'cookie') ? '是' : '否（走 credentials）'}`);
lines.push(`  - 是否带 x-ms-token：${headerKeys.some((k) => /ms-token/i.test(k)) ? '是' : '否'}`);
lines.push(`  - 是否带自定义鉴权头：${headerKeys.some((k) => /token|auth/i.test(k)) ? '是' : '否'}`);
lines.push(`  - 请求体字段：${Object.keys(JSON.parse(body === '' ? '{}' : body)).join(', ')}`);

const report = lines.join('\n');
console.log('');
console.log(report);

writeFileSync(join(OUT_DIR, 'doubao-request.json'), `${JSON.stringify({
  at: new Date().toISOString(),
  url: request.url,
  method: request.method,
  headers: request.headers,
  postData: body,
}, null, 2)}\n`, 'utf8');
writeFileSync(join(OUT_DIR, 'doubao-report.txt'), `${report}\n`, 'utf8');

console.log('');
console.log(`已保存：${join(OUT_DIR, 'doubao-request.json')}`);
console.log(`已保存：${join(OUT_DIR, 'doubao-report.txt')}`);

if (!KEEP) ws.close();
