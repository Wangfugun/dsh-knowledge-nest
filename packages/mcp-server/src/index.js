#!/usr/bin/env node
/**
 * stdio 入口：给 MCP 客户端（Claude Desktop / Cherry Studio / 任何 MCP host）拉起。
 *
 * 规矩：**stdout 只走协议**，任何日志都写 stderr——写错一行 stdout 就会让客户端解析失败。
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createKnestServer } from './server.js';
import { configPath, knestHome } from './model.js';

const server = createKnestServer();
const transport = new StdioServerTransport();

await server.connect(transport);

/* 只打 stderr：说明书式的启动日志，方便在客户端日志面板里确认到底加载了哪个配置。 */
console.error(`[knowledge-nest] MCP server ready`);
console.error(`[knowledge-nest] home:   ${knestHome()}`);
console.error(`[knowledge-nest] config: ${configPath()}`);
