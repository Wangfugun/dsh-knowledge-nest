#!/usr/bin/env node
/**
 * 读 Cherry 里 knowledge-nest 这个 MCP 服务器的开关状态。
 *
 * 输出：`1` 启用 / `0` 停用 / 空 表示读不到（比如库被锁）。
 *
 * 为什么要读数据库：Cherry 的 MCP 开关不做任何外部通知，
 * 想让词林的界面跟着开关走，只能去它的 sqlite 里看 `mcp_server.is_active`。
 *
 * 用法：
 *   node tools/mcp-active.mjs
 *   node tools/mcp-active.mjs --db=D:\path\cherrystudio.sqlite --name=knowledge-nest
 */
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const hit = argv.find((item) => item.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
};

const dbPath = argOf('db', 'D:\\Apps\\CherryStudioData\\Data\\cherrystudio.sqlite');
const name = argOf('name', 'knowledge-nest');

if (!existsSync(dbPath)) {
  /* 读不到就输出空，调用方当作「不知道」处理，别擅自卸载 */
  process.exit(2);
}

let db;
try {
  db = new DatabaseSync(dbPath, { readOnly: true });
  const row = db.prepare('SELECT is_active FROM mcp_server WHERE name = ?').get(name);
  if (row === undefined || row === null) {
    process.stdout.write('');
    process.exit(3);
  }
  process.stdout.write(row.is_active === 1 ? '1' : '0');
  process.exit(0);
} catch {
  /* 库被锁或格式不对：输出空，让调用方保持现状 */
  process.exit(4);
} finally {
  try { db?.close(); } catch { /* 忽略 */ }
}
