/**
 * 只读探针 v5：把 @deepseek-ai 里与「workspace / file / slot / sidebar」相关的包，
 * 以及核心 lib/index.js 释放到临时目录，便于逐字阅读。
 */
import { openSync, readSync, closeSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ASAR = 'D:\\360安全浏览器下载\\resources\\app.asar';
const fd = openSync(ASAR, 'r');
const HEAD = 8 * 1024 * 1024;
const head = Buffer.alloc(HEAD);
readSync(fd, head, 0, HEAD, 0);
const jsonLen = head.readUInt32LE(12);
const header = JSON.parse(head.subarray(16, 16 + jsonLen).toString('utf8'));
const dataStart = 16 + jsonLen;

const files = [];
const walk = (node, prefix) => {
  for (const [name, child] of Object.entries(node.files ?? {})) {
    const path = prefix === '' ? name : `${prefix}/${name}`;
    if (child.files !== undefined) walk(child, path);
    else files.push({ path, size: child.size ?? 0, offset: Number(child.offset ?? 0) });
  }
};
walk(header, '');

const targets = files.filter((f) => /^dsh\/node_modules\/@deepseek-ai\/[^/]+\//.test(f.path)
  && /(workspace|file|slot|sidebar|attachment|upload)/i.test(f.path)
  && /\.(js|json)$/.test(f.path)
  && f.size < 400 * 1024);

console.log(`候选文件: ${targets.length}`);
for (const f of targets.slice(0, 40)) console.log(`  ${f.path} (${f.size}B)`);

const outDir = join(process.env.TEMP ?? '.', 'dsh-api-probe');
mkdirSync(outDir, { recursive: true });
let saved = 0;
for (const f of targets.slice(0, 60)) {
  const buf = Buffer.alloc(f.size);
  readSync(fd, buf, 0, f.size, dataStart + f.offset);
  const name = f.path.replace(/^dsh\/node_modules\/@deepseek-ai\//, '').replace(/[/\\]/g, '__');
  writeFileSync(join(outDir, name), buf);
  saved += 1;
}
closeSync(fd);
console.log(`\n已释放 ${saved} 个文件到 ${outDir}`);
