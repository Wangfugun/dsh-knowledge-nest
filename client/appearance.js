/**
 * 设置面板里「外观」那一节。
 *
 * 长度滑块是**连续区间**（20–500 字），不是三档——三档只有三个落点，
 * 拖起来发涩。拖动时数字、轨道填充、预览卡正文三处同时跟手，
 * 松手有一个很短的回落，手感才"活"。
 */

import { t } from './i18n.js';
import { createLanguagePicker } from './lang-picker.js';
import { THEMES, SIZES, LANGS, CHAR_RANGE, depthLabel, readPrefs, writePrefs, applyPrefs } from './prefs.js';

const FULL_TEXT = '不是把东西摆整齐，而是让所有人对同一件事有同一个理解。开会前先说清要解决什么，避免各做各的。';

/**
 * 造「外观」区块。
 *
 * @param {{doc:Document, onChange?:Function}} options - 参数。
 * @returns {{el:HTMLElement, refresh:Function}} 句柄。
 */
export function createAppearanceSection(options) {
  const doc = options.doc;
  const onChange = typeof options.onChange === 'function' ? options.onChange : () => {};

  let prefs = readPrefs();
  const wrap = doc.createElement('div');
  wrap.className = 'knest-set-sliders';

  /**
   * 造一个档位滑块。
   * @param {object} row - { key, name, list, note }。
   * @returns {object} 句柄。
   */
  const makeStepped = (row) => {
    const box = doc.createElement('div');
    box.className = 'knest-slider';

    const top = doc.createElement('div');
    top.className = 'top';
    const nm = doc.createElement('span');
    nm.className = 'nm';
    nm.textContent = row.name;
    const vl = doc.createElement('span');
    vl.className = 'vl';
    top.appendChild(nm);
    top.appendChild(vl);

    const input = doc.createElement('input');
    input.type = 'range';
    input.min = '0';
    input.max = String(row.list.length - 1);
    input.step = '1';
    input.className = 'knest-range';

    const note = doc.createElement('div');
    note.className = 'note';

    box.appendChild(top);
    box.appendChild(input);
    box.appendChild(note);
    wrap.appendChild(box);
    return { row, input, vl, note, nm };
  };

  const skinH = makeStepped({ key: 'skin', name: '外观', list: THEMES, note: (i) => i.note });
  const sizeH = makeStepped({ key: 'size', name: '卡片大小', list: SIZES, note: (i) => i.note });

  /* ── 连续字数滑块 ───────────────────────────────────────────── */
  const lenBox = doc.createElement('div');
  lenBox.className = 'knest-slider';

  const lenTop = doc.createElement('div');
  lenTop.className = 'top';
  const lenNm = doc.createElement('span');
  lenNm.className = 'nm';
  lenNm.textContent = '解释长度';
  const lenVl = doc.createElement('span');
  lenVl.className = 'vl knest-len-val';
  lenTop.appendChild(lenNm);
  lenTop.appendChild(lenVl);

  const lenInput = doc.createElement('input');
  lenInput.type = 'range';
  lenInput.className = 'knest-range';
  lenInput.min = String(CHAR_RANGE.min);
  lenInput.max = String(CHAR_RANGE.max);
  lenInput.step = String(CHAR_RANGE.step);

  const lenNote = doc.createElement('div');
  lenNote.className = 'note';

  lenBox.appendChild(lenTop);
  lenBox.appendChild(lenInput);
  lenBox.appendChild(lenNote);
  wrap.appendChild(lenBox);


  /* 语言用国旗选，比滑块直观 */
  /* 语言一变，滑块标题与预览要立刻跟着换；picker 自己不重建 */
  const langPicker = createLanguagePicker({
    doc,
    onChange: (key, value) => {
      paint(false);
      onChange(key, value);
    },
  });
  wrap.appendChild(langPicker.el);

  const preview = doc.createElement('div');
  preview.className = 'knest-set-preview';
  preview.innerHTML = '<b>对齐</b><span class="knest-prev-body"></span>';
  wrap.appendChild(preview);

  /**
   * 让预览正文跟着字数变。
   * @param {number} n - 字数。
   * @returns {void}
   */
  const paintPreview = (n) => {
    const body = preview.querySelector('.knest-prev-body');
    if (!body) return;
    const take = Math.max(10, Math.min(FULL_TEXT.length, n));
    body.textContent = FULL_TEXT.slice(0, take) + (take < FULL_TEXT.length ? '…' : '');
  };

  /**
   * 把 prefs 画到控件上。
   * @param {boolean} [bump] - 是否播一次数字回弹。
   * @returns {void}
   */
  const paint = (bump) => {
    for (const h of [skinH, sizeH]) {
      /* 标题每次重画：切语言后要跟着变 */
      h.nm.textContent = t(h.row.name);
      const idx = Math.max(0, h.row.list.findIndex((item) => item.id === prefs[h.row.key]));
      const item = h.row.list[idx] ?? h.row.list[0];
      h.input.value = String(idx);
      const pct = h.row.list.length > 1 ? (idx / (h.row.list.length - 1)) * 100 : 0;
      h.input.style.setProperty('--fill', `${pct}%`);
      h.vl.textContent = t(item.label);
      h.note.textContent = t(h.row.note(item) ?? '');
    }

    lenNm.textContent = t('解释长度');
    const n = prefs.charLimit;
    lenInput.value = String(n);
    const pct = ((n - CHAR_RANGE.min) / (CHAR_RANGE.max - CHAR_RANGE.min)) * 100;
    lenInput.style.setProperty('--fill', `${pct}%`);
    lenVl.textContent = `${n} · ${t(depthLabel(n))}`;
    lenNote.textContent = t('往左更短，往右更详细');
    paintPreview(n);

    if (bump) {
      lenVl.classList.remove('knest-bump');
      void lenVl.offsetWidth;
      lenVl.classList.add('knest-bump');
    }

    applyPrefs(prefs);
    langPicker?.refresh?.();
  };

  for (const h of [skinH, sizeH]) {
    h.input.addEventListener('input', () => {
      const item = h.row.list[Number(h.input.value)];
      if (item === undefined) return;
      prefs = writePrefs({ [h.row.key]: item.id });
      paint(false);
      onChange(h.row.key, item.id);
    });
  }

  /* 拖动中实时跟手（不写盘），松手才存 */
  lenInput.addEventListener('input', () => {
    const n = Number(lenInput.value);
    const pct = ((n - CHAR_RANGE.min) / (CHAR_RANGE.max - CHAR_RANGE.min)) * 100;
    lenInput.style.setProperty('--fill', `${pct}%`);
    lenVl.textContent = `${n} · ${t(depthLabel(n))}`;
    paintPreview(n);
  });
  lenInput.addEventListener('change', () => {
    prefs = writePrefs({ charLimit: Number(lenInput.value) });
    paint(true);
    onChange('charLimit', prefs.charLimit);
  });

  paint(false);

  return {
    el: wrap,
    /**
     * 外部改了偏好时同步一次。
     * @returns {void}
     */
    refresh: () => {
      prefs = readPrefs();
      paint(false);
    },
  };
}
