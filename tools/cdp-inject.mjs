/**
 * CDP 注入器：把一个 Electron 客户端的渲染进程接管，注入「词林 独立版」。
 *
 * 用法：
 *   1. 用调试端口启动目标客户端（以 Cherry Studio 为例）：
 *        "C:\Users\<你>\AppData\Local\Programs\cherry-studio\Cherry Studio.exe" --remote-debugging-port=9222
 *   2. 跑：
 *        node tools/cdp-inject.mjs --port 9222
 *   3. 想撤掉：
 *        node tools/cdp-inject.mjs --port 9222 --dispose
 *
 * 它只用到两个 CDP 能力：`Runtime.evaluate`（执行脚本）和 `Page.reload`（可选）。
 * 不写任何文件、不改对方安装目录，关掉客户端即恢复原样。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const argOf = (name, fallback = '') => {
  const at = args.indexOf(name);
  return at >= 0 && args[at + 1] !== undefined ? args[at + 1] : fallback;
};

const port = Number(argOf('--port', '9222'));
const endpoint = argOf('--endpoint', 'http://127.0.0.1:7331');
const dispose = args.includes('--dispose');
const bundlePath = join(process.cwd(), 'client-standalone.js');

/**
 * 列可用页面。
 * @returns {Promise<object[]>} 目标列表。
 */
async function listTargets() {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`调试端口返回 ${res.status}`);
  return res.json();
}

/**
 * 打开一个页面级 WebSocket。
 * @param {string} url - ws 地址。
 * @returns {Promise<{send:Function, close:Function}>} 连接。
 */
function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let nextId = 1;
    const pending = new Map();
    ws.addEventListener('open', () => {
      resolve({
        send(method, params = {}) {
          const id = nextId++;
          ws.send(JSON.stringify({ id, method, params }));
          return new Promise((done, fail) => {
            pending.set(id, { done, fail });
            setTimeout(() => {
              if (pending.has(id)) {
                pending.delete(id);
                fail(new Error(`${method} 超时`));
              }
            }, 120_000);
          });
        },
        close: () => ws.close(),
      });
    });
    ws.addEventListener('message', (event) => {
      let payload = null;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }
      const waiter = pending.get(payload.id);
      if (waiter === undefined) return;
      pending.delete(payload.id);
      if (payload.error !== undefined) waiter.fail(new Error(JSON.stringify(payload.error)));
      else waiter.done(payload.result);
    });
    ws.addEventListener('error', () => reject(new Error('连不上调试端口')));
  });
}

const targets = await listTargets();
const pages = targets.filter((item) => item.type === 'page' && typeof item.webSocketDebuggerUrl === 'string' && item.webSocketDebuggerUrl !== '');
if (pages.length === 0) {
  console.error('没有可注入的页面。确认客户端已用 --remote-debugging-port 启动，且窗口已打开。');
  process.exit(1);
}

console.log(`找到 ${pages.length} 个页面：`);
pages.forEach((page, index) => console.log(`  [${index}] ${page.title?.slice(0, 40) ?? '(无标题)'}  ${page.url.slice(0, 70)}`));

const only = argOf('--index', '');
const picked = only === '' ? pages[0] : pages[Math.max(0, Math.min(pages.length - 1, Number(only)))];
console.log(`\n注入目标：${picked.title?.slice(0, 40) ?? picked.url}`);

const conn = await connect(picked.webSocketDebuggerUrl);

if (dispose) {
  await conn.send('Runtime.evaluate', {
    expression: 'window.__knestStandalone && window.__knestStandalone.dispose(); "disposed"',
    returnByValue: true,
  });
  console.log('已卸载。');
  conn.close();
  process.exit(0);
}

const bundle = readFileSync(bundlePath, 'utf8');
const expression = `${bundle}\n;window.__knestMount({ endpoint: ${JSON.stringify(endpoint)} }); "mounted"`;

const result = await conn.send('Runtime.evaluate', {
  expression,
  returnByValue: true,
  awaitPromise: false,
});

if (result?.exceptionDetails !== undefined) {
  console.error('注入失败：', JSON.stringify(result.exceptionDetails).slice(0, 400));
  conn.close();
  process.exit(1);
}

console.log('注入完成，返回值：', result?.result?.value);
conn.close();
