/**
 * 设置面板：直接建在宿主页面里（Cherry Studio 注入版用）。
 *
 * 它不自己保存配置，而是把表单 POST 给本机运行的配置服务（MCP server 起的那个），
 * 由服务写进 config.json —— 这样界面和实际读取配置的地方永远是同一份。
 *
 * 为什么能用：配置服务只监听 127.0.0.1，并且允许来自 file:// 页面（Origin: null）的请求，
 * 注入进来的界面正好是这种来源；外部网页的 Origin 是域名，会被拒。
 */

import { createAppearanceSection } from './appearance.js';
import { t } from './i18n.js';
/** 面板的 class 前缀。 */
const PREFIX = 'knest-set';

/**
 * 造一个设置面板。
 *
 * @param {{doc?:Document, win?:object, port?:number, onSaved?:Function, onToast?:Function}} [options] - 配置。
 * @returns {{open:Function, close:Function, toggle:Function, isOpen:Function, refresh:Function, dispose:Function, el:HTMLElement}} 句柄。
 */
export function createSettings(options = {}) {
  const win = options.win ?? globalThis;
  const doc = options.doc ?? win.document;
  const port = Number(options.port ?? 7332);
  const base = `http://127.0.0.1:${port}`;
  const toast = typeof options.onToast === 'function' ? options.onToast : () => {};

  let presets = [];
  let picked = 'deepseek';
  let state = null;

  const root = doc.createElement('div');
  root.className = 'knest-settings';
  root.setAttribute('data-open', 'false');
  root.innerHTML = `
    <div class="knest-set-head">
      <b data-i18n="词林 · 设置">词林 · 设置</b>
      <button class="knest-set-x" type="button" title="${t('关闭')}">×</button>
    </div>
    <div class="knest-set-status" data-i18n="正在读取…">正在读取…</div>
    <div class="knest-set-look"></div>
    <div class="knest-set-presets"></div>
    <div class="knest-set-fields">
      <label><span data-i18n="接口地址">接口地址</span><input class="knest-set-url" spellcheck="false" placeholder="https://api.deepseek.com"></label>
      <label><span data-i18n="模型名">模型名</span><input class="knest-set-model" spellcheck="false" placeholder="deepseek-flash"></label>
      <label class="knest-set-key-row"><span data-i18n="钥匙">钥匙</span><input class="knest-set-key" type="password" spellcheck="false" placeholder="sk-..."></label>
    </div>
    <div class="knest-set-actions">
      <button class="knest-set-save" type="button" data-i18n="保存并测试">保存并测试</button>
      <button class="knest-set-test" type="button" data-i18n="只测试">只测试</button>
    </div>
    <div class="knest-set-msg" data-kind=""></div>
  `;
  (doc.body ?? doc.documentElement).appendChild(root);

  const $ = (selector) => root.querySelector(selector);
  const statusEl = $('.knest-set-status');

  /* 外观三个滑块：只改本地偏好，不碰模型配置 */
  const lookHost = $('.knest-set-look');
  const appearance = createAppearanceSection({ doc, onChange: () => {} });
  if (lookHost) {
    lookHost.appendChild(appearance.el);
    const lab = doc.createElement('div');
    lab.className = 'knest-set-path';
    lab.textContent = t('下面的模型配置和上面这些互不影响');
    lookHost.appendChild(lab);
  }
  const presetsEl = $('.knest-set-presets');
  const msgEl = $('.knest-set-msg');

  /**
   * 写一条结果提示。
   * @param {string} kind - ok / bad / ''。
   * @param {string} text - 文案。
   * @returns {void}
   */
  /**
   * 把所有带 data-i18n 的节点按当前语言重写。
   * 切语言时调它，不重建 DOM，用户正在填的输入不会丢。
   * @returns {void}
   */
  const retranslate = () => {
    for (const el of root.querySelectorAll('[data-i18n]')) {
      el.textContent = t(el.getAttribute('data-i18n'));
    }
  };

  const say = (kind, text) => {
    msgEl.dataset.kind = kind;
    msgEl.textContent = text;
  };

  /**
   * 画状态区。
   * @param {object} next - 服务返回的状态。
   * @returns {void}
   */
  const paintStatus = (next) => {
    if (next === null || next === undefined) return;
    state = next;
    const eff = next.effective ?? {};
    statusEl.innerHTML = ''
      + `<div>${t('当前生效')} <b>${escapeHtml(eff.baseUrl || t('（未配置）'))}</b></div>`
      + `<div>${t('模型')} <b>${escapeHtml(eff.model || t('（无）'))}</b>　${t('钥匙')} ${escapeHtml(eff.keyMasked || t('（无）'))}</div>`
      + `<div class="knest-set-path">${t('配置目录')} ${escapeHtml(next.home ?? '')}</div>`;
  };

  /**
   * 画预设按钮。
   * @returns {void}
   */
  const paintPresets = () => {
    presetsEl.innerHTML = presets.map((item) => (
      `<button type="button" data-id="${escapeHtml(item.id)}" data-on="${item.id === picked ? '1' : '0'}">`
      + `<b>${escapeHtml(item.label)}</b><span>${escapeHtml(item.hint)}</span></button>`
    )).join('');
    for (const button of presetsEl.querySelectorAll('button')) {
      button.addEventListener('click', () => pick(button.dataset.id));
    }
  };

  /**
   * 选一个预设，顺带把默认值填进表单。
   * @param {string} id - 预设 id。
   * @returns {void}
   */
  const pick = (id) => {
    picked = id;
    const preset = presets.find((item) => item.id === id);
    if (preset === undefined) return;
    paintPresets();
    $('.knest-set-url').value = preset.baseUrl || '';
    $('.knest-set-model').value = preset.model || (state?.saved?.model ?? '');
    const keyRow = $('.knest-set-key-row');
    keyRow.dataset.optional = preset.needsKey === false ? '1' : '0';
    const savedKey = state?.saved?.apiKeyMasked ?? '';
    if (preset.needsKey === false) {
      $('.knest-set-key').placeholder = t('不用填');
    } else if (savedKey !== '') {
      /* 已经存过：告诉用户留空就沿用，别让他以为丢了 */
      $('.knest-set-key').placeholder = `已保存 ${savedKey}，留空则沿用`;
    } else {
      $('.knest-set-key').placeholder = 'sk-...';
    }
    say('', '');
  };

  /**
   * 读表单。
   * @returns {object} 载荷。
   */
  const form = () => ({
    preset: picked,
    baseUrl: $('.knest-set-url').value,
    model: $('.knest-set-model').value,
    apiKey: $('.knest-set-key').value,
  });

  /**
   * 调服务。
   * @param {string} path - /state /save /test。
   * @param {object} [body] - POST 载荷。
   * @returns {Promise<object>} 结果。
   */
  const call = async (path, body) => {
    const res = await fetch(`${base}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return res.json();
  };

  /**
   * 重新读状态。
   * @returns {Promise<void>}
   */
  async function refresh() {
    try {
      const next = await call('/state');
      presets = Array.isArray(next.presets) ? next.presets : [];
      paintStatus(next);
      paintPresets();
      const savedUrl = next?.saved?.baseUrl ?? '';
      if (savedUrl !== '') {
        const guess = presets.find((item) => item.baseUrl && savedUrl.startsWith(item.baseUrl.replace(/\/v1$/u, '')));
        pick(guess?.id ?? 'custom');
        $('.knest-set-url').value = savedUrl;
        $('.knest-set-model').value = next?.saved?.model ?? '';
      } else {
        pick('deepseek');
      }
      say('', '');
    } catch (error) {
      statusEl.innerHTML = `<div>${t('读不到配置服务')}</div>`;
      say('bad', `配置服务没响应（${base}）。请确认 MCP server 正在运行。`);
    }
  }

  /* 事件 */
  $('.knest-set-x').addEventListener('click', () => close());

  $('.knest-set-save').addEventListener('click', async () => {
    const button = $('.knest-set-save');
    button.disabled = true;
    say('', t('正在保存…'));
    try {
      const saved = await call('/save', form());
      if (saved.ok !== true) {
        say('bad', saved.message ?? t('保存失败'));
        return;
      }
      paintStatus(saved.state);
      say('ok', `${saved.message}，正在测试…`);
      const tested = await call('/test', form());
      say(tested.ok === true ? 'ok' : 'bad',
        `${tested.ok === true ? '保存成功，测试通过：' : '已保存，但测试没过：'}${tested.message}`
        + (tested.detail ? `\n${tested.detail}` : ''));
      if (tested.ok === true) {
        toast('词林：配置已生效');
        if (typeof options.onSaved === 'function') options.onSaved(saved.state);
      }
    } catch (error) {
      say('bad', `请求失败：${String(error?.message ?? error).slice(0, 120)}`);
    } finally {
      button.disabled = false;
    }
  });

  $('.knest-set-test').addEventListener('click', async () => {
    const button = $('.knest-set-test');
    button.disabled = true;
    say('', '正在测试…');
    try {
      const tested = await call('/test', form());
      say(tested.ok === true ? 'ok' : 'bad',
        tested.message + (tested.detail ? `\n${tested.detail}` : ''));
    } catch (error) {
      say('bad', `请求失败：${String(error?.message ?? error).slice(0, 120)}`);
    } finally {
      button.disabled = false;
    }
  });

  root.addEventListener('mousedown', (event) => event.stopPropagation());
  root.addEventListener('contextmenu', (event) => event.stopPropagation());

  /**
   * 打开面板。
   * @returns {void}
   */
  function open() {
    root.setAttribute('data-open', 'true');
    retranslate();
    refresh();
  }

  /**
   * 关闭面板。
   * @returns {void}
   */
  function close() {
    root.setAttribute('data-open', 'false');
  }

  /**
   * 开关。
   * @returns {void}
   */
  function toggle() {
    if (root.getAttribute('data-open') === 'true') close();
    else open();
  }

  /**
   * 是否打开。
   * @returns {boolean} 状态。
   */
  const isOpen = () => root.getAttribute('data-open') === 'true';

  /**
   * 卸载。
   * @returns {void}
   */
  function dispose() {
    root.remove();
  }

  return { open, close, toggle, isOpen, refresh, retranslate, dispose, el: root };
}

/**
 * HTML 转义，避免配置里的尖括号破坏结构。
 * @param {unknown} value - 原值。
 * @returns {string} 安全字符串。
 */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;');
}
