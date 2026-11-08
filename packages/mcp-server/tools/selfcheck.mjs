#!/usr/bin/env node
/**
 * 自检：模拟 MCP 客户端（Cherry Studio / Claude Desktop）的拉起方式，检查这个 server 能不能被用。
 *
 * 它做的事情跟客户端一模一样：用 `command + args + env` 起子进程，走一遍
 * initialize、tools/list，可选地再走一次 tools/call，然后报告每一步的结果。
 *
 * 用法：
 *   node tools/selfcheck.mjs                    用当前环境自检
 *   node tools/selfcheck.mjs --call             顺便真调一次（会花 token）
 *   node tools/selfcheck.mjs --env=D:\a.json    从 json 里读 env（Cherry 配置里那段 env 原样）
 *   node tools/selfcheck.mjs --json             输出机器可读的 JSON
 *
 * 退出码：0 全通过；1 有硬错误；2 能起动但配置不全（例如没有钥匙）。
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, '..');
const ENTRY = join(PKG, 'src', 'index.js');

const argv = process.argv.slice(2);
const wantCall = argv.includes('--call');
const asJson = argv.includes('--json');
const envFileArg = argv.find((a) => a.startsWith('--env='));
const timeoutMs = 30_000;

/* ---------- 收集环境 ---------- */

/** 从 json 文件读 env（允许 {"env":{...}}、mcpServers 结构、或直接 {...}）。 */
function loadEnvFile(path) {
  if (!path) return {};
  if (!existsSync(path)) throw new Error(`env 文件不存在：${path}`);
  /* Windows 上的编辑器与 PowerShell 常写 BOM，JSON.parse 不认，先剥掉 */
  const raw = readFileSync(path, 'utf8').replace(/^\uFEFF/u, '');
  const parsed = JSON.parse(raw);

  /* 直接贴客户端的整份配置也能用：从 mcpServers 里挑第一个带 env 的条目 */
  let env = parsed?.env ?? parsed;
  const servers = parsed?.mcpServers ?? parsed?.mcp_servers;
  if (env === parsed && servers !== null && typeof servers === 'object') {
    const first = Object.values(servers).find((item) => item !== null && typeof item === 'object');
    env = first?.env ?? {};
  }
  if (env === null || typeof env !== 'object') throw new Error('env 文件里没有对象');
  const out = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  if (!asJson) {
    const mark = ok === true ? 'OK  ' : ok === 'warn' ? 'WARN' : 'FAIL';
    console.log(`  [${mark}] ${name}${detail === '' ? '' : `  ${detail}`}`);
  }
}

/* ---------- 静态检查 ---------- */

if (!asJson) console.log('\n一、静态检查');

const nodeMajor = Number(process.versions.node.split('.')[0]);
check('Node 版本 >= 20', nodeMajor >= 20, `v${process.versions.node}`);
check('入口文件存在', existsSync(ENTRY), ENTRY);
check('依赖已安装', existsSync(join(PKG, 'node_modules', '@modelcontextprotocol', 'sdk')), 'node_modules/@modelcontextprotocol/sdk');
check('没有构建步骤', !existsSync(join(PKG, 'tsconfig.json')), '源码即产物，src/*.js');

/* ---------- 拉起子进程 ---------- */

let extraEnv = {};
try {
  extraEnv = loadEnvFile(envFileArg?.slice('--env='.length));
} catch (error) {
  check('读取 env 文件', false, String(error.message));
}

if (!asJson) console.log('\n二、按客户端方式拉起');

const env = { ...process.env, ...extraEnv };
const child = spawn(process.execPath, [ENTRY], { cwd: PKG, env, stdio: ['pipe', 'pipe', 'pipe'] });

let stdoutRaw = '';
let stderrRaw = '';
child.stdout.on('data', (d) => { stdoutRaw += d.toString('utf8'); });
child.stderr.on('data', (d) => { stderrRaw += d.toString('utf8'); });

const send = (msg) => {
  try {
    child.stdin.write(`${JSON.stringify(msg)}\n`);
  } catch {
    /* 进程可能已经退出 */
  }
};

const messages = [];
child.stdout.on('data', () => {
  const lines = stdoutRaw.split('\n').filter((l) => l.trim() !== '');
  messages.length = 0;
  for (const line of lines) {
    try {
      messages.push(JSON.parse(line));
    } catch {
      messages.push({ __invalid: line });
    }
  }
});

const started = Date.now();
send({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'knest-selfcheck', version: '1' } },
});

await new Promise((resolve) => setTimeout(resolve, 700));
send({ jsonrpc: '2.0', method: 'notifications/initialized' });
send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });

await new Promise((resolve) => setTimeout(resolve, 900));

const init = messages.find((m) => m.id === 1);
const list = messages.find((m) => m.id === 2);
const tools = list?.result?.tools ?? [];
const invalid = messages.filter((m) => m.__invalid !== undefined);

check('initialize 有响应', init?.result?.serverInfo !== undefined, init?.result?.serverInfo ? `${init.result.serverInfo.name} ${init.result.serverInfo.version}` : '');
check('stdout 全是 JSON-RPC', invalid.length === 0, invalid.length === 0 ? `${messages.length} 条消息` : `${invalid.length} 行污染`);
check('至少暴露一个工具', tools.length > 0, tools.map((t) => t.name).join(', ') || '(无)');

const tool = tools.find((t) => t.name === 'knowledge_nest_explain');
check('工具名是 knowledge_nest_explain', tool !== undefined);
if (tool !== undefined) {
  const desc = String(tool.description ?? '');
  check('工具描述非空', desc.length > 40, `${desc.length} 字符`);
  check('工具描述含中文', /[\u4e00-\u9fa5]/u.test(desc), /[\u4e00-\u9fa5]/u.test(desc) ? '中文模型更容易理解' : '仅英文');
  check('有输出 schema', tool.outputSchema !== undefined, tool.outputSchema ? 'card 结构已声明' : '缺');
  const props = Object.keys(tool.inputSchema?.properties ?? {});
  check('入参含 text', props.includes('text'), props.join(', '));
}

/* ---------- 可选：真调一次 ---------- */

let callResult = null;
if (wantCall) {
  if (!asJson) console.log('\n三、真调用一次（会花 token）');
  send({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'knowledge_nest_explain', arguments: { text: '闸门', context: '同时最多三个请求在飞，超过就排队；同一个词只发一次。' } },
  });

  /* 轮询等结果：模型调用要几秒，固定睡一会儿会误判 */
  const deadline = Date.now() + 60_000;
  let call = null;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    call = messages.find((m) => m.id === 3);
    if (call !== undefined) break;
    if (child.exitCode !== null) break;
  }

  callResult = call?.result?.structuredContent ?? null;
  if (call === null || call === undefined) {
    check('真实调用', 'warn', '等 60 秒没有响应，可能超时或进程退出');
  } else if (callResult?.ok === true) {
    check('真实调用成功', true, `模型 ${callResult?.card?.meta?.model ?? '?'}，${callResult?.card?.meta?.ms ?? '?'}ms`);
  } else {
    const code = callResult?.code ?? call?.result?.content?.[0]?.text?.slice(0, 80) ?? 'unknown';
    const message = callResult?.message ?? '';
    check('真实调用', 'warn', `${code} ${message}`.trim());
  }
}

/* ---------- 收尾 ---------- */

const exitCode = child.exitCode;
child.kill();
const elapsed = Date.now() - started;

const warnings = stderrRaw.split('\n').filter((l) => l.includes('注意：'));
if (warnings.length > 0) {
  if (!asJson) console.log('\n四、启动时的提醒');
  for (const line of warnings) {
    if (!asJson) console.log(`  ${line.replace('[knowledge-nest] ', '')}`);
  }
}

const failed = checks.filter((c) => c.ok === false);
const warned = checks.filter((c) => c.ok === 'warn');
/* 启动提醒也算「配置不全」：能用，但调用大概率会因缺钥匙返回 no-key */
const blocked = warned.length + warnings.length;

if (asJson) {
  console.log(JSON.stringify({
    ok: failed.length === 0 && warnings.length === 0,
    checks,
    warnings: warnings.map((l) => l.replace('[knowledge-nest] 注意：', '')),
    tool: tool === undefined ? null : { name: tool.name, title: tool.title, descriptionLength: String(tool.description ?? '').length },
    call: callResult,
    stderrLines: stderrRaw.split('\n').filter((l) => l.trim() !== '').length,
    elapsedMs: elapsed,
  }, null, 2));
} else {
  console.log('\n五、结论');
  console.log(`  通过 ${checks.length - failed.length - warned.length} 项，配置提醒 ${blocked} 条，失败 ${failed.length} 项，用时 ${elapsed}ms`);
  if (failed.length === 0 && blocked === 0) {
    console.log('  这个 server 可以被 MCP 客户端正常拉起。把下面这段填进 Cherry Studio 即可：');
    console.log(JSON.stringify({
      command: process.execPath,
      args: [ENTRY],
      env: Object.keys(extraEnv).length > 0 ? extraEnv : { KNEST_HOME: '<数据目录>' },
    }, null, 2));
  } else if (failed.length === 0) {
    console.log('  能被拉起，但配置不全：照上面「启动时的提醒」补齐后，再跑一次自检。');
    console.log('  目前这份配置贴进客户端也能用，只是调用会返回 no-key 之类的错误码。');
  } else {
    console.log('  先修掉失败项，再往客户端里填配置。');
  }
}

process.exit(failed.length > 0 ? 1 : blocked > 0 ? 2 : 0);
