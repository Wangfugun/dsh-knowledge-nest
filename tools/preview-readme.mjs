/**
 * 生成 README 用的图解（HTML 渲染成 PNG，交给 Edge 截图）。
 *
 * 用法：node tools/preview-readme.mjs
 * 输出：docs/assets/*.html（截图由外部命令完成）
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { KNEST_CSS } from '../client/styles.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs', 'assets');

const base = (title, body, width = 1200, height = 620) => `<!doctype html>
<html lang="zh-CN" data-knest-theme="dark">
<head><meta charset="utf-8"><title>${title}</title>
<style>${KNEST_CSS}</style>
<style>
  html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden;
    background:radial-gradient(120% 140% at 20% 0%,#101a28 0%,#070d16 55%,#050a12 100%);
    color:#E6EEF8;font:14px/1.7 "PingFang SC","Microsoft YaHei",system-ui,sans-serif}
  .wrap{padding:44px 52px;height:100%;box-sizing:border-box;display:flex;flex-direction:column}
  .kicker{font-size:12px;letter-spacing:.28em;color:#6f8299;text-transform:uppercase}
  h1{margin:10px 0 6px;font-size:44px;line-height:1.2;font-weight:600;letter-spacing:.02em}
  h1 small{display:block;margin-top:8px;font-size:15px;font-weight:400;color:#8fa3ba;letter-spacing:.06em}
  .lead{margin:10px 0 0;color:#A9BBD0;font-size:15px;max-width:52ch}
  .row{display:flex;gap:18px;margin-top:auto}
  .cell{flex:1;border:1px solid #1b2836;border-radius:12px;padding:14px 16px;background:rgba(11,22,36,.72)}
  .cell b{display:block;font-size:13px;color:#E6EEF8;margin-bottom:6px}
  .cell span{font-size:12.5px;color:#8fa3ba;line-height:1.65}
  .num{display:inline-flex;width:20px;height:20px;border-radius:50%;border:1px solid #2b6cf6;color:#7aa2ff;
    align-items:center;justify-content:center;font-size:11px;margin-right:7px}
  .mono{font-family:ui-monospace,Consolas,monospace;font-size:12px;color:#9fb3c8}
</style></head>
<body><div class="wrap">${body}</div></body></html>`;

/* ---------------------------------------------------------------- 1. 头图 */
const hero = base('词林', `
  <div class="kicker">DeepSeek Harness 插件</div>
  <h1>词林<small>把对话里的词，种成一棵树</small></h1>
  <p class="lead">按住右键拖过一个词，它变绿，一张卡片落在画布上，说清它在这一整段对话里的意思；卡片里的词还能继续点开，一层层长出枝干。</p>
  <div style="margin-top:22px;position:relative;height:400px">
    <section class="knest-tnode" data-depth="0" style="position:absolute;left:0;top:0;width:320px">
      <header class="knest-tnode-bar"><span class="knest-tnode-title">推倒重来</span><span class="knest-tnode-kind">动作</span></header>
      <div class="knest-tnode-body"><p class="knest-tnode-lead">指把现有实现整体推翻、重新设计，而不是在旧皮肤上打补丁。</p>
        <div class="knest-tnode-links"><button class="knest-chip" type="button">重构</button><button class="knest-chip" type="button">交互改版</button></div>
        <div class="knest-tnode-foot">2 次 · 836 token</div></div>
    </section>
    <section class="knest-tnode" data-depth="1" style="position:absolute;left:392px;top:214px;width:300px">
      <header class="knest-tnode-bar"><span class="knest-tnode-title">流程图</span><span class="knest-tnode-kind">术语</span></header>
      <div class="knest-tnode-body"><p class="knest-tnode-lead">会话竖轴加节点：圈过的词挂在它第一次出现的那条消息旁边。</p>
        <div class="knest-tnode-foot">4 次 · 612 token</div></div>
    </section>
    <section class="knest-tnode" data-depth="1" style="position:absolute;left:740px;top:214px;width:300px">
      <header class="knest-tnode-bar"><span class="knest-tnode-title">气泡</span><span class="knest-tnode-kind">术语</span></header>
      <div class="knest-tnode-body"><p class="knest-tnode-lead">解释卡：语境释义优先，依据其次，通用含义放最后。</p>
        <div class="knest-tnode-foot">2 次 · 590 token</div></div>
    </section>
    <svg style="position:absolute;left:0;top:0;width:1100px;height:320px;overflow:visible;pointer-events:none">
      <path d="M 160 172 C 160 200 300 214 542 214" fill="none" stroke="#4a6a94" stroke-width="1.6"/>
      <path d="M 160 172 C 200 240 620 214 890 214" fill="none" stroke="#4a6a94" stroke-width="1.6"/>
    </svg>
  </div>`);

/* ------------------------------------------------------------ 2. 怎么用 */
const flow = base('怎么用', `
  <div class="kicker">四步</div>
  <h1 style="font-size:32px">从一次右键，到一张卡片<small style="margin-top:6px">不需要记快捷键，也不需要打开别的窗口</small></h1>
  <div class="row" style="margin-top:34px">
    <div class="cell"><b><span class="num">1</span>右键拖过一段字</b><span>按住鼠标右键划过要问的词或句子，松手。只是点一下不拖，就取指针所在那一整句。</span></div>
    <div class="cell"><b><span class="num">2</span>松手出菜单</b><span>菜单里挑动作：解释这段文本、解释这段代码、换个说法、举例、翻译、标出同领域、批注这段。</span></div>
    <div class="cell"><b><span class="num">3</span>卡片落在画布</b><span>卡片告诉你它在这段对话里指什么，并给出逐字引用作依据。卡片里的词可以继续点开。</span></div>
    <div class="cell"><b><span class="num">4</span>回头找得到</b><span>「知识库」标签页顶部有搜索框，按词、按释义、按领域都能筛。卡片存在磁盘上，关掉还在。</span></div>
  </div>
  <div class="row" style="margin-top:18px">
    <div class="cell" style="flex:1"><b>画布上还能做</b><span>拖动卡片、按住 Alt 拖平移、按住 Ctrl 滚轮缩放、Shift 多选整组移动、Delete 删除、Esc 收起。</span></div>
  </div>`);

/* -------------------------------------------------------- 3. 后台在干什么 */
const pipeline = base('后台在干什么', `
  <div class="kicker">一次圈词的完整链路</div>
  <h1 style="font-size:30px">你拖了一下鼠标，它做了七件事</h1>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:24px">
    <div class="cell"><b><span class="num">1</span>算清你要问什么</b><span>按下的起点和松手的终点换成真实文本范围；没拖动就取整句；超过 120 字不再外扩。</span></div>
    <div class="cell"><b><span class="num">2</span>组织上下文</b><span>找这个词第一次出现的位置，取前后几条消息拼成纯文本，并算一个内容指纹。</span></div>
    <div class="cell"><b><span class="num">3</span>先看缓存</b><span>内存一层、磁盘一层，按词加指纹加模式做键，存 30 天，只存成功的。</span></div>
    <div class="cell"><b><span class="num">4</span>排队</b><span>同时最多三个请求在飞，同词单飞，相邻请求间隔 250 毫秒，不把自己的账号打到限流。</span></div>
    <div class="cell"><b><span class="num">5</span>发请求</b><span>走插件自己注册的宿主路由，浏览器端从不直连模型；钥匙按配置、环境变量、凭据文件顺序找。</span></div>
    <div class="cell"><b><span class="num">6</span>收敛</b><span>模型只吐 JSON，回来逐字段检查，太长截断、枚举兜底、坏条目丢掉。</span></div>
    <div class="cell" style="grid-column:1 / -1"><b><span class="num">7</span>落盘并上色</b><span>卡片写进磁盘仓库；文字变绿用的是浏览器自带的文字高亮接口，页面本身一个节点都没动。</span></div>
  </div>`);

/* ---------------------------------------------------------- 4. 批注模式 */
const annotate = base('批注模式', `
  <div class="kicker">改别人的稿子</div>
  <h1 style="font-size:30px">标红划掉，写上你要的版本</h1>
  <p class="lead">右键菜单选「批注这段」，那句话被标红划掉，上方浮出气泡写改为。你写的内容会连同原句一起留给模型，下一轮它就知道你想怎么改。</p>
  <div style="margin-top:34px;position:relative;height:250px">
    <div style="font-size:16px;line-height:2.1;color:#cfdbe8;max-width:760px">
      好，我按 <span style="color:#e0564a;text-decoration:line-through;text-decoration-thickness:1.5px">把流程图和气泡也修改一下，前端设计太烂了</span> 来处理：交互、流程图和视觉一起重做。
    </div>
    <div class="knest-note-bubble" data-kind="rewrite" data-collapsed="false" data-submitted="false"
         style="position:absolute;left:0;top:-6px">
      <div class="knest-note-head"><button class="knest-note-kind" type="button">改写</button><button class="knest-note-del" type="button">×</button></div>
      <textarea class="knest-note-input" rows="1" style="height:auto">改成：先强调视觉要重做，不要评价性表述</textarea>
    </div>
  </div>
  <div class="row" style="margin-top:auto">
    <div class="cell"><b>改写</b><span>写清替换成什么，气泡里就是新的说法。</span></div>
    <div class="cell"><b>划掉</b><span>不写替代，只表示这句删掉。</span></div>
    <div class="cell"><b>提交</b><span>你发下一条消息后，批注自动淡出，但内容已经写进 AGENTS.local.md 供模型读取。</span></div>
  </div>`);

/* ------------------------------------------------------------ 5. 放哪了 */
const storage = base('东西都放在哪', `
  <div class="kicker">纯文本，能背走</div>
  <h1 style="font-size:30px">三处落点，全部是普通文件</h1>
  <p class="lead">卡片不放浏览器里。浏览器的存储只有几 MB，换台机器就没了；卡片是你攒下来的东西，必须存在能带走的地方。</p>
  <div class="row" style="margin-top:36px">
    <div class="cell"><b>卡片仓库</b><span class="mono">$DSH_HOME/knowledge-nest/cards.jsonl</span><span style="display:block;margin-top:8px">一行一张卡，坏一行不影响别的行。</span></div>
    <div class="cell"><b>解释缓存</b><span class="mono">$DSH_HOME/knowledge-nest/explain-cache.json</span><span style="display:block;margin-top:8px">按词加指纹做键，存 30 天，只存成功的。</span></div>
    <div class="cell"><b>批注摘要</b><span class="mono">工作区 / AGENTS.local.md</span><span style="display:block;margin-top:8px">只动注释标记之间的内容，写之前先备份。</span></div>
  </div>`);

mkdirSync(OUT, { recursive: true });
const pages = [
  ['hero', hero],
  ['flow', flow],
  ['pipeline', pipeline],
  ['annotate', annotate],
  ['storage', storage],
];
for (const [name, html] of pages) {
  writeFileSync(join(OUT, `${name}.html`), html, 'utf8');
  console.log(`docs/assets/${name}.html`);
}
