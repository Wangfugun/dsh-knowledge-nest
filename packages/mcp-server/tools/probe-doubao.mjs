#!/usr/bin/env node
/**
 * 抓豆包网页版的真实对话请求。
 *
 * 用途：搞清楚它的接口到底要什么——请求头、请求体、鉴权方式。
 * 一旦抓到，就能判断「借用网页版额度」这条路值不值得做。
 *
 * 用法：
 *   1. 用调试端口启动浏览器并打开豆包：
 *        "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" ^
 *          --remote-debugging-port=9334 --user-data-dir=D:\dsh-tmp\edge-doubao https://www.doubao.com/chat/
 *   2. 在这个窗口里登录豆包（扫码或手机号都行）
 *   3. 手动发一条消息，比如「1+1」
 *   4. 跑这个脚本：
 *        node tools/probe-doubao.mjs
 *
 * 脚本会一直等到你发消息，抓到请求就打印出来。
 */
const PORT = Number(process.env.PROBE_PORT ?? 9334);
const WAIT_MS = Number(process.env.PROBE_WAIT_MS ?? 180_000);

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((item) => item.type === 'page' && (item.url ?? '').includes('doubao'));
if (!page) {
  console.error('没找到豆包页面。确认浏览器已带 --remote-debugging-port 打开过 doubao.com');
  process.exit(1);
}

console.log(`盯着这个页面：${page.url.slice(0, 70)}`);
console.log('现在去窗口里发一条消息（例如「1+1」），我在等…');
console.log('');

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve);
  ws.addEventListener('error', reject);
});

let seq = 0;
const hits = [];
const pending = new Map();

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
  /* 只关心对话请求 */
  if (payload.method === 'Network.requestWillBeSent') {
    const url = payload.params?.request?.url ?? '';
    if (/completion|chat\/|samantha/i.test(url) && !/\.(js|css|png|jpg|svg|woff2?)(\?|$)/i.test(url)) {
      hits.push(payload.params.request);
    }
  }
});

const call = (method, params) => new Promise((resolve, reject) => {
  const id = ++seq;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});

await call('Network.enable');

const deadline = Date.now() + WAIT_MS;
while (Date.now() < deadline && hits.length === 0) {
  await new Promise((resolve) => setTimeout(resolve, 500));
}

if (hits.length === 0) {
  console.log('等了这么久没抓到对话请求。可能原因：');
  console.log('  - 没登录成功，发消息时被登录框挡住了');
  console.log('  - 消息没有真正发出去（输入后要按发送按钮或回车）');
  console.log('  - 接口路径跟预期不同，试着把 PROBE_WAIT_MS 调大一点再来一次');
  ws.close();
  process.exit(1);
}

const request = hits[hits.length - 1];
console.log('抓到了：', request.method, request.url);
console.log('');
console.log('=== 请求头 ===');
for (const [key, value] of Object.entries(request.headers)) {
  if (/^(sec-|:)/i.test(key)) continue;
  const shown = String(value).length > 120 ? `${String(value).slice(0, 117)}…` : String(value);
  console.log(`  ${key}: ${shown}`);
}
console.log('');
console.log('=== 请求体 ===');
console.log(String(request.postData ?? '（无）').slice(0, 1200));

/* 顺手记一份，方便回头分析 */
const { writeFileSync } = await import('node:fs');
const record = {
  at: new Date().toISOString(),
  url: request.url,
  method: request.method,
  headers: request.headers,
  postData: request.postData ?? '',
};
writeFileSync('D:\\dsh-tmp\\doubao-request.json', `${JSON.stringify(record, null, 2)}\n`, 'utf8');
console.log('');
console.log('已存到 D:\\dsh-tmp\\doubao-request.json');

ws.close();
