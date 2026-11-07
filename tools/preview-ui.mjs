/**
 * 界面实景图：用插件**真实的 CSS 与真实卡片结构**，套一层仿 DSH 的外框渲染。
 * 输出 docs/assets/ui-*.html，再截图成 PNG。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { KNEST_CSS } from '../client/styles.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs', 'assets');

const CHROME = `
<style>
  html,body{margin:0;width:1280px;height:780px;overflow:hidden;background:#070d16;color:#E6EEF8;
    font:13.5px/1.7 "PingFang SC","Microsoft YaHei",system-ui,sans-serif}
  .app{display:flex;height:100%}
  .side{width:240px;flex:0 0 auto;border-right:1px solid #141f2c;padding:14px 12px;box-sizing:border-box;background:#080e17}
  .brand{display:flex;align-items:center;gap:8px;font-size:15px;font-weight:600;letter-spacing:.02em}
  .brand i{width:16px;height:16px;border-radius:50%;background:linear-gradient(135deg,#4d7cff,#8ad0ff);display:inline-block}
  .new{margin:14px 0;padding:7px 10px;border:1px solid #1b2836;border-radius:8px;color:#9fb3c8;font-size:12.5px}
  .side h4{margin:16px 0 6px;font-size:11px;letter-spacing:.16em;color:#5f7288;font-weight:400}
  .sess{padding:5px 8px;border-radius:6px;font-size:12.5px;color:#a9bbd0;display:flex;justify-content:space-between;gap:8px}
  .sess[data-on="true"]{background:#111c2a;color:#E6EEF8}
  .sess span{color:#5f7288;font-size:11px}
  .main{flex:1;min-width:0;display:flex;flex-direction:column}
  .top{display:flex;align-items:center;gap:18px;height:46px;padding:0 20px;border-bottom:1px solid #141f2c}
  .top b{font-size:14px;font-weight:600}
  .tabs{display:flex;gap:16px;font-size:12.5px;color:#7d90a6}
  .tabs u{text-decoration:none;padding-bottom:12px;border-bottom:2px solid transparent}
  .tabs u[data-on="true"]{color:#E6EEF8;border-bottom-color:#4d7cff}
  .chat{flex:1;overflow:hidden;padding:18px 26px 0;position:relative}
  .msg{max-width:62ch;margin:0 0 14px;font-size:13.5px;line-height:1.85}
  .msg[data-role="you"]{background:rgba(77,124,255,.10);border:1px solid rgba(77,124,255,.22);border-radius:10px;padding:9px 13px}
  .composer{margin:0 26px 16px;border:1px solid #1b2836;border-radius:12px;padding:12px 14px;color:#5f7288;font-size:12.5px;background:#0a1220}
  .stage{position:absolute;inset:46px 0 0 0;pointer-events:none}
</style>`;

const page = (title, body) => `<!doctype html>
<html lang="zh-CN" data-knest-theme="dark">
<head><meta charset="utf-8"><title>${title}</title><style>${KNEST_CSS}</style>${CHROME}</head>
<body>${body}</body></html>`;

const SIDE = `<aside class="side">
  <div class="brand"><i></i>deepseek <span style="font-size:10px;border:1px solid #24323f;border-radius:4px;padding:0 4px;color:#7d90a6">HARNESS</span></div>
  <div class="new">新会话</div>
  <h4>工作区</h4>
  <div class="sess" data-on="true">插件重构与前端设计升级<span>1 分钟</span></div>
  <div class="sess">材质加工冶金传输原理速成<span>20 小时</span></div>
  <div class="sess">我的世界通关方法<span>21 小时</span></div>
  <div class="sess">杀戮尖塔 2 插件功能扩展<span>22 小时</span></div>
</aside>`;

const TOP = (tab) => `<header class="top">
  <b>插件重构与前端设计升级</b>
  <nav class="tabs"><u data-on="${tab === 'chat'}">对话</u><u data-on="${tab === 'lib'}">知识库</u><u>dsh-purge</u></nav>
</header>`;

const CHAT = `<div class="chat">
  <div class="msg" data-role="you">把流程图和气泡也修改一下，前端设计太烂了，我想把这个项目推倒重来。</div>
  <div class="msg">好，我按「推倒重来」来处理：交互、流程图、气泡和视觉一起重做，不在旧皮肤上打补丁。</div>
  <div class="msg" data-role="you">流程图改成会话竖轴加节点，气泡按语境释义优先重排。</div>
  <div class="composer">发消息或创建任务，/ 调用指令，@ 文件或对话</div>
</div>`;

const CARD = (opts) => `<section class="knest-tnode" data-depth="${opts.depth}" data-collapsed="false"
  style="position:absolute;left:${opts.x}px;top:${opts.y}px;width:300px">
  <header class="knest-tnode-bar">
    ${opts.depth === 0 ? '' : '<button class="knest-tnode-btn" type="button">↑</button>'}
    <span class="knest-tnode-title">${opts.title}</span>
    <span class="knest-tnode-kind">${opts.kind}</span>
    <button class="knest-tnode-btn" type="button">—</button><button class="knest-tnode-btn" type="button">×</button>
  </header>
  <div class="knest-tnode-body">
    <p class="knest-tnode-lead">${opts.lead}</p>
    ${opts.chips ? `<div class="knest-tnode-links">${opts.chips.map((c) => `<button class="knest-chip" type="button">${c}</button>`).join('')}</div>` : ''}
    <div class="knest-tnode-foot">${opts.foot}</div>
  </div>
</section>`;

/* ① 画布实景 */
const board = page('画布实景', `<div class="app">${SIDE}<div class="main">${TOP('chat')}${CHAT}</div></div>
<div id="knest-board" data-open="true" style="position:absolute;inset:0;pointer-events:none">
  <div style="position:absolute;left:0;top:0;transform:translate(268px,150px)">
    <svg width="1" height="1" overflow="visible" style="position:absolute;left:0;top:0;overflow:visible">
      <path d="M 150 168 C 150 214 350 226 570 226" fill="none" stroke="#4a6a94" stroke-width="1.6"/>
      <path d="M 150 168 C 210 250 600 226 826 226" fill="none" stroke="#4a6a94" stroke-width="1.6"/>
      <path d="M 570 396 L 570 470" fill="none" stroke="#4a6a94" stroke-width="1.6"/>
    </svg>
    ${CARD({ depth: 0, x: 0, y: 0, title: '推倒重来', kind: '动作', lead: '指把现有实现整体推翻、重新设计，而不是在旧皮肤上打补丁；这句话把交互、流程图、气泡和视觉一起划进了重做范围。', chips: ['重构', '交互改版'], foot: '2 次 · deepseek-flash · 836 token' })}
    ${CARD({ depth: 1, x: 420, y: 226, title: '流程图', kind: '术语', lead: '会话竖轴加节点：圈过的词挂在它第一次出现的那条消息旁边，同一行的词竖着错开。', chips: ['会话竖轴', '节点'], foot: '4 次 · 612 token' })}
    ${CARD({ depth: 1, x: 676, y: 226, title: '气泡', kind: '术语', lead: '解释卡：语境释义优先，依据其次，通用含义放最后。', foot: '2 次 · 590 token' })}
    ${CARD({ depth: 2, x: 420, y: 470, title: '会话竖轴', kind: '术语', lead: '一条按消息顺序生长的竖线，所有节点都挂在它上面。', foot: '1 次 · 480 token' })}
  </div>
  <div class="knest-board-hud" style="position:absolute;left:16px;bottom:16px">
    <button class="knest-hud-btn" type="button">⤓</button><button class="knest-hud-btn" type="button">⟲</button><button class="knest-hud-btn" type="button">✕</button>
  </div>
</div>`);

/* ② 批注实景 */
const annotate = page('批注实景', `<div class="app">${SIDE}<div class="main">${TOP('chat')}<div class="chat">
  <div class="msg" data-role="you">把流程图和气泡也修改一下，前端设计太烂了。</div>
  <div class="msg" style="max-width:60ch">好，我按 <span style="color:#e0564a;text-decoration:line-through;text-decoration-thickness:1.5px">把流程图和气泡也修改一下，前端设计太烂了</span> 来处理：交互、流程图、气泡和视觉一起重做。</div>
  <div class="msg" data-role="you">流程图改成会话竖轴加节点。</div>
  <div class="composer">发消息或创建任务，/ 调用指令，@ 文件或对话</div>
</div></div></div>
<div class="knest-notes-layer" style="position:absolute;inset:0">
  <div class="knest-note-bubble" data-kind="rewrite" data-collapsed="false" data-submitted="false"
       style="position:absolute;left:300px;top:150px">
    <div class="knest-note-head"><button class="knest-note-kind" type="button">改写</button><button class="knest-note-del" type="button">×</button></div>
    <textarea class="knest-note-input" rows="1" style="height:auto">改成：先说视觉要重做，别用评价性表述</textarea>
  </div>
</div>`);

/* ③ 知识库标签页实景 */
const library = page('知识库实景', `<div class="app">${SIDE}<div class="main">${TOP('lib')}
  <div style="padding:18px 26px">
    <h3 style="margin:0 0 10px;font-size:15px">知识库</h3>
    <input class="knest-search" placeholder="搜词 / 释义 / 领域…" value="重构" style="max-width:420px"/>
    <div style="margin-top:6px;font-size:11.5px;color:#6f8299">3 / 12 张卡片 · 领域：工程</div>
    <div style="margin-top:14px;display:flex;flex-direction:column;gap:6px;max-width:620px">
      <div class="knest-lib-row" data-active="true"><span class="knest-lib-phrase">推倒重来</span><span class="knest-lib-lead">指把现有实现整体推翻、重新设计</span><span class="knest-lib-tag">工程</span></div>
      <div class="knest-lib-row"><span class="knest-lib-phrase">重构</span><span class="knest-lib-lead">保留行为、重写结构</span><span class="knest-lib-tag">工程</span></div>
      <div class="knest-lib-row"><span class="knest-lib-phrase">流程图</span><span class="knest-lib-lead">会话竖轴加节点</span><span class="knest-lib-tag">设计</span></div>
    </div>
    <div style="margin-top:26px;padding:14px 16px;border:1px dashed #1b2836;border-radius:10px;max-width:620px;color:#6f8299;font-size:12px">
      输入即过滤：只保留命中的节点，会话竖轴上的图会跟着收缩。
    </div>
  </div>
</div></div>`);

mkdirSync(OUT, { recursive: true });
for (const [name, html] of [['ui-board', board], ['ui-annotate', annotate], ['ui-library', library]]) {
  writeFileSync(join(OUT, `${name}.html`), html, 'utf8');
  console.log(`docs/assets/${name}.html`);
}
