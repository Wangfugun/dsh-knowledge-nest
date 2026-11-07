/**
 * 生成静态预览页，用来**真的看一眼**设计。
 *
 * 用的是真样式表 + 真布局函数（layoutMap），只是把 React 换成手写 HTML，
 * 这样没有宿主也能截图检查排版、配色、窗口 chrome、托盘与菜单。
 *
 * 用法：node tools/preview.mjs → preview/{dark,light,menu-dark}.html
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { KNEST_CSS } from '../client/styles.js';
import { layoutMap } from '../client/layout.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'preview');

const messages = [
  { id: 'u1', role: 'you', text: '我想把这个项目推倒重来，用户可以鼠标右键按住，圈住一个词或者一句话' },
  { id: 'a1', role: 'ai', text: '明白了。现在的实现是左键选区加弹出百科，改成右键拖选以后要处理 contextmenu 被宿主吞掉的问题，另外绿色高亮不能改宿主 DOM。' },
  { id: 'u2', role: 'you', text: '圈住的句子和词会变成绿色，然后 AI 根据上下文解释它在这一整个对话里是什么意思' },
  { id: 'a2', role: 'ai', text: '那解释要按语境来写：先说它在这段对话里指什么，再给依据（引用原文），最后才是通用含义。' },
  { id: 'u3', role: 'you', text: '把流程图和气泡也修改一下，前端设计太烂了' },
  { id: 'a3', role: 'ai', text: '流程图改成会话竖轴加节点，气泡按语境释义优先重排，亮暗两套各配一套图案与动效。' },
  { id: 'a4', role: 'ai', text: '已经跑通的路由、缓存、闸门都留着，只重做你看得见的那一半。' },
];

const nodes = [
  { id: 'n1', phrase: '推倒重来', messageIndex: 0, count: 2, explained: true },
  { id: 'n2', phrase: '圈住', messageIndex: 0, count: 3, explained: true },
  { id: 'n3', phrase: '绿色', messageIndex: 2, count: 1, explained: true },
  { id: 'n4', phrase: '流程图', messageIndex: 3, count: 4, explained: true },
  { id: 'n5', phrase: '气泡', messageIndex: 3, count: 2, explained: false },
  { id: 'n6', phrase: '闸门', messageIndex: 6, count: 1, explained: false },
];

const layout = layoutMap({ messages, nodes });

const ICONS = {
  copy: '<rect x="5.6" y="5.6" width="8" height="8.4"/><path d="M10.4 3.4H3.2v9"/>',
  query: '<circle cx="7" cy="7" r="3.4"/><circle cx="7" cy="7" r="0.9" fill="currentColor" stroke="none"/><path d="M10.3 10.3 13.6 13.6"/>',
  rephrase: '<path d="M2.8 6.2a5.2 5.2 0 0 1 8.9-1.9"/><path d="M13.2 9.8a5.2 5.2 0 0 1-8.9 1.9"/><path d="M11.7 1.9v2.6H9.1"/><path d="M4.3 14.1v-2.6h2.6"/>',
  save: '<path d="M4.4 2.4h7.2v11.2L8 11.1l-3.6 2.5z"/>',
  'copy-explain': '<rect x="3.4" y="2.4" width="9.2" height="11.2"/><path d="M5.6 5.6h4.8M5.6 8h4.8M5.6 10.4h3.2"/>',
  example: '<path d="M8 2.2v2.2M8 11.6v2.2M2.2 8h2.2M11.6 8h2.2"/><circle cx="8" cy="8" r="2.4"/>',
  translate: '<circle cx="8" cy="8" r="5.6"/><path d="M2.6 8h10.8"/><path d="M8 2.4c3 3.2 3 8 0 11.2-3-3.2-3-8 0-11.2z"/>',
  speak: '<path d="M3.2 6.2h2.2l3-2.6v8.8l-3-2.6H3.2z"/><path d="M10.8 6a2.8 2.8 0 0 1 0 4M12.4 4.2a5.2 5.2 0 0 1 0 7.6"/>',
  'copy-quote': '<path d="M4.2 4.2h2.6v3.4c0 1.6-1 2.6-2.6 2.8"/><path d="M9.2 4.2h2.6v3.4c0 1.6-1 2.6-2.6 2.8"/>',
  locate: '<circle cx="8" cy="8" r="3"/><path d="M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2"/>',
  back: '<path d="M9.4 3.6 5 8l4.4 4.4"/>',
  more: '<path d="M6.6 3.6 11 8l-4.4 4.4"/>',
};

const icon = (name) => `<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ''}</svg>`;

/** 窗口按钮图标（与 window.js 同形）。 */
const chrome = (name) => {
  const body = name === 'min'
    ? '<line x1="2" y1="9" x2="10" y2="9"/>'
    : (name === 'max'
      ? '<rect x="2.4" y="2.4" width="7.2" height="7.2"/>'
      : '<line x1="2.6" y1="2.6" x2="9.4" y2="9.4"/><line x1="9.4" y1="2.6" x2="2.6" y2="9.4"/>');
  return `<svg viewBox="0 0 12 12" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="square" aria-hidden="true">${body}</svg>`;
};
const MENU_ITEMS = [
  { action: 'copy-explain', label: '复制释义', hint: '', disabled: false },
  { action: 'example', label: '举个例子', hint: '', disabled: false },
  { action: 'translate', label: '翻译', hint: '', disabled: false },
  { action: 'speak', label: '朗读', hint: '', disabled: false },
  { action: 'copy-quote', label: '复制引用块', hint: '', disabled: false },
  { action: 'locate', label: '定位出处', hint: '', disabled: false },
];

function mapHtml() {
  const lines = [
    `<line data-kind="spine" x1="22" y1="0" x2="22" y2="${layout.height}" />`,
    ...layout.ticks.map((tick) => `<line data-kind="tick-${tick.role}" x1="16" y1="${tick.center}" x2="22" y2="${tick.center}" />`),
    ...layout.stems.map((stem) => `<line data-kind="stem" x1="${stem.x1}" y1="${stem.y1}" x2="${stem.x2}" y2="${stem.y2}" />`),
    ...layout.branches.map((branch) => `<line data-kind="branch" x1="${branch.x1}" y1="${branch.y1}" x2="${branch.x2}" y2="${branch.y2}" />`),
    ...layout.edges.map((edge) => `<line data-kind="${edge.kind}" x1="${edge.x1}" y1="${edge.y1}" x2="${edge.x2}" y2="${edge.y2}" />`),
  ].join('');
  const points = layout.points.map((point) => `
    <button class="knest-point" style="left:${point.x}px;top:${point.y}px"
      data-explained="${point.explained}" data-active="${point.id === 'n1'}" data-pending="false">
      <span class="knest-ring-dot"></span>
      <span class="knest-label">${point.phrase}</span>
      ${point.count > 1 ? `<span class="knest-times">${point.count} 次</span>` : ''}
    </button>`).join('');
  const roles = layout.ticks
    .filter((tick) => layout.points.some((point) => point.messageIndex === tick.index))
    .map((tick) => `<span class="knest-role-mark" data-role="${tick.role}" style="top:${tick.center}px">${tick.role === 'you' ? '你' : '答'}</span>`)
    .join('');
  return `<div class="knest-map" style="height:${layout.height}px">
      ${roles}
      <svg class="knest-svg" width="100%" height="${layout.height}">${lines}</svg>
      ${points}
    </div>`;
}

/** 正文（与 renderCardBody 同结构）。 */
function bodyHtml(full) {
  const evidence = `
      <div class="knest-hr"></div>
      <section>
        <h4 class="knest-h">依据</h4>
        <ul class="knest-list">
          <li><span class="knest-quote">把流程图和气泡也修改一下，前端设计太烂了</span><span class="knest-why">跟着「推倒重来」一起说，说明是整体重做而不是局部修补</span></li>
          <li><span class="knest-quote">用户可以鼠标右键按住，圈住一个词或者一句话</span><span class="knest-why">连交互方式都要换，属于方案级改动</span></li>
        </ul>
      </section>`;
  const rest = `
      <div class="knest-hr"></div>
      <section>
        <h4 class="knest-h">也可以读成</h4>
        <ul class="knest-list">
          <li><span class="knest-alt">整体重构</span><span class="knest-alt-note"> —— 保留行为，重写内部结构</span></li>
          <li><span class="knest-alt">从零重写</span><span class="knest-alt-note"> —— 连底层一起丢掉，语气更强</span></li>
        </ul>
      </section>
      <div class="knest-hr"></div>
      <section>
        <h4 class="knest-h">往下再一层</h4>
        <ul class="knest-list knest-tree">
          <li>
            <span class="knest-node">重构 —— 不改变外部行为的前提下调整内部结构</span>
            <ul class="knest-kids">
              <li>重写 —— 丢弃原有实现重新编写</li>
              <li>重新设计 —— 连交互与信息结构一起换</li>
            </ul>
          </li>
        </ul>
      </section>`;
  return `<div class="knest-body">
      <p class="knest-here">指把现有实现整体推翻、重新设计，而不是在旧皮肤上打补丁；这句话把交互、流程图、气泡和视觉一起划进了重做范围。</p>
      ${full ? evidence + rest : evidence}
      <footer class="knest-foot">
        <span class="knest-conf" data-tone="high"><i data-on="true"></i><i data-on="true"></i><i data-on="true"></i></span>
        <span class="knest-gap"></span>
        <span>全对话 2 次</span>
        <span>deepseek-flash</span>
        <span>836 token</span>
        <span>2.2s</span>
      </footer>
    </div>`;
}

function menuHtml() {
  /* 画「更多」这一页：六个次级动作 + 顶部返回，正好把子菜单说清楚 */
  const moreItems = MENU_ITEMS.filter((item) => item.action !== undefined);
  const rows = moreItems.map((item) => `<button class="knest-mi" type="button" data-action="${item.action}"${item.disabled ? ' disabled' : ''}>
      ${icon(item.action)}<span class="knest-mi-label">${item.label}</span><span class="knest-mi-hint">${item.hint}</span>
    </button>`).join('');
  return `<div class="knest-menu" data-page="more" style="left:392px;top:52px">
    <button class="knest-mi knest-mi-lead" type="button" data-nav="back">${icon('back')}<span class="knest-mi-label">返回</span></button>
    <div class="knest-mdiv"></div>
    ${rows}
  </div>`;
}

/** 圈词本小节。 */
function notesHtml() {
  const notes = [
    ['推倒重来', '把现有实现整体推翻、重新设计，而不是在旧皮肤上打补丁。'],
    ['闸门', '同时最多三个请求在飞，超过就排队；同一个词只发一次。'],
  ];
  const rows = notes.map(([phrase, lead]) => `<li>
      <button class="knest-note-open" type="button">
        <span class="knest-note-phrase">${phrase}</span>
        <span class="knest-note-lead">${lead}</span>
      </button>
      <button class="knest-note-del" type="button" title="删掉这条">×</button>
    </li>`).join('');
  return `<section class="knest-notes">
    <div class="knest-notes-head">
      <h3>圈词本</h3><span class="knest-fig">${notes.length} 条</span><span style="flex:1"></span>
      <button class="knest-key" type="button">导出 Markdown</button>
      <button class="knest-key" type="button">清空</button>
    </div>
    <ul class="knest-note-list">${rows}</ul>
  </section>`;
}

function switchHtml(on) {
  return `<div id="knest-switch" data-on="${on ? 'true' : 'false'}">
    <button class="knest-switch-btn" type="button" role="switch" aria-checked="${on ? 'true' : 'false'}">
      <span class="knest-switch-text">启用圈词</span>
      <span class="knest-switch-dot"></span>
    </button>
  </div>`;
}

function chatHtml() {
  const bubble = (role, html) => `<div class="chat-msg ${role}"><span class="chat-role">${role === 'me' ? '你' : '回答'}</span><p>${html}</p></div>`;
  return `
  <div class="fake-chat">
    ${bubble('me', '我想把这个项目<mark class="knest-mark">推倒重来</mark>，用户可以鼠标右键按住，圈住一个词或者一句话')}
    ${bubble('ai', '明白了。现在的实现是左键选区加弹出百科，改成右键拖选以后要处理 contextmenu 被宿主吞掉的问题。')}
    ${bubble('me', '圈住的句子和词会变成绿色，然后 AI 根据上下文解释它在这一整个对话里是什么意思')}
    ${bubble('ai', '那解释要按语境来写：先说它在这段对话里指什么，再给依据，最后才是通用含义。')}
  </div>`;
}

function page(theme, mode) {
  const on = mode !== 'menu';
  return `<!doctype html>
<html lang="zh-CN" data-knest-theme="${theme}">
<head>
<meta charset="utf-8">
<title>knowledge-nest · ${theme} · ${mode}</title>
<style>${KNEST_CSS}</style>
<style>
  html,body{margin:0;height:100%;background:var(--kn-bg);color:var(--kn-ink);
    font:14px/1.7 "Segoe UI","PingFang SC","Microsoft YaHei",system-ui,sans-serif}
  .wrap{display:grid;grid-template-columns:minmax(360px,520px) 1fr;gap:0;height:100vh;overflow:hidden}
  .fake-chat{padding:28px 26px;overflow:hidden;border-right:1px solid var(--kn-rule)}
  .chat-msg{margin-bottom:18px}
  .chat-role{font-size:11px;color:var(--kn-mute)}
  .chat-msg p{margin:2px 0 0;font-size:13.5px;line-height:1.85;color:var(--kn-ink)}
  .chat-msg.ai p{opacity:.86}
  .knest-mark{font-weight:600}
</style>
</head>
<body>
<div class="wrap">
  ${chatHtml()}
  <div class="knest-stage" data-knest-theme="${theme}">
    <div class="knest-rail">
      <h2>圈词</h2>
      <span class="knest-fig">${messages.length} 条消息</span>
      <span class="knest-fig">${nodes.length} 个词</span>
      <span style="flex:1"></span>
      <span class="knest-fig">${on ? '' : '已关闭'}</span>
      <button class="knest-key" type="button">清空这张图</button>
    </div>
    <p class="knest-lead-in">${on
      ? '按住鼠标右键拖过聊天里的一个词或一句话，松手它就变绿，意思钉在这条轴上。'
      : '圈词已关闭：右键拖过仍会选中，松手在选区右上角给出菜单。'}</p>
    ${mapHtml()}
    ${notesHtml()}
  </div>
</div>
<div id="knest-echo-layer">
  
  
  <div id="knest-dock">
    <button class="knest-dock-item" type="button"><span class="knest-dock-dot"></span><span class="knest-dock-text">气泡</span></button>
  </div>
</div>
<div id="knest-menu-layer">${mode === 'menu' ? menuHtml() : ''}</div>
${switchHtml(on)}
</body>
</html>`;
}

mkdirSync(OUT, { recursive: true });
for (const [name, theme, mode] of [['menu-dark', 'dark', 'menu']]) {
  writeFileSync(join(OUT, `${name}.html`), page(theme, mode), 'utf8');
  console.log(`preview/${name}.html written`);
}
