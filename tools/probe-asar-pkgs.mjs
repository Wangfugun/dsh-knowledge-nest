/**
 * 只读探针 v4：列出 @deepseek-ai/* 包，并在里面找「文件读取 / 插槽 / 工作区」相关实现。
 */
import { openSync, readSync, closeSync } from 'node:fs';

const ASAR = 'D:\\360安全浏览器下载\\resources\\app.asar';
const fd = openSync(ASAR, 'r');
const HEAD = 8 * 1024 * 1024;
const buf = Buffer.alloc(HEAD);
readSync(fd, buf, 0, HEAD, 0);
closeSync(fd);
const start = 16;
const len = buf.readUInt32LE(12);
const header = JSON.parse(buf.subarray(start, start + len).toString('utf8'));

const files = [];
const walk = (node, prefix) => {
  for (const [name, child] of Object.entries(node.files ?? {})) {
    const path = prefix === '' ? name : `${prefix}/${name}`;
    if (child.files !== undefined) walk(child, path);
    else files.push({ path, size: child.size ?? 0, offset: Number(child.offset ?? 0) });
  }
};
walk(header, '');

const pkgs = new Set();
for (const f of files) {
  const m = f.path.match(/^dsh\/node_modules\/(@deepseek-ai\/[^/]+)\//);
  if (m) pkgs.add(m[1]);
}
console.log(`@deepseek-ai 包数: ${pkgs.size}`);
console.log([...pkgs].sort().join('\n'));

const dshFiles = files.filter((f) => /^dsh\/node_modules\/@deepseek-ai\/[^/]+\/(lib|dist)\/.*\.js$/.test(f.path));
console.log(`\n@deepseek-ai 已编译 js: ${dshFiles.length}`);
for (const f of dshFiles.slice(0, 30)) console.log(`  ${f.path} (${f.size}B)`);
