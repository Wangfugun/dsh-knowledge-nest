#!/usr/bin/env node
/**
 * 起豆包网页版的 OpenAI 兼容接口。
 *
 * 用法：
 *   node tools/web-provider.mjs                  默认 127.0.0.1:7333，CDP 9335
 *   node tools/web-provider.mjs --port=7400
 *   node tools/web-provider.mjs --cdp=9334
 *
 * 起来之后，在词林的设置面板里选「豆包（网页版）」，
 * 或者手动把接口地址填成 http://127.0.0.1:7333/v1，模型名填 doubao-web。
 */
import { startWebProvider, DEFAULT_PORT, MODEL_ID } from '../src/webprovider/server.js';
import { probeDoubao, DEFAULT_CDP_PORT } from '../src/webprovider/doubao.js';

const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const hit = argv.find((item) => item.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
};

const port = Number(argOf('port', DEFAULT_PORT));
const cdpPort = Number(argOf('cdp', process.env.DOUBAO_CDP_PORT ?? DEFAULT_CDP_PORT));

console.log('词林 · 豆包网页版接口');
console.log('');

/* 先看浏览器那边准备好了没，免得用户以为服务坏了 */
const status = await probeDoubao({ port: cdpPort });
if (status.ok === true) {
  console.log(`  浏览器     调试端口 ${cdpPort}，豆包已登录`);
} else {
  console.log(`  浏览器     还不可用：${status.message}`);
  console.log(`             用 --remote-debugging-port=${cdpPort} 启动浏览器并打开 https://www.doubao.com/chat/`);
  console.log(`             服务照常启动，浏览器就绪后自动可用`);
}

const provider = await startWebProvider({ port, cdpPort, onLog: (line) => console.log(`  ${line}`) });
if (provider === null) {
  console.error(`端口 ${port} 被占用，换一个：node tools/web-provider.mjs --port=7400`);
  process.exit(1);
}

console.log('');
console.log(`  接口地址   ${provider.url}`);
console.log(`  模型名     ${MODEL_ID}`);
console.log(`  钥匙       随便填，比如 x（豆包那边用的是浏览器 Cookie）`);
console.log('');
console.log('  在词林的设置面板里选「豆包（网页版）」即可，或手动填上面两行。');
console.log('  关掉这个窗口服务就停，客户端会报连不上。');

const stop = () => {
  provider.close().finally(() => process.exit(0));
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
