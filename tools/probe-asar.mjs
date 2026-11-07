/**
 * 只读探针 v3：定位 asar 头 JSON 的真实起点与长度（逐长度试解析）。
 */
import { openSync, readSync, closeSync, statSync } from 'node:fs';

const ASAR = 'D:\\360安全浏览器下载\\resources\\app.asar';
const fd = openSync(ASAR, 'r');
const HEAD_BYTES = 8 * 1024 * 1024;
const buf = Buffer.alloc(HEAD_BYTES);
const readBytes = readSync(fd, buf, 0, HEAD_BYTES, 0);
closeSync(fd);

const l4 = buf.readUInt32LE(4);
const l8 = buf.readUInt32LE(8);
const l12 = buf.readUInt32LE(12);
console.log(`declared: @4=${l4} @8=${l8} @12=${l12} read=${readBytes}`);

const candidates = [];
for (const [start, len] of [[16, l4], [16, l8], [16, l12], [8, l4], [12, l8]]) {
  try {
    const parsed = JSON.parse(buf.subarray(start, start + len).toString('utf8'));
    candidates.push({ start, len, parsed });
    console.log(`✔ JSON 解析成功：start=${start} len=${len}`);
    break;
  } catch (error) {
    console.log(`✘ start=${start} len=${len} → ${error.message.slice(0, 60)}`);
  }
}
if (candidates.length === 0) process.exit(1);

const { start, parsed } = candidates[0];
const files = [];
const walk = (node, prefix) => {
  for (const [name, child] of Object.entries(node.files ?? {})) {
    const path = prefix === '' ? name : `${prefix}/${name}`;
    if (child.files !== undefined) walk(child, path);
    else files.push({ path, size: child.size ?? 0, offset: Number(child.offset ?? 0) });
  }
};
walk(parsed, '');
console.log('文件总数:', files.length);

/* 校验数据起点：第一个文件 offset 应为 0 */
const first = files[0];
console.log('第一个文件:', first.path, 'offset=', first.offset);

const show = (label, re, limit = 18) => {
  const list = files.filter((f) => re.test(f.path));
  console.log(`\n=== ${label}: ${list.length} ===`);
  for (const f of list.slice(0, limit)) console.log(`  ${f.path}  (${f.size}B)`);
  return list;
};

show('d.ts', /\.d\.ts$/);
show('slot', /slot/i);
show('workspace', /workspace/i);
show('plugin', /plugin/i);
show('dsh 根 package.json', /^node_modules\/@deepseek-ai\/[^/]+\/package\.json$/);
