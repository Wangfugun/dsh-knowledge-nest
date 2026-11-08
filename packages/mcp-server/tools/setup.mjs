#!/usr/bin/env node
/**
 * 独立启动配置页：不依赖 MCP 客户端，双击或命令行跑一下，浏览器自动打开。
 *
 * 用法：
 *   node tools/setup.mjs                 默认端口 7332
 *   node tools/setup.mjs --port=7400
 *   node tools/setup.mjs --home=D:\knest-data
 *   node tools/setup.mjs --no-open       只打印地址，不自动开浏览器
 *
 * 关掉这个进程，页面就失效；配置已经写进 config.json，不影响客户端使用。
 *
 * 数据目录的来源，按优先级：
 *   1. --home= 参数
 *   2. 环境变量 KNEST_HOME
 *   3. 同目录的 cherry-config.json 里的 env.KNEST_HOME（保证和客户端读的是同一个文件）
 *   4. 默认 ~/.knest
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startSetupServer, DEFAULT_SETUP_PORT } from '../src/setup.js';
import { configPath, isOnSystemDrive, knestHome, resolveModel } from '../src/model.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, '..');

const argv = process.argv.slice(2);
const portArg = argv.find((a) => a.startsWith('--port='));
const homeArg = argv.find((a) => a.startsWith('--home='));
const port = portArg ? Number(portArg.slice('--port='.length)) : undefined;
const noOpen = argv.includes('--no-open');

/**
 * 从同目录的客户端配置里取 KNEST_HOME。
 *
 * 为什么要这么做：配置页独立启动时，如果随手用了默认的 ~/.knest，
 * 写进去的 config.json 和客户端实际读的不是同一个文件，用户在页面里配完会「没反应」。
 *
 * @returns {string} 数据目录；没找到返回空串。
 */
function homeFromClientConfig() {
  const file = join(PKG, 'cherry-config.json');
  if (!existsSync(file)) return '';
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/u, ''));
    const servers = parsed?.mcpServers ?? parsed?.mcp_servers ?? {};
    for (const item of Object.values(servers)) {
      const value = item?.env?.KNEST_HOME;
      if (typeof value === 'string' && value.trim() !== '') return value.trim();
    }
  } catch {
    /* 读不到就算了 */
  }
  return '';
}

let env = process.env;
let homeSource = '环境变量或默认值';

const explicitHome = homeArg ? homeArg.slice('--home='.length) : '';
if (explicitHome !== '') {
  env = { ...process.env, KNEST_HOME: explicitHome };
  homeSource = '--home 参数';
} else if (typeof process.env.KNEST_HOME !== 'string' || process.env.KNEST_HOME.trim() === '') {
  const fromClient = homeFromClientConfig();
  if (fromClient !== '') {
    env = { ...process.env, KNEST_HOME: fromClient };
    homeSource = '同目录的 cherry-config.json';
  }
}

/* 先看看是不是已经有同类服务在跑：有就直接复用，别跟它抢端口 */
const probePort = port ?? Number(env.KNEST_SETUP_PORT ?? DEFAULT_SETUP_PORT);
let existingUrl = '';
try {
  const res = await fetch(`http://127.0.0.1:${probePort}/state`, { signal: AbortSignal.timeout(1500) });
  if (res.ok) {
    const body = await res.json();
    if (Array.isArray(body?.presets)) existingUrl = `http://127.0.0.1:${probePort}/`;
  }
} catch {
  /* 没起就是好事 */
}

if (existingUrl !== '') {
  console.log('已经有一个配置服务在跑，直接用它的地址：');
  console.log('');
  console.log(`  ${existingUrl}`);
  console.log('');
  console.log('（要重新起一个，先关掉旧的，或者用 --port= 换端口）');
  process.exit(0);
}

const setup = await startSetupServer({ env, port });

if (setup === null) {
  console.error(`端口 ${probePort} 被占用，换一个：node tools/setup.mjs --port=7400`);
  process.exit(1);
}

const model = resolveModel(env);
const home = knestHome(env);

console.log('词林 · 配置页');
console.log('');
console.log(`  地址      ${setup.url}`);
console.log(`  数据目录  ${home}`);
console.log(`            （来源：${homeSource}）`);
console.log(`  配置文件  ${configPath(env)}`);
console.log(`  当前生效  ${model.baseUrl || '(未配置)'} / ${model.model || '(无模型)'}`);
console.log('');
if (isOnSystemDrive(home) && homeSource !== '--home 参数') {
  console.log('注意：数据目录在系统盘。若这台机器不允许写 C 盘，关掉这个窗口，用');
  console.log('      node tools/setup.mjs --home=D:\\knest-data   重新启动。');
  console.log('');
}
console.log('在页面里选供应商、填 key、点「保存并测试」，存完客户端下一次调用就生效。');
console.log('用完按 Ctrl+C 关掉这个窗口。');

if (!noOpen) {
  const url = setup.url;
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch {
    console.log('（没能自动打开浏览器，手动复制上面那个地址）');
  }
}

const stop = () => {
  setup.close().finally(() => process.exit(0));
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
