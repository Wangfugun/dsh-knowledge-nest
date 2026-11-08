/**
 * 词林 · 外观与行为偏好
 *
 * 三件事都从这里出：
 *   1. 六套外观（含一套彩虹渐变发光边框）
 *   2. 三档卡片尺寸
 *   3. 三档解释详细度
 *
 * 所有选择存进 localStorage，刷新后还在。切换时给 <html> 打
 * data-knest-skin / data-knest-size / data-knest-depth，样式全在 CSS 里。
 */

/** 外观清单。id 会写进 data-knest-skin。 */
export const THEMES = Object.freeze([
  { id: 'ink', label: '深灰', note: '直角，无阴影' },
  { id: 'nebula', label: '彩虹', note: '渐变描边，唯一带发光的一套' },
  { id: 'neon', label: '青', note: '切角，单色' },
  { id: 'jade', label: '浅玉', note: '浅底深字，大圆角' },
  { id: 'paper', label: '纸白', note: '纸色，靠字距' },
  { id: 'mono', label: '琥珀', note: '等宽，琥珀屏' },
]);

/** 尺寸档。影响卡片宽、字号、行距、圆角。 */
export const SIZES = Object.freeze([
  { id: 'sm', label: '小', note: '宽 280，13 号字' },
  { id: 'md', label: '中', note: '宽 360，14 号字' },
  { id: 'lg', label: '大', note: '宽 460，16 号字' },
]);

/** 详细度。直接决定提示词里允许多少字。 */
/**
 * 解释长度：连续区间，不是三档。
 *
 * 之前是简洁/正常/详细三档，滑起来只有三个落点，手感很硬。
 * 改成 20 到 500 字的连续滑块，每一格都能停。
 */
export const CHAR_RANGE = Object.freeze({ min: 20, max: 500, step: 10, def: 90 });

/**
 * 按字数给个口头档位，只为显示，不影响实际取值。
 * @param {number} n - 字数。
 * @returns {string} 简洁 / 正常 / 详细。
 */
export function depthLabel(n) {
  if (n <= 50) return '简洁';
  if (n <= 160) return '正常';
  return '详细';
}

/** 支持的语言。文案全部人工撰写，不走机器翻译。 */
export const LANGS = Object.freeze([
  { id: 'zh-CN', label: '简体中文' },
  { id: 'zh-TW', label: '繁體中文' },
  { id: 'en', label: 'English' },
  { id: 'ja', label: '日本語' },
  { id: 'ko', label: '한국어' },
  { id: 'de', label: 'Deutsch' },
  { id: 'fr', label: 'Français' },
  { id: 'es', label: 'Español' },
  { id: 'ru', label: 'Русский' },
]);

const KEY = 'knest.prefs';
const DEFAULTS = Object.freeze({ skin: 'ink', size: 'md', charLimit: 90, lang: 'zh-CN' });

/**
 * 读偏好。坏数据一律退回默认，不让面板因为一个脏字段打不开。
 * @returns {{skin:string, size:string, depth:string, lang:string}} 偏好。
 */
export function readPrefs() {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    return {
      skin: THEMES.some((t) => t.id === parsed?.skin) ? parsed.skin : DEFAULTS.skin,
      size: SIZES.some((s) => s.id === parsed?.size) ? parsed.size : DEFAULTS.size,
      charLimit: Number.isFinite(parsed?.charLimit)
        ? Math.max(CHAR_RANGE.min, Math.min(CHAR_RANGE.max, Math.round(parsed.charLimit)))
        : DEFAULTS.charLimit,
      lang: LANGS.some((l) => l.id === parsed?.lang) ? parsed.lang : DEFAULTS.lang,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

/**
 * 写偏好并存档。
 * @param {Partial<{skin:string,size:string,depth:string,lang:string}>} patch - 要改的字段。
 * @returns {object} 合并后的完整偏好。
 */
export function writePrefs(patch) {
  const next = { ...readPrefs(), ...patch };
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(next));
  } catch {
    /* 隐私模式下写不进去，功能照用，只是刷新会丢 */
  }
  applyPrefs(next);
  /* 广播一次，让面板文案跟着换（不重建 DOM） */
  try {
    globalThis.dispatchEvent?.(new CustomEvent('knest-prefs', { detail: next }));
  } catch { /* 老宿主没有 CustomEvent，忽略 */ }
  return next;
}

/**
 * 把偏好打到根元素上，样式靠这个切换。
 * @param {object} [prefs] - 偏好，不传就现读。
 * @returns {void}
 */
export function applyPrefs(prefs) {
  const p = prefs ?? readPrefs();
  const root = globalThis.document?.documentElement;
  if (!root) return;
  root.setAttribute('data-knest-skin', p.skin);
  root.setAttribute('data-knest-size', p.size);
  root.setAttribute('data-knest-lang', p.lang);
}

/** 各档详细度对应的字数上限，提示词要用。 */
export const DEPTH_LIMIT = Object.freeze({ brief: 40, normal: 90, deep: 200 });

/**
 * 当前详细度的字数上限。
 * @returns {number} 字数。
 */
export function currentLimit() {
  return readPrefs().charLimit;
}

/**
 * 当前语言。
 * @returns {string} zh-CN / en / ja。
 */
export function currentLang() {
  return readPrefs().lang;
}
