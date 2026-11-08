#!/usr/bin/env node
/**
 * stdio 入口：给 MCP 客户端（Claude Desktop / Cherry Studio / 任何 MCP host）拉起。
 *
 * 规矩：**stdout 只走协议**，任何日志都写 stderr——写错一行 stdout 就会让客户端解析失败。
 *
 * 附带一个 `--help`：排查问题时能在终端里看到配置从哪来，不会影响 stdio 模式。
 * 任何其它参数都会被忽略（客户端可能塞 `--stdio` 之类），不报错。
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createKnestServer } from './server.js';
import { SERVER_NAME, SERVER_VERSION } from './server.js';
import { knestHome, startupDiagnostics } from './model.js';
import { startSetupServer } from './setup.js';

const argv = process.argv.slice(2);

function printHelp() {
  const diag = startupDiagnostics();
  console.error(`${SERVER_NAME} ${SERVER_VERSION} — 词林的 MCP 工具`);
  console.error('');
  console.error('用法：node src/index.js            以 stdio 模式启动（客户端用这个）');
  console.error('      node src/index.js --help     看这份说明与当前配置');
  console.error('');
  console.error('当前配置：');
  for (const line of diag.lines) console.error(`  ${line}`);
  if (diag.warnings.length > 0) {
    console.error('');
    console.error('需要注意：');
    for (const warning of diag.warnings) console.error(`  - ${warning}`);
  }
  console.error('');
  console.error('环境变量：');
  console.error('  KNEST_HOME          数据目录（默认 ~/.knest）');
  console.error('  KNEST_CONFIG        直接指定配置文件');
  console.error('  KNEST_PROVIDER      ollama / lmstudio / vllm（本地端点免钥匙）');
  console.error('  DEEPSEEK_API_KEY    或 OPENAI_API_KEY');
  console.error('  OPENAI_BASE_URL     OpenAI 兼容端点');
  console.error('  OPENAI_MODEL        模型名（非 DeepSeek 端点必填）');
  console.error('  KNEST_TIMEOUT_MS    请求超时，默认 45000');
  console.error('  KNEST_MAX_TOKENS    回答上限，默认 700');
}

if (argv.includes('--help') || argv.includes('-h')) {
  printHelp();
  process.exit(0);
}

if (argv.includes('--version') || argv.includes('-v')) {
  console.error(`${SERVER_NAME} ${SERVER_VERSION}`);
  process.exit(0);
}

const server = createKnestServer();
const transport = new StdioServerTransport();

await server.connect(transport);

/* 只打 stderr：说明书式的启动日志，方便在客户端日志面板里确认到底加载了哪个配置。 */
const diag = startupDiagnostics();
console.error(`[knowledge-nest] MCP server ready  ${SERVER_NAME} ${SERVER_VERSION}`);
console.error(`[knowledge-nest] home:   ${knestHome()}`);
for (const line of diag.lines) {
  if (line.startsWith('home')) continue;
  console.error(`[knowledge-nest] ${line}`);
}
for (const warning of diag.warnings) {
  console.error(`[knowledge-nest] 注意：${warning}`);
}

/* 配置页：给没有 UI 的客户端补一个能填钥匙的入口。
 * 起不来（端口占用等）不影响 MCP 本身，只是少了个界面。 */
if (process.env.KNEST_NO_SETUP !== '1') {
  try {
    const setup = await startSetupServer({ env: process.env });
    if (setup !== null) {
      process.env.KNEST_SETUP_URL = setup.url;
      console.error(`[knowledge-nest] 配置页：${setup.url}`);
      console.error('[knowledge-nest] 打开上面这个地址就能填钥匙、选本机模型、当场测通');
      const shutdown = () => {
        setup.close().finally(() => process.exit(0));
      };
      process.once('exit', () => {
        setup.close();
      });
      process.once('SIGINT', shutdown);
      process.once('SIGTERM', shutdown);
    }
  } catch (error) {
    console.error(`[knowledge-nest] 配置页没起来：${String(error?.message ?? error).slice(0, 120)}`);
  }
}
