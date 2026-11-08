/**
 * 六种外观。
 *
 * 上一版的问题是「六套只换颜色」——形状、边框、字重、圆角全都一样，
 * 等于一套皮复制六遍，用户切过去除了颜色什么都感觉不到。
 *
 * 这一版每套在**结构**上就不一样：
 *   深灰   直角、无圆角、极细边、无阴影，靠留白撑
 *   彩虹   唯一一套带发光的。圆角最大，边缘一道渐变描边（不是糊一层光晕）
 *   青     切角（不是圆角），单色，靠线宽区分层级
 *   浅玉   浅底深字，大圆角，无边框只有投影
 *   纸白   纸色，几乎无阴影，缩进靠字距
 *   琥珀   等宽，方角，1px 实线，像老终端的琥珀屏（不是绿）
 *
 * 唯一允许张扬的是「彩虹」，其余五套都要安静——一套里只花一次力气。
 */

/** 皮肤样式版本。 */
export const KNEST_SKIN_REV = 's2';

export const KNEST_SKIN_CSS = [
  /* ── 深灰：直角、无阴影、靠留白 ──────────────────────────────── */
  `html[data-knest-skin="ink"]{
    --kn-bg:#0d0d0f; --kn-panel:#141416; --kn-rule:#2a2a2e;
    --kn-ink:#f0f0f2; --kn-mute:#82828a;
    --kn-signal:#e8e8ec; --kn-echo:#f0f0f2; --kn-echo-soft:rgba(240,240,242,.10);
    --kn-domain:#a0a0aa; --kn-domain-soft:rgba(160,160,170,.10);
    --kn-shadow:none;
    --kn-card-radius:0px; --kn-card-border:#2a2a2e;
    --kn-card-border-width:1px; --kn-card-pad:16px 18px;
  }
  html[data-knest-skin="ink"] .knest-tnode{box-shadow:none}
  html[data-knest-skin="ink"] .knest-tnode-title{font-weight:600;letter-spacing:.01em}`,

  /* ── 彩虹：唯一张扬的一套。大圆角 + 边缘渐变描边 ─────────────── */
  `html[data-knest-skin="nebula"]{
    --kn-bg:#08080e; --kn-panel:#101018; --kn-rule:#282840;
    --kn-ink:#f4f4ff; --kn-mute:#8a8ab0;
    --kn-signal:#c4b5fd; --kn-echo:#a5f3fc; --kn-echo-soft:rgba(165,243,252,.14);
    --kn-domain:#fbcfe8; --kn-domain-soft:rgba(251,207,232,.14);
    --kn-shadow:0 18px 46px rgba(0,0,0,.55);
    --kn-card-radius:20px; --kn-card-border:transparent;
    --kn-card-border-width:0px; --kn-card-pad:18px 20px;
  }
  /* 渐变边框：双背景 + background-clip，不用 mask（mask-composite 在 Edge 上会把整块裁掉） */
  html[data-knest-skin="nebula"] .knest-tnode{
    border:1.5px solid transparent;
    background-image:linear-gradient(var(--kn-panel,#101018),var(--kn-panel,#101018)),
                     conic-gradient(from 140deg,#fbcfe8,#c4b5fd,#a5f3fc,#fde68a,#fbcfe8);
    background-origin:border-box;
    background-clip:padding-box,border-box;
    overflow:hidden;
  }
  html[data-knest-skin="nebula"] .knest-tnode[data-depth="0"]{
    border-width:2px;
    filter:drop-shadow(0 0 18px rgba(196,181,253,.28));
  }
  html[data-knest-skin="nebula"] .knest-tnode[data-selected="true"]{
    filter:drop-shadow(0 0 26px rgba(196,181,253,.45));
  }`,

  /* ── 青：切角，单色，靠线宽分层次 ─────────────────────────────── */
  `html[data-knest-skin="neon"]{
    --kn-bg:#0a0c10; --kn-panel:#0e1218; --kn-rule:#1c2836;
    --kn-ink:#e8f4f8; --kn-mute:#7a94a4;
    --kn-signal:#22d3ee; --kn-echo:#22d3ee; --kn-echo-soft:rgba(34,211,238,.12);
    --kn-domain:#94a3b8; --kn-domain-soft:rgba(148,163,184,.12);
    --kn-shadow:0 14px 36px rgba(0,0,0,.48);
    --kn-card-radius:0px; --kn-card-border:rgba(34,211,238,.34);
    --kn-card-border-width:1px; --kn-card-pad:16px 18px;
  }
  /* 右上角切一刀：用 clip-path，不加发光 */
  html[data-knest-skin="neon"] .knest-tnode{
    clip-path:polygon(0 0,calc(100% - 14px) 0,100% 14px,100% 100%,0 100%);
    border-width:1px;
  }
  html[data-knest-skin="neon"] .knest-tnode[data-depth="0"]{border-width:2px}
  html[data-knest-skin="neon"] .knest-tnode-title{font-weight:700;letter-spacing:.02em}`,

  /* ── 浅玉：浅底深字，大圆角，只有投影没有边框 ────────────────── */
  `html[data-knest-skin="jade"]{
    --kn-bg:#eef3f0; --kn-panel:#f8fbf9; --kn-rule:#d3e0da;
    --kn-ink:#1b2b26; --kn-mute:#6b837b;
    --kn-signal:#3f7d68; --kn-echo:#2d6b56; --kn-echo-soft:rgba(45,107,86,.12);
    --kn-domain:#8a7a4e; --kn-domain-soft:rgba(138,122,78,.12);
    --kn-shadow:0 14px 34px rgba(27,43,38,.13),0 2px 6px rgba(27,43,38,.06);
    --kn-card-radius:26px; --kn-card-border:transparent;
    --kn-card-border-width:0px; --kn-card-pad:20px 22px;
  }
  html[data-knest-skin="jade"] .knest-tnode{border:0}
  html[data-knest-skin="jade"] .knest-tnode-title{font-weight:600}`,

  /* ── 纸白：纸色，几乎无阴影，靠字距和缩进 ───────────────────── */
  `html[data-knest-skin="paper"]{
    --kn-bg:#efeae0; --kn-panel:#f7f4ec; --kn-rule:#ddd6c8;
    --kn-ink:#2f2a22; --kn-mute:#84796a;
    --kn-signal:#5c5346; --kn-echo:#3f5c4a; --kn-echo-soft:rgba(63,92,74,.11);
    --kn-domain:#7a5c3f; --kn-domain-soft:rgba(122,92,63,.11);
    --kn-shadow:none;
    --kn-card-radius:3px; --kn-card-border:#ddd6c8;
    --kn-card-border-width:1px; --kn-card-pad:15px 17px;
  }
  html[data-knest-skin="paper"] .knest-tnode{box-shadow:inset 0 0 0 1px rgba(255,255,255,.6)}
  html[data-knest-skin="paper"] .knest-tnode-title{letter-spacing:.04em}
  html[data-knest-skin="paper"] .knest-tnode-lead{line-height:1.85}`,

  /* ── 琥珀：等宽方角实线，老终端那种琥珀屏，不是绿 ────────────── */
  `html[data-knest-skin="mono"]{
    --kn-bg:#0c0a06; --kn-panel:#12100a; --kn-rule:#2e2718;
    --kn-ink:#f5d9a0; --kn-mute:#a08655;
    --kn-signal:#ffb000; --kn-echo:#ffb000; --kn-echo-soft:rgba(255,176,0,.12);
    --kn-domain:#c89a4a; --kn-domain-soft:rgba(200,154,74,.12);
    --kn-shadow:none;
    --kn-card-radius:0px; --kn-card-border:#2e2718;
    --kn-card-border-width:1px; --kn-card-pad:14px 16px;
  }
  html[data-knest-skin="mono"] .knest-tnode{border-style:solid}
  html[data-knest-skin="mono"] .knest-tnode,
  html[data-knest-skin="mono"] .knest-tnode-title,
  html[data-knest-skin="mono"] .knest-tnode-lead,
  html[data-knest-skin="mono"] .knest-tnode-kind{
    font-family:"Cascadia Mono",Consolas,"SF Mono",monospace !important;
  }
  html[data-knest-skin="mono"] .knest-tnode-title{font-weight:400;letter-spacing:0}`,

  /* ── 把变量接到卡片上 ────────────────────────────────────────── */
  `html[data-knest-skin] .knest-tnode{
    border-radius:var(--kn-card-radius,14px);
    border:var(--kn-card-border-width,1px) solid var(--kn-card-border,rgba(255,255,255,.14));
    box-shadow:var(--kn-shadow,none);
  }
  html[data-knest-skin] .knest-tnode-body{padding:var(--kn-card-pad,10px 12px 11px)}`,

  /* ── 尺寸：跟着外观走，但只改度量不改结构 ─────────────────────── */
  `html[data-knest-size="sm"] .knest-tnode{width:280px}
   html[data-knest-size="sm"] .knest-tnode-title{font-size:13px}
   html[data-knest-size="sm"] .knest-tnode-lead{font-size:11.5px;line-height:1.62}`,

  `html[data-knest-size="md"] .knest-tnode{width:340px}
   html[data-knest-size="md"] .knest-tnode-title{font-size:15px}
   html[data-knest-size="md"] .knest-tnode-lead{font-size:12.5px;line-height:1.72}`,

  `html[data-knest-size="lg"] .knest-tnode{width:460px}
   html[data-knest-size="lg"] .knest-tnode-title{font-size:19px}
   html[data-knest-size="lg"] .knest-tnode-lead{font-size:14.5px;line-height:1.8}
   html[data-knest-size="lg"] .knest-tnode-bar{height:38px}`,

  /* ── 左下角的词林入口 ─────────────────────────────────────────── */
  `.knest-logo-btn{
    position:fixed; right:16px; bottom:16px; z-index:2147483000;
    display:flex; align-items:center; gap:8px; height:36px; padding:0 13px 0 9px;
    border-radius:10px; cursor:pointer; user-select:none;
    background:var(--kn-panel,#141416); color:var(--kn-ink,#f0f0f2);
    border:1px solid var(--kn-card-border,#2a2a2e);
    box-shadow:0 8px 24px rgba(0,0,0,.36);
    font:500 12.5px/1 "Microsoft YaHei",system-ui,sans-serif;
    transition:box-shadow .16s ease, border-color .16s ease;
  }
  .knest-logo-btn:hover{border-color:var(--kn-signal,#e8e8ec)}
  .knest-logo-btn .g{
    width:20px; height:20px; border-radius:5px; display:grid; place-items:center;
    background:var(--kn-signal,#e8e8ec); color:var(--kn-bg,#0d0d0f);
    font:700 12px/1 "Songti SC","Noto Serif SC",serif;
  }
  .knest-logo-btn[data-alert="1"]::after{
    content:""; position:absolute; left:-3px; top:-3px; width:8px; height:8px; border-radius:50%;
    background:#e5484d; box-shadow:0 0 0 2px var(--kn-panel,#141416);
  }`,

  /* ── 设置面板的滑块：要"活" ─────────────────────────────────── */
  `.knest-set-sliders{display:flex;flex-direction:column;gap:17px;margin:6px 0}
  .knest-slider{display:block}
  .knest-slider .top{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:9px}
  .knest-slider .nm{font-size:12.5px;color:var(--kn-ink,#f0f0f2);letter-spacing:.02em}
  .knest-slider .vl{
    font:600 12px/1 "Cascadia Mono",Consolas,monospace;color:var(--kn-echo,#f0f0f2);
    font-variant-numeric:tabular-nums;transition:transform .18s ease;
  }
  /* 松手时数字弹一下，给一个"到位了"的手感 */
  .knest-slider .vl.knest-bump{animation:knest-bump .26s cubic-bezier(.34,1.56,.64,1)}
  @keyframes knest-bump{
    0%{transform:scale(1)} 38%{transform:scale(1.22)} 100%{transform:scale(1)}
  }
  .knest-slider .note{font-size:11px;color:var(--kn-mute,#82828a);margin-top:7px;line-height:1.5}

  .knest-slider input[type="range"]{
    -webkit-appearance:none; appearance:none; width:100%; height:4px; border-radius:2px;
    background:linear-gradient(90deg,
      var(--kn-echo,#f0f0f2) 0%,
      var(--kn-echo,#f0f0f2) var(--fill,50%),
      rgba(128,128,140,.28) var(--fill,50%));
    outline:none; cursor:pointer;
    transition:height .14s ease;
  }
  .knest-slider input[type="range"]:active{height:6px}

  .knest-slider input[type="range"]::-webkit-slider-thumb{
    -webkit-appearance:none; width:15px; height:15px; border-radius:4px;
    background:var(--kn-panel,#141416); border:2px solid var(--kn-echo,#f0f0f2);
    cursor:grab;
    box-shadow:0 1px 4px rgba(0,0,0,.35);
    transition:transform .16s cubic-bezier(.34,1.56,.64,1), box-shadow .16s ease, border-radius .16s ease;
  }
  .knest-slider input[type="range"]:hover::-webkit-slider-thumb{transform:scale(1.14)}
  /* 按住时滑块头放大、变圆、周围透一圈光：手指压下去的分量 */
  .knest-slider input[type="range"]:active::-webkit-slider-thumb{
    transform:scale(1.32); border-radius:50%;
    box-shadow:0 0 0 6px var(--kn-echo-soft,rgba(240,240,242,.16)),0 2px 8px rgba(0,0,0,.45);
  }
  .knest-slider input[type="range"]:focus-visible::-webkit-slider-thumb{
    box-shadow:0 0 0 4px var(--kn-echo-soft,rgba(240,240,242,.24));
  }
  .knest-slider input[type="range"]::-moz-range-thumb{
    width:13px; height:13px; border-radius:4px;
    background:var(--kn-panel,#141416); border:2px solid var(--kn-echo,#f0f0f2);
    cursor:grab; transition:transform .16s ease,border-radius .16s ease;
  }
  .knest-slider input[type="range"]:active::-moz-range-thumb{transform:scale(1.3);border-radius:50%}

  .knest-set-preview{
    margin-top:6px; padding:12px 14px; border-radius:var(--kn-card-radius,10px);
    background:var(--kn-panel,#141416); border:1px solid var(--kn-card-border,#2a2a2e);
    font-size:12.5px; color:var(--kn-ink,#f0f0f2); line-height:1.7; transition:min-height .18s ease;
  }
  .knest-set-preview b{display:block;font-size:14px;margin-bottom:5px;font-weight:600}`,

  /* ── 右下角入口弹出的外观浮层 ─────────────────────────────────── */
  `.knest-look-panel{
    position:fixed; right:16px; bottom:64px; z-index:2147483001;
    width:318px; max-height:calc(100vh - 130px); overflow:auto;
    padding:14px 16px 16px; border-radius:12px;
    background:var(--kn-panel,#141416);
    border:1px solid var(--kn-rule,#2a2a2e);
    box-shadow:0 10px 30px rgba(0,0,0,.4);
    color:var(--kn-ink,#f0f0f2); font-size:12.5px; line-height:1.6;
    display:none;
  }
  .knest-look-panel[data-open="true"]{display:block}
  .knest-look-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
  .knest-look-head b{font-size:13px;font-weight:600}
  .knest-look-x{
    width:22px;height:22px;border:0;background:none;cursor:pointer;
    color:var(--kn-mute,#82828a);font-size:17px;line-height:1;border-radius:5px;
  }
  .knest-look-x:hover{color:var(--kn-ink,#f0f0f2);background:var(--kn-rule,#2a2a2e)}
  .knest-logo-btn[data-open="true"]{border-color:var(--kn-signal,#e8e8ec)}`,

  /* ── 国旗语言选择器 ─────────────────────────────────────────────
     Windows 的 emoji 字体没有区域指示符，🇨🇳 会变成 CN 两个字母。
     所以国旗全部用 CSS 画：条纹走 linear-gradient，圆点走伪元素。 */
  `.knest-langs{margin-top:4px}
  .knest-langs-label{font-size:12.5px;color:var(--kn-ink,#f0f0f2);margin-bottom:10px;letter-spacing:.02em}
  .knest-langs-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:7px}

  .knest-flag{
    display:flex;align-items:center;gap:8px;
    padding:7px 9px;border-radius:8px;cursor:pointer;
    background:transparent;border:1px solid transparent;
    color:var(--kn-mute,#82828a);font:500 11.5px/1.2 "Microsoft YaHei",system-ui,sans-serif;
    text-align:left;
    transition:background .16s ease, border-color .16s ease, color .16s ease, transform .16s cubic-bezier(.34,1.56,.64,1);
  }
  .knest-flag:hover{
    background:var(--kn-rule,#2a2a2e);color:var(--kn-ink,#f0f0f2);
    transform:translateY(-1px);
  }
  .knest-flag[data-on="1"]{
    background:var(--kn-echo-soft,rgba(240,240,242,.12));
    border-color:var(--kn-echo,#f0f0f2);
    color:var(--kn-ink,#f0f0f2);
  }
  .knest-flag[data-on="1"] .knest-flag-box{
    box-shadow:0 0 0 1.5px var(--kn-panel,#141416),0 0 0 2.5px var(--kn-echo,#f0f0f2);
  }

  .knest-flag-box{
    flex:0 0 auto;width:22px;height:15px;border-radius:2px;overflow:hidden;
    position:relative;background:#888;
    transition:transform .16s cubic-bezier(.34,1.56,.64,1), box-shadow .16s ease;
  }
  .knest-flag:hover .knest-flag-box{transform:scale(1.18)}

  .knest-flag-name{
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
  }

  /* 简体：红底 + 左上黄星 */
  .knest-flag-box[data-flag="zh-CN"]{background:#de2910}
  .knest-flag-box[data-flag="zh-CN"]::after{
    content:"★";position:absolute;left:1px;top:-2px;font-size:8px;color:#ffde00;line-height:1;
  }
  /* 繁體：青天白日满地红，简化成蓝角 + 红身 */
  .knest-flag-box[data-flag="zh-TW"]{
    background:linear-gradient(90deg,#000095 0 52%,#fe0000 52% 100%);
  }
  .knest-flag-box[data-flag="zh-TW"]::after{
    content:"";position:absolute;left:3px;top:3px;width:6px;height:6px;border-radius:50%;
    background:#fff;box-shadow:inset 0 0 0 1.5px #000095;
  }
  /* English：米字旗简化成红底白十字 + 蓝角 */
  .knest-flag-box[data-flag="en"]{
    background:
      linear-gradient(90deg,transparent 44%,#fff 44% 56%,transparent 56%),
      linear-gradient(0deg,transparent 38%,#fff 38% 62%,transparent 62%),
      linear-gradient(90deg,transparent 47%,#cf142b 47% 53%,transparent 53%),
      linear-gradient(0deg,transparent 44%,#cf142b 44% 56%,transparent 56%),
      #012169;
  }
  /* 日本語：白底红圆 */
  .knest-flag-box[data-flag="ja"]{background:#fff}
  .knest-flag-box[data-flag="ja"]::after{
    content:"";position:absolute;left:50%;top:50%;width:8px;height:8px;border-radius:50%;
    background:#bc002d;transform:translate(-50%,-50%);
  }
  /* 한국어：白底红蓝太极（简化成上下两半） */
  .knest-flag-box[data-flag="ko"]{background:#fff}
  .knest-flag-box[data-flag="ko"]::after{
    content:"";position:absolute;left:50%;top:50%;width:8px;height:8px;border-radius:50%;
    background:linear-gradient(180deg,#cd2e3a 0 50%,#0047a0 50% 100%);
    transform:translate(-50%,-50%);
  }
  /* Deutsch：黑红金横条 */
  .knest-flag-box[data-flag="de"]{
    background:linear-gradient(180deg,#000 0 33.3%,#dd0000 33.3% 66.6%,#ffce00 66.6% 100%);
  }
  /* Français：蓝白红竖条 */
  .knest-flag-box[data-flag="fr"]{
    background:linear-gradient(90deg,#002395 0 33.3%,#fff 33.3% 66.6%,#ed2939 66.6% 100%);
  }
  /* Español：红黄红横条 */
  .knest-flag-box[data-flag="es"]{
    background:linear-gradient(180deg,#aa151b 0 25%,#f1bf00 25% 75%,#aa151b 75% 100%);
  }
  /* Русский：白蓝红横条 */
  .knest-flag-box[data-flag="ru"]{
    background:linear-gradient(180deg,#fff 0 33.3%,#0039a6 33.3% 66.6%,#d52b1e 66.6% 100%);
  }`,
  `.knest-logo-btn .knest-fab-lang{
    font:600 9.5px/1 "Cascadia Mono",Consolas,monospace;
    letter-spacing:.04em;opacity:.55;margin-left:1px;
    padding:1px 4px;border-radius:3px;
    background:var(--kn-rule,#2a2a2e);
  }`,
];
