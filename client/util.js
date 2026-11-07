/**
 * 浏览器侧的小工具：清洗 markdown 记号、哈希、截断。
 *
 * 全部是纯函数，不碰 DOM，node 里能直接测。
 */

/**
 * 把 markdown 记号洗成人能读的纯文本（只用于**显示与喂给模型**，不是渲染器）。
 *
 * 代码围栏保留内容、去掉围栏行；标题/引用/列表去掉记号；表格行用 ` · ` 连起来。
 * @param {unknown} text - 原始文本。
 * @returns {string} 干净文本。
 */
export function cleanMarkdown(text) {
  if (typeof text !== 'string' || text === '') return '';
  try {
    return text
      .replace(/\r\n?/gu, '\n')
      .replace(/^[ \t]*```[^\n]*$/gmu, '')
      .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gmu, '')
      .replace(/^[ \t]{0,3}>[ \t]?/gmu, '')
      .replace(/^[ \t]{0,3}[-*+][ \t]+/gmu, '· ')
      .replace(/^[ \t]*\|?[ \t:|-]{3,}\|[ \t:|-]*$/gmu, '')
      .replace(/^[ \t]*\|(.+)\|[ \t]*$/gmu, (line, inner) => inner
        .split('|')
        .map((cell) => cell.trim())
        .filter((cell) => cell !== '')
        .join(' · '))
      .replace(/\*\*([^*\n]+)\*\*/gu, '$1')
      .replace(/__([^_\n]+)__/gu, '$1')
      .replace(/~~([^~\n]+)~~/gu, '$1')
      .replace(/`([^`\n]+)`/gu, '$1')
      .replace(/!\[([^\]\n]*)\]\([^)\n]*\)/gu, '$1')
      .replace(/\[([^\]\n]+)\]\([^)\n]*\)/gu, '$1')
      .replace(/[ \t]+$/gmu, '')
      .replace(/\n{3,}/gu, '\n\n')
      .trim();
  } catch {
    return text;
  }
}

/**
 * FNV-1a 32 位哈希，base36。用来做对话指纹（稳定、够短、不需要抗碰撞）。
 * @param {unknown} input - 任意字符串。
 * @returns {string} 短哈希。
 */
export function hashString(input) {
  const text = typeof input === 'string' ? input : String(input ?? '');
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/**
 * 压空白 + 截断（保头，带省略号）。
 * @param {unknown} text - 输入。
 * @param {number} limit - 上限。
 * @returns {string} 结果。
 */
export function clampText(text, limit) {
  const flat = typeof text === 'string' ? text.replace(/\s+/gu, ' ').trim() : '';
  const max = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 0;
  if (max === 0 || flat.length <= max) return flat;
  return `${flat.slice(0, Math.max(1, max - 1))}…`;
}

/**
 * 保头也保尾的截断（对话上下文用：开头定义术语，结尾才是"现在"）。
 * @param {unknown} text - 输入。
 * @param {number} limit - 上限。
 * @returns {string} 结果。
 */
export function clampMiddle(text, limit) {
  const value = typeof text === 'string' ? text : '';
  const max = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 0;
  if (max === 0 || value.length <= max) return value;
  const head = Math.floor(max * 0.45);
  const tail = max - head - 10;
  return `${value.slice(0, head)}…${value.slice(value.length - tail)}`;
}
