/**
 * 主题：跟着宿主走，自己兜底。
 *
 * 判定顺序（越靠前越可信）：
 *   1. 宿主写在 `<html>`/`<body>` 上的 `data-theme` / `class` 里的 dark|light；
 *   2. `--dsw-alias-bg-base` 的实际颜色（宿主自己的令牌）算亮度；
 *   3. `<body>` 的背景色算亮度；
 *   4. 系统 `prefers-color-scheme`。
 *
 * 判完把结果写在 `<html data-knest-theme="…">` 上：`::highlight()` 拿不到插件容器的
 * 私有变量，只能挂在这种"全文档可见"的位置，绿色高亮才不会在亮色底上糊掉。
 */

/** 我们写在 <html> 上的属性名（带前缀，避免和宿主自己的 data-theme 打架）。 */
export const THEME_ATTR = 'data-knest-theme';

/** 宿主令牌名。 */
const HOST_TOKEN = '--dsw-alias-bg-base';

/**
 * 解析颜色串 → 亮度（0 黑 … 1 白）。认 `rgb()/rgba()/#rgb/#rrggbb`，其它返回 null。
 * @param {unknown} value - 颜色字符串。
 * @returns {number|null} 亮度；解析不了是 null。
 */
export function colorLuminance(value) {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (text === '') return null;
  let r = null;
  let g = null;
  let b = null;
  const rgb = text.match(/^rgba?\(([^)]+)\)$/u);
  if (rgb) {
    const parts = rgb[1].split(/[,/\s]+/u).filter((part) => part !== '');
    if (parts.length >= 3) {
      r = Number.parseFloat(parts[0]);
      g = Number.parseFloat(parts[1]);
      b = Number.parseFloat(parts[2]);
    }
  } else {
    const hex = text.match(/^#([0-9a-f]{3,8})$/u);
    if (hex) {
      let body = hex[1];
      if (body.length === 3 || body.length === 4) {
        body = body.split('').map((ch) => `${ch}${ch}`).join('');
      }
      if (body.length >= 6) {
        r = Number.parseInt(body.slice(0, 2), 16);
        g = Number.parseInt(body.slice(2, 4), 16);
        b = Number.parseInt(body.slice(4, 6), 16);
      }
    }
  }
  if (![r, g, b].every((n) => Number.isFinite(n))) return null;
  const channel = (n) => {
    const c = Math.min(255, Math.max(0, n)) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * 从元素属性里读"宿主自己声明的主题"。
 * @param {Element|null} element - html 或 body。
 * @returns {'light'|'dark'|null} 主题；没声明是 null。
 */
function declaredTheme(element) {
  if (element === null || element === undefined || typeof element.getAttribute !== 'function') return null;
  const attr = element.getAttribute('data-theme') ?? element.getAttribute('theme') ?? '';
  if (/dark/iu.test(attr)) return 'dark';
  if (/light/iu.test(attr)) return 'light';
  const className = typeof element.className === 'string' ? element.className : '';
  if (/(^|\s)(dark|theme-dark)(\s|$)/iu.test(className)) return 'dark';
  if (/(^|\s)(light|theme-light)(\s|$)/iu.test(className)) return 'light';
  return null;
}

/**
 * 判主题。
 * @param {Document} [doc] - 文档（测试可注入假 doc）。
 * @returns {'light'|'dark'} 主题。
 */
export function detectTheme(doc) {
  const document = doc ?? (typeof globalThis.document === 'undefined' ? null : globalThis.document);
  if (document === null) return 'dark';
  try {
    const html = document.documentElement;
    const body = document.body;
    const declared = declaredTheme(html) ?? declaredTheme(body);
    if (declared !== null) return declared;

    const view = document.defaultView;
    if (view !== null && view !== undefined && typeof view.getComputedStyle === 'function') {
      const hostToken = view.getComputedStyle(html).getPropertyValue(HOST_TOKEN);
      const fromToken = colorLuminance(hostToken);
      if (fromToken !== null) return fromToken > 0.5 ? 'light' : 'dark';
      if (body !== null && body !== undefined) {
        const fromBody = colorLuminance(view.getComputedStyle(body).backgroundColor);
        if (fromBody !== null) return fromBody > 0.5 ? 'light' : 'dark';
      }
    }
  } catch {
    /* 计算样式拿不到就走系统偏好 */
  }
  try {
    const media = typeof globalThis.matchMedia === 'function' ? globalThis.matchMedia('(prefers-color-scheme: light)') : null;
    if (media !== null && typeof media.matches === 'boolean') return media.matches ? 'light' : 'dark';
  } catch {
    /* 忽略 */
  }
  return 'dark';
}

/**
 * 把主题写到 `<html>`（高亮样式靠它着色）。
 * @param {Document} doc - 文档。
 * @param {'light'|'dark'} theme - 主题。
 * @returns {void}
 */
export function stampTheme(doc, theme) {
  try {
    const html = doc?.documentElement;
    if (html === null || html === undefined || typeof html.setAttribute !== 'function') return;
    if (html.getAttribute(THEME_ATTR) !== theme) html.setAttribute(THEME_ATTR, theme);
  } catch {
    /* 忽略 */
  }
}

/**
 * 盯着主题变化：宿主换主题、系统换偏好都会回调。
 * @param {Document} doc - 文档。
 * @param {(theme:'light'|'dark')=>void} onChange - 回调。
 * @returns {Function} 卸载函数。
 */
export function watchTheme(doc, onChange) {
  const document = doc ?? (typeof globalThis.document === 'undefined' ? null : globalThis.document);
  if (document === null || typeof onChange !== 'function') return () => {};
  let last = '';
  const check = () => {
    const theme = detectTheme(document);
    if (theme === last) return;
    last = theme;
    stampTheme(document, theme);
    try {
      onChange(theme);
    } catch {
      /* 回调异常不影响观察 */
    }
  };
  check();

  let observer = null;
  try {
    if (typeof document.defaultView?.MutationObserver === 'function') {
      observer = new document.defaultView.MutationObserver(check);
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class', 'data-theme', 'theme', 'style', THEME_ATTR],
      });
    }
  } catch {
    observer = null;
  }

  let media = null;
  const onMedia = () => check();
  try {
    if (typeof document.defaultView?.matchMedia === 'function') {
      media = document.defaultView.matchMedia('(prefers-color-scheme: dark)');
      if (typeof media.addEventListener === 'function') media.addEventListener('change', onMedia);
    }
  } catch {
    media = null;
  }

  return () => {
    try {
      if (observer !== null) observer.disconnect();
    } catch {
      /* 忽略 */
    }
    try {
      if (media !== null && typeof media.removeEventListener === 'function') media.removeEventListener('change', onMedia);
    } catch {
      /* 忽略 */
    }
  };
}
