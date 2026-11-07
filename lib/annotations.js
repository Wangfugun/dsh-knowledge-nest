/**
 * 批注落盘：把画布上的批注写成工作区 `AGENTS.local.md` 里的一个标记块。
 *
 * 宿主会把 `AGENTS.md` / `AGENTS.local.md` 渲染进模型的 instructions，
 * 于是"用户下一次发消息时 AI 能看到这段区间内的批注"不需要拦截消息就能成立。
 *
 * 三条硬约束：
 *   1. 只改 `<!-- knest:annotations:start -->` 与 `…:end -->` 之间的内容；
 *   2. 每次写之前先把原文件备份成 `AGENTS.local.md.knest.bak`；
 *   3. 批注清空时把标记块整段删掉（不留空壳）。
 */
import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

/** 标记块。 */
export const MARK_START = '<!-- knest:annotations:start -->';
export const MARK_END = '<!-- knest:annotations:end -->';

/** 单条批注 / 总条数的上限，防止把 instructions 撑爆。 */
const MAX_ENTRIES = 40;
const MAX_FIELD = 300;

/**
 * 把一条批注渲染成一行。
 * @param {{phrase?:string, note?:string, at?:number}} entry - 批注。
 * @returns {string} Markdown 行。
 */
export function renderEntry(entry) {
  const phrase = typeof entry?.phrase === 'string' ? entry.phrase.trim().slice(0, MAX_FIELD) : '';
  const note = typeof entry?.note === 'string' ? entry.note.trim().slice(0, MAX_FIELD) : '';
  if (phrase === '' && note === '') return '';
  const left = phrase === '' ? '(空选区)' : `「${phrase}」`;
  const right = note === '' ? '（标记删除）' : `改为「${note}」`;
  return `- ${left} → ${right}`;
}

/**
 * 生成整块内容（不含首尾换行以外的任何东西）。
 * @param {{entries:object[], window?:string, at?:number}} input - 批注集合与区间说明。
 * @returns {string} 标记块文本；没有条目时返回空串。
 */
export function renderBlock(input) {
  const list = Array.isArray(input?.entries) ? input.entries : [];
  const lines = [];
  for (const entry of list) {
    if (lines.length >= MAX_ENTRIES) break;
    const line = renderEntry(entry);
    if (line !== '') lines.push(line);
  }
  if (lines.length === 0) return '';
  const window = input?.window === 'user' ? '上一次用户消息' : '上一条助手回复';
  lines.unshift(`## 待修改批注（${window}之后，共 ${lines.length} 条）`);
  lines.push('');
  lines.push('阅读新消息时，请把上面的批注和用户这次说的话合起来理解：批注表示"这句要按右边的写法改"。');
  return `${MARK_START}\n${lines.join('\n')}\n${MARK_END}`;
}

/**
 * 往文件内容里塞入/替换标记块。
 * @param {string} original - 原文件内容。
 * @param {string} block - 标记块（空串表示删除）。
 * @returns {string} 新内容。
 */
export function spliceBlock(original, block) {
  const text = typeof original === 'string' ? original : '';
  const start = text.indexOf(MARK_START);
  const end = text.indexOf(MARK_END);
  const has = start >= 0 && end > start;
  const cleaned = has
    ? `${text.slice(0, start)}${text.slice(end + MARK_END.length)}`.replace(/\n{3,}/gu, '\n\n').trimEnd()
    : text.trimEnd();
  if (block === '') return cleaned === '' ? '' : `${cleaned}\n`;
  return `${cleaned === '' ? '' : `${cleaned}\n\n`}${block}\n`;
}

/**
 * 写入工作区。
 * @param {{workspaceRoot:string, file?:string, entries:object[], window?:string, dryRun?:boolean}} input - 参数。
 * @returns {{ok:boolean, file:string, bytes:number, written:boolean, removed:boolean}} 结果。
 */
export function writeAnnotations(input) {
  const root = typeof input?.workspaceRoot === 'string' && input.workspaceRoot !== '' ? input.workspaceRoot : '.';
  const name = typeof input?.file === 'string' && input.file !== '' ? input.file : 'AGENTS.local.md';
  const file = join(root, name);
  const block = renderBlock({ entries: input?.entries, window: input?.window });
  const original = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const next = spliceBlock(original, block);
  const written = next !== original;

  if (input?.dryRun === true) {
    return { ok: true, file, bytes: Buffer.byteLength(next, 'utf8'), written, removed: block === '' };
  }

  if (!written) return { ok: true, file, bytes: original.length, written: false, removed: block === '' };
  if (existsSync(file)) {
    try {
      copyFileSync(file, `${file}.knest.bak`);
    } catch {
      /* 备份失败不阻塞写入 */
    }
  }
  writeFileSync(file, next, 'utf8');
  return { ok: true, file, bytes: Buffer.byteLength(next, 'utf8'), written: true, removed: block === '' };
}
