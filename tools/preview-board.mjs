/**
 * 知识树画布的静态预览：用**真的连线函数**算路径，肉眼看节点位置与曲线走向。
 *
 * 用法：node tools/preview-board.mjs → preview/board-dark.html、preview/board-light.html
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { KNEST_CSS } from '../client/styles.js';
import { edgeFor, pathFor } from '../client/tree-board.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'preview');

/** 节点：位置 + 尺寸 + 文案（尺寸按渲染后的实际高度估）。 */
const NODES = [
  { id: 'a', x: 0, y: 0, w: 300, h: 206, depth: 0, title: '推倒重来', kind: '动作', domain: '工程', mark: true,
    lead: '指把现有实现整体推翻、重新设计，而不是在旧皮肤上打补丁；这句话把交互、流程图、气泡和视觉一起划进了重做范围。',
    quote: '把流程图和气泡也修改一下，前端设计太烂了',
    chips: ['重构', '交互改版'], foot: '2 次 · deepseek-flash · 836 token' },
  { id: 'b', x: -178, y: 302, w: 300, h: 168, depth: 1, parentId: 'a', title: '流程图', kind: '术语', domain: '工程', mark: true,
    lead: '会话竖轴加节点：圈过的词挂在它第一次出现的那条消息旁边，同一行的词竖着错开。',
    quote: '流程图改成会话竖轴加节点',
    chips: ['会话竖轴', '节点'], foot: '4 次 · deepseek-flash · 612 token' },
  { id: 'c', x: 178, y: 302, w: 300, h: 156, depth: 1, parentId: 'a', title: '气泡', kind: '术语', domain: '设计',
    lead: '解释卡：语境释义优先，依据其次，通用含义放最后。',
    quote: '气泡按语境释义优先重排',
    chips: [], foot: '2 次 · deepseek-flash · 590 token' },
  { id: 'd', x: -178, y: 566, w: 300, h: 140, depth: 2, parentId: 'b', title: '会话竖轴', kind: '术语', domain: '工程', mark: true,
    lead: '一条按消息顺序生长的竖线，所有节点都挂在它上面。',
    quote: '会话竖轴加节点', chips: [], foot: '1 次 · 480 token' },
];

/** 节点 body（与 tree-board.js 的 renderBody 同结构）。 */
function nodeHtml(node) {
  const chips = node.chips.length === 0
    ? ''
    : `<div class="knest-tnode-links">${node.chips
      .map((chip) => `<button class="knest-chip" type="button"${node.depth >= 2 ? ' disabled' : ''}>${chip}</button>`)
      .join('')}</div>`;
  return `<section class="knest-tnode" data-id="${node.id}" data-depth="${node.depth}" data-collapsed="false"
      data-domain="${node.domain ?? ''}" data-mark="${node.mark ? 'true' : 'false'}"
      style="left:${node.x}px;top:${node.y}px">
    <header class="knest-tnode-bar">
      <span class="knest-tnode-title">${node.title}</span>
      <span class="knest-tnode-kind">${node.kind}</span>
      <button class="knest-tnode-btn" type="button" data-act="min" title="最小化">—</button>
      <button class="knest-tnode-btn" type="button" data-act="close" title="关闭">×</button>
    </header>
    <div class="knest-tnode-body">
      <p class="knest-tnode-lead">${node.lead}</p>
      <ul class="knest-tnode-evidence"><li><span class="knest-quote">${node.quote}</span></li></ul>
      ${chips}
      <div class="knest-tnode-foot">${node.foot}</div>
    </div>
  </section>`;
}

/** 所有连线（用真函数算）。 */
function edgesHtml() {
  return NODES.filter((node) => node.parentId !== undefined).map((node) => {
    const parent = NODES.find((item) => item.id === node.parentId);
    const edge = edgeFor(parent, node, { w: parent.w, h: parent.h }, { w: node.w, h: node.h });
    return `<path class="knest-edge" data-from="${parent.id}" data-to="${node.id}" data-orientation="${edge.orientation}" d="${pathFor(edge)}" />`;
  }).join('\n      ');
}

function page(theme) {
  return `<!doctype html>
<html lang="zh-CN" data-knest-theme="${theme}">
<head><meta charset="utf-8"><title>board · ${theme}</title>
<style>${KNEST_CSS}</style>
<style>
  html,body{margin:0;height:100%;background:var(--kn-bg);color:var(--kn-ink);
    font:14px/1.7 "Segoe UI","PingFang SC","Microsoft YaHei",system-ui,sans-serif}
  .behind{padding:22px 26px;max-width:760px}
  .behind h2{margin:0 0 14px;font-size:12px;color:var(--kn-mute);font-weight:400}
  .msg{margin:0 0 14px;padding:10px 13px;border-radius:8px;font-size:13.5px;line-height:1.8;max-width:64ch}
  .msg.user{background:color-mix(in srgb,var(--kn-echo) 10%,transparent);border:1px solid color-mix(in srgb,var(--kn-echo) 22%,transparent)}
  .msg.ai{background:color-mix(in srgb,var(--kn-panel) 70%,transparent);border:1px solid var(--kn-rule)}
</style></head>
<body>
<div class="behind">
  <h2>对话</h2>
  <div class="msg user">把流程图和气泡也修改一下，前端设计太烂了，我想把这个项目推倒重来。</div>
  <div class="msg ai">好，我按「推倒重来」来处理：交互、流程图、气泡和视觉一起重做，不在旧皮肤上打补丁。</div>
  <div class="msg user">流程图改成会话竖轴加节点，气泡按语境释义优先重排。</div>
  <div class="msg ai">明白。会话竖轴按消息顺序生长，圈过的词挂在它第一次出现的那条消息旁边。</div>
</div>
<div id="knest-board" data-open="true" data-split="false">
    <div class="knest-board-main">
    <div class="knest-board-world" style="transform:translate(760px, 90px) scale(1)">
      <svg class="knest-board-edges" width="1" height="1" overflow="visible">
        ${edgesHtml()}
      </svg>
      <div class="knest-board-nodes">
        ${NODES.map(nodeHtml).join('\n      ')}
      </div>
    </div>
    <div class="knest-board-hud">
      <button class="knest-hud-btn" type="button" title="回到根节点">⟲</button>
      <button class="knest-hud-btn" type="button" title="全部关闭（Esc）">✕</button>
  </div>
</div>
</body></html>`;
}

mkdirSync(OUT, { recursive: true });
for (const theme of ['dark', 'light']) {
  writeFileSync(join(OUT, `board-${theme}.html`), page(theme), 'utf8');
  console.log(`preview/board-${theme}.html written`);
}
