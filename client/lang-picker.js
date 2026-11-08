/**
 * 语言选择：一排国旗，点一下就换，悬浮放大并浮出语言名。
 *
 * 为什么不用 emoji 国旗：Windows 的 Segoe UI Emoji 不含区域指示符，
 * 🇨🇳 会渲染成「CN」两个字母。所以国旗全用 CSS 画——
 * 横条竖条用 linear-gradient，圆形与星星用伪元素。
 */

import { LANGS, readPrefs, writePrefs } from './prefs.js';
import { t } from './i18n.js';

/**
 * 造国旗选择器。
 *
 * @param {{doc:Document, onChange?:Function}} options - 参数。
 * @returns {{el:HTMLElement, refresh:Function}} 句柄。
 */
export function createLanguagePicker(options) {
  const doc = options.doc;
  const onChange = typeof options.onChange === 'function' ? options.onChange : () => {};

  let prefs = readPrefs();

  const wrap = doc.createElement('div');
  wrap.className = 'knest-langs';

  const label = doc.createElement('div');
  label.className = 'knest-langs-label';
  label.textContent = t('语言');
  wrap.appendChild(label);

  const grid = doc.createElement('div');
  grid.className = 'knest-langs-grid';
  wrap.appendChild(grid);

  const buttons = [];

  for (const lang of LANGS) {
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'knest-flag';
    btn.setAttribute('data-lang', lang.id);
    btn.setAttribute('aria-label', lang.label);
    btn.title = lang.label;

    const box = doc.createElement('span');
    box.className = 'knest-flag-box';
    box.setAttribute('data-flag', lang.id);

    const name = doc.createElement('span');
    name.className = 'knest-flag-name';
    name.textContent = lang.label;

    btn.appendChild(box);
    btn.appendChild(name);
    grid.appendChild(btn);
    buttons.push({ btn, lang });

    btn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      prefs = writePrefs({ lang: lang.id });
      paint();
      onChange('lang', lang.id);
    });
  }

  /**
   * 把选中态画上去。
   * @returns {void}
   */
  const paint = () => {
    label.textContent = t('语言');
    for (const { btn, lang } of buttons) {
      btn.setAttribute('data-on', lang.id === prefs.lang ? '1' : '0');
      btn.title = lang.label;
    }
  };

  paint();

  return {
    el: wrap,
    /**
     * 外部改了语言时同步。
     * @returns {void}
     */
    refresh: () => {
      prefs = readPrefs();
      paint();
    },
  };
}
