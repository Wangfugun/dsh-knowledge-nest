/**
 * 磁盘缓存：一个词在**同一段对话**里只解释一次。
 *
 * 三条规矩（都是踩出来的）：
 *   1. **只存成功**：一次 429/风控不该把一个词钉死 30 天；
 *   2. **版本号**：语义变了就升 FORMAT，旧文件整体作废（读到时版本不符直接当空表）；
 *   3. **原子写**：先写 tmp 再 rename；写到一半断电也不会留下半截 JSON。
 *
 * 纯本地文件操作，绝不 throw（坏盘/坏文件都降级成"没有缓存"）。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** 缓存语义版本：改解释结构就要 +1。 */
export const CACHE_FORMAT = 1;

/** 默认存活期：30 天。 */
export const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** 默认条目上限（超了先扔最旧的）。 */
export const DEFAULT_MAX_ENTRIES = 400;

/**
 * 造一份磁盘缓存。
 * @param {{file:string, ttlMs?:number, max?:number, now?:()=>number}} options - 文件路径与策略。
 * @returns {{get:Function,set:Function,stats:Function,clear:Function,file:string}} 缓存句柄。
 */
export function createCache(options) {
  const file = String(options?.file ?? '');
  const ttlMs = Number.isFinite(options?.ttlMs) ? options.ttlMs : DEFAULT_TTL_MS;
  const max = Number.isFinite(options?.max) ? options.max : DEFAULT_MAX_ENTRIES;
  const now = typeof options?.now === 'function' ? options.now : Date.now;

  /** @type {{version:number, entries:Record<string,{at:number, value:object}>}|null} */
  let table = null;
  let hits = 0;
  let misses = 0;
  let writes = 0;

  const empty = () => ({ version: CACHE_FORMAT, entries: {} });

  const load = () => {
    if (table !== null) return table;
    table = empty();
    try {
      if (!existsSync(file)) return table;
      const raw = readFileSync(file, 'utf8').replace(/^\uFEFF/u, '');
      const parsed = JSON.parse(raw);
      if (parsed === null || typeof parsed !== 'object') return table;
      if (parsed.version !== CACHE_FORMAT) return table; /* 语义变了：整份作废 */
      const entries = parsed.entries;
      if (entries === null || typeof entries !== 'object' || Array.isArray(entries)) return table;
      const clean = {};
      for (const [key, entry] of Object.entries(entries)) {
        if (typeof key !== 'string' || key === '') continue;
        if (entry === null || typeof entry !== 'object') continue;
        if (!Number.isFinite(entry.at)) continue;
        if (entry.value === null || typeof entry.value !== 'object') continue;
        clean[key] = { at: entry.at, value: entry.value };
      }
      table = { version: CACHE_FORMAT, entries: clean };
    } catch {
      table = empty();
    }
    return table;
  };

  const flush = () => {
    try {
      const data = load();
      const trimmed = Object.entries(data.entries)
        .sort((left, right) => right[1].at - left[1].at)
        .slice(0, max);
      const payload = JSON.stringify({ version: CACHE_FORMAT, entries: Object.fromEntries(trimmed) });
      mkdirSync(dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
      writeFileSync(tmp, payload, 'utf8');
      try {
        renameSync(tmp, file);
      } catch {
        /* 目标被占用：退一步直接覆盖写 */
        writeFileSync(file, payload, 'utf8');
        try {
          unlinkSync(tmp);
        } catch {
          /* 忽略 */
        }
      }
      writes += 1;
      return true;
    } catch {
      return false;
    }
  };

  return {
    file,
    /**
     * 取一条（过期即视为没有）。
     * @param {string} key - 缓存键。
     * @returns {object|null} 值。
     */
    get(key) {
      if (typeof key !== 'string' || key === '') return null;
      const data = load();
      const entry = data.entries[key];
      if (entry === undefined) {
        misses += 1;
        return null;
      }
      if (now() - entry.at > ttlMs) {
        delete data.entries[key];
        misses += 1;
        return null;
      }
      hits += 1;
      return entry.value;
    },
    /**
     * 存一条（只该在成功时调用）。
     * @param {string} key - 缓存键。
     * @param {object} value - 解释结果。
     * @returns {boolean} 是否落盘成功。
     */
    set(key, value) {
      if (typeof key !== 'string' || key === '' || value === null || typeof value !== 'object') return false;
      const data = load();
      data.entries[key] = { at: now(), value };
      return flush();
    },
    /**
     * 统计（给状态页）。
     * @returns {{entries:number,hits:number,misses:number,writes:number,format:number,file:string}} 快照。
     */
    stats() {
      return {
        entries: Object.keys(load().entries).length,
        hits,
        misses,
        writes,
        format: CACHE_FORMAT,
        file,
      };
    },
    /**
     * 清空。
     * @returns {boolean} 是否成功。
     */
    clear() {
      table = empty();
      try {
        if (existsSync(file)) unlinkSync(file);
        return true;
      } catch {
        return false;
      }
    },
  };
}
