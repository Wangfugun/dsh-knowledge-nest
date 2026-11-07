/**
 * 只读探针：Cherry Studio 的 Electron 窗口配置 + 消息渲染结构。
 * 走 api.github.com（raw.githubusercontent 本机 DNS 不通）。
 *
 * 用法：node tools/probe-cherry-studio.mjs
 * 输出：主窗口 webPreferences、renderer 入口、消息组件是否用 iframe。
 */
const REPO = 'CherryHQ/cherry-studio';
const BRANCH = 'main';
const HEADERS = { 'user-agent': 'knest-probe', accept: 'application/vnd.github+json' };

async function api(path) {
  const res = await fetch(`https://api.github.com${path}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

async function read(path) {
  const meta = await api(`/repos/${REPO}/contents/${encodeURI(path)}?ref=${BRANCH}`);
  return Buffer.from(meta.content, 'base64').toString('utf8');
}

/** 打印命中行。 */
function grep(label, body, pattern, limit = 14) {
  const rows = body.split('\n')
    .map((line, i) => ({ line: line.trim(), no: i + 1 }))
    .filter((row) => pattern.test(row.line));
  console.log(`\n--- ${label}（命中 ${rows.length}）`);
  for (const row of rows.slice(0, limit)) console.log(`  ${row.no}: ${row.line}`);
}

const registry = await read('src/main/core/window/windowRegistry.ts');
console.log('=== 主窗口 WindowType.Main 的 webPreferences ===');
const start = registry.indexOf('[WindowType.Main]');
const block = registry.slice(start, registry.indexOf('[WindowType.Print]'));
for (const line of block.split('\n').filter((l) => /htmlPath|contextIsolation|nodeIntegration|sandbox|webSecurity|webviewTag|preload/.test(l))) {
  console.log('  ' + line.trim());
}

const manager = await read('src/main/core/window/WindowManager.ts');
grep('WindowManager 加载方式', manager, /loadURL\(|loadFile\(|ELECTRON_RENDERER_URL/u);

const mainText = await read('src/renderer/components/chat/messages/blocks/MainTextBlock.tsx');
grep('正文块里的 iframe/webview', mainText, /<iframe|webview|Webview/u, 5);
grep('正文块渲染方式', mainText, /ChatMarkdown|MarkdownSource/u, 5);

const preload = await read('src/preload/preload.ts');
grep('preload 的 contextBridge', preload, /contextBridge/u, 5);
