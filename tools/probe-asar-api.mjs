/**
 * 只读探针 v6：定向释放 fs 服务、侧边栏、附件/上传、插槽相关的包，并做关键字统计。
 */
import { openSync, readSync, closeSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ASAR = 'D:\\360安全浏览器下载\\resources\\app.asar';
const fd = openSync(ASAR, 'r');
const head = Buffer.alloc(8 * 1024 * 1024);
readSync(fd, head, 0, head.length, 0);
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

const pkgs = [...new Set(files
  .map((f) => f.path.match(/^dsh\/node_modules\/(@deepseek-ai\/[^/]+)\//))
  .filter(Boolean)
  .map((m) => m[1]))];

console.log('=== 名字里带 fs / 文件 / 侧栏 / 附件 / 插槽 的包 ===');
const wanted = pkgs.filter((p) => /(^|\/)(dsh-fs|.*-fs$)|file|sidebar|attachment|slot|layout/i.test(p));
for (const p of wanted) console.log('  ' + p);

const outDir = join(process.env.TEMP ?? '.', 'dsh-api-probe2');
mkdirSync(outDir, { recursive: true });
let saved = 0;
for (const f of files) {
  if (!wanted.some((p) => f.path.startsWith(`dsh/node_modules/${p}/`))) continue;
  if (!/\.(js|json)$/.test(f.path) || f.size > 300 * 1024) continue;
  const buf = Buffer.alloc(f.size);
  readSync(fd, buf, 0, f.size, dataStart + f.offset);
  writeFileSync(join(outDir, f.path.replace(/^dsh\/node_modules\/@deepseek-ai\//, '').replace(/[/\\]/g, '__')), buf);
  saved += 1;
}
closeSync(fd);
console.log(`\n释放 ${saved} 个文件 → ${outDir}`);

/* 在释放出来的文件里统计关键 API */
const hits = new Map();
for (const name of readdirSync(outDir)) {
  const text = readFileSync(join(outDir, name), 'utf8');
  for (const m of text.matchAll(/ctx\.[a-zA-Z]+(?:\.[a-zA-Z]+)?/g)) {
    hits.set(m[0], (hits.get(m[0]) ?? 0) + 1);
  }
}
console.log('\n=== ctx.* 出现频次（Top 30）===');
for (const [key, count] of [...hits].sort((a, b) => b[1] - a[1]).slice(0, 30)) console.log(`  ${count.toString().padStart(4)}  ${key}`);
