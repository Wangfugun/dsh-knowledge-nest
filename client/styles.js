/**
 * 样式：一次注入，原地替换。
 *
 * 方向：**深海声呐 / 等深线**。插件做的是「在一段对话里给一个词定位」，
 * 声呐的语法正好是它：一条时间轴、一次回波、一个被钉住的点。
 *
 * 两条硬约束（都是线上踩出来的）：
 *  1) 底色/字色**不依赖宿主变量**：白底白字曾经让气泡整块看不见；
 *  2) 高亮色必须挂在 `<html data-knest-theme>` 上——`::highlight()` 拿的是
 *     被高亮文字的变量，插件容器里的私有变量够不着。
 *
 * 刻意避开的默认：圆角卡片 + 统一柔阴影、近黑底 + 酸性绿、全大写小标签、
 * 以「·」拼接的元信息串、装饰性的逐段淡入。
 */

/** 样式版本号：写进 style 标签，方便一眼确认浏览器里跑的是哪一版。 */
export const KNEST_STYLE_REV = 'r2';

/** 样式正文。 */
export const KNEST_CSS = [
  /* ── 令牌：挂在 html 上，供 ::highlight 与浮层共用 ───────────────── */
  'html[data-knest-theme="dark"]{--kn-bg:var(--dsw-alias-bg-base,#070E18);--kn-panel:var(--dsw-alias-bg-layer-1,#0B1624);--kn-rule:var(--dsw-alias-border-l2,#182636);--kn-ink:var(--dsw-alias-label-primary,#E6EEF8);--kn-mute:var(--dsw-alias-label-tertiary,#7C8DA3);--kn-signal:#6A84FF;--kn-echo:#46E0A4;--kn-echo-soft:rgba(70,224,164,.17);--kn-warn:#FFB877;--kn-domain:#E8A33D;--kn-domain-soft:rgba(232,163,61,.18);--kn-shadow:0 22px 60px rgba(0,0,0,.62),0 2px 0 rgba(255,255,255,.04) inset}',
  'html[data-knest-theme="light"]{--kn-bg:var(--dsw-alias-bg-base,#EFF3F6);--kn-panel:var(--dsw-alias-bg-layer-1,#FFFFFF);--kn-rule:var(--dsw-alias-border-l2,#C9D5DE);--kn-ink:var(--dsw-alias-label-primary,#0B1721);--kn-mute:var(--dsw-alias-label-tertiary,#56687A);--kn-signal:#2038B8;--kn-echo:#04724A;--kn-echo-soft:rgba(4,114,74,.14);--kn-warn:#96480A;--kn-domain:#B26A00;--kn-domain-soft:rgba(178,106,0,.14);--kn-shadow:0 1px 0 rgba(11,23,33,.05),0 12px 30px rgba(11,23,33,.14)}',

  /* ── 绿色高亮：宿主正文与插件正文同一套 ─────────────────────────── */
  '::highlight(knest-echo){background-color:var(--kn-echo-soft);color:var(--kn-echo);text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:3px}',
  '.knest-mark{background:var(--kn-echo-soft);color:var(--kn-echo);text-decoration:underline;text-underline-offset:3px}',
  /* 同领域标记：橙色，和绿高亮用两个不同的高亮名，互不覆盖 */
  '::highlight(knest-domain){background-color:var(--kn-domain-soft);color:var(--kn-domain);text-decoration:underline;text-decoration-color:var(--kn-domain);text-underline-offset:3px}',

  /* ── 地图舞台 ─────────────────────────────────────────────────── */
  '.knest-stage{position:relative;min-height:100%;box-sizing:border-box;padding:0 0 44px;background:var(--kn-bg);color:var(--kn-ink);font-size:13px;line-height:1.6;overflow:hidden;isolation:isolate}',
  '.knest-stage::before{content:"";position:absolute;inset:-60px;z-index:0;pointer-events:none}',
  /* 暗色：等深线（同心环）+ 顶部微微发蓝，60 秒漂一格，慢到不像动画；只在右上角显形 */
  'html[data-knest-theme="dark"] .knest-stage::before{background-image:repeating-radial-gradient(circle at 84% -8%,rgba(106,132,255,.14) 0 1px,transparent 1px 32px),linear-gradient(180deg,rgba(106,132,255,.07),transparent 46%);-webkit-mask-image:radial-gradient(120% 82% at 86% 0%,#000 0%,rgba(0,0,0,.35) 46%,transparent 66%);mask-image:radial-gradient(120% 82% at 86% 0%,#000 0%,rgba(0,0,0,.35) 46%,transparent 66%);animation:knest-depth 60s ease-in-out infinite alternate}',
  /* 亮色：24px 细网格 + 两道很淡的水面光斑，横向漂 */
  'html[data-knest-theme="light"] .knest-stage::before{background-image:linear-gradient(90deg,rgba(11,23,33,.05) 0 1px,transparent 1px 24px),linear-gradient(0deg,rgba(11,23,33,.05) 0 1px,transparent 1px 24px),linear-gradient(104deg,transparent 42%,rgba(4,114,74,.05) 46%,transparent 50%,rgba(32,56,184,.045) 62%,transparent 66%);background-size:24px 24px,24px 24px,auto,auto;animation:knest-caustic 74s linear infinite alternate}',
  '.knest-stage > *{position:relative;z-index:1}',

  /* ── 顶部（吸顶细栏，不是卡片） ─────────────────────────────────── */
  '.knest-rail{position:sticky;top:0;z-index:3;display:flex;align-items:baseline;gap:10px;padding:15px 20px 12px;background:linear-gradient(var(--kn-bg) 74%,transparent)}',
  '.knest-rail h2{margin:0;font-size:13px;font-weight:600;letter-spacing:.03em}',
  '.knest-fig{font-size:12px;color:var(--kn-mute);font-variant-numeric:tabular-nums}',
  '.knest-lead-in{margin:2px 20px 10px;font-size:12px;line-height:1.7;color:var(--kn-mute);max-width:52ch}',
  '.knest-key{border:0;background:none;color:var(--kn-signal);font:inherit;font-size:12px;padding:0;cursor:pointer;text-underline-offset:3px;text-decoration:underline;text-decoration-thickness:1px}',
  '.knest-key:hover{text-decoration-thickness:2px}',

  /* ── 图 ──────────────────────────────────────────────────────── */
  '.knest-map{position:relative;margin:0 20px;max-width:640px}',
  '.knest-svg{position:absolute;inset:0;overflow:visible;pointer-events:none}',
  '.knest-role-mark{position:absolute;left:0;transform:translateY(-50%);font-size:9px;line-height:1;color:var(--kn-mute);opacity:.5;pointer-events:none}',
  '.knest-role-mark[data-role="you"]{color:var(--kn-signal);opacity:.7}',
  '.knest-svg line{stroke:var(--kn-rule);stroke-width:1;shape-rendering:crispEdges}',
  '.knest-svg line[data-kind="spine"]{stroke:var(--kn-rule)}',
  '.knest-svg line[data-kind="tick-you"]{stroke:var(--kn-signal);opacity:.55}',
  '.knest-svg line[data-kind="tick-ai"]{stroke:var(--kn-mute);opacity:.3}',
  '.knest-svg line[data-kind="stem"]{stroke:var(--kn-rule);stroke-dasharray:2 3}',
  '.knest-svg line[data-kind="branch"]{stroke:var(--kn-rule)}',
  '.knest-svg line[data-kind="same"]{stroke:var(--kn-signal);opacity:.42}',

  '.knest-point{position:absolute;display:inline-flex;align-items:center;gap:7px;max-width:min(60vw,320px);padding:3px 6px 3px 0;margin:0;border:0;background:none;color:var(--kn-ink);font:inherit;font-size:12.5px;line-height:1.3;text-align:left;cursor:pointer;transform:translateY(-50%);border-radius:2px}',
  '.knest-point:focus-visible{outline:1px solid var(--kn-signal);outline-offset:2px}',
  '.knest-ring-dot{flex:0 0 auto;width:8px;height:8px;border-radius:50%;border:1px solid var(--kn-echo);background:transparent;transition:background .16s ease,box-shadow .16s ease}',
  '.knest-point[data-explained="true"] .knest-ring-dot{background:var(--kn-echo)}',
  '.knest-point[data-pending="true"] .knest-ring-dot{animation:knest-pulse 1.4s ease-in-out infinite}',
  '.knest-point:hover .knest-ring-dot,.knest-point[data-active="true"] .knest-ring-dot{box-shadow:0 0 0 3px var(--kn-echo-soft)}',
  '.knest-point .knest-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.knest-point .knest-times{font-size:11px;color:var(--kn-mute);font-variant-numeric:tabular-nums}',
  '.knest-point[data-active="true"] .knest-label{color:var(--kn-echo)}',

  /* ── 空态 ────────────────────────────────────────────────────── */
  '.knest-blank{margin:26px 20px;max-width:46ch;color:var(--kn-mute);font-size:12.5px;line-height:1.85}',
  '.knest-blank b{color:var(--kn-ink);font-weight:600}',
  '.knest-steps{margin:12px 0 0;padding:0;list-style:none;counter-reset:knest-step}',
  '.knest-steps li{counter-increment:knest-step;position:relative;padding-left:24px;margin-bottom:6px}',
  '.knest-steps li::before{content:counter(knest-step) ".";position:absolute;left:0;top:0;color:var(--kn-echo);font-variant-numeric:tabular-nums;font-weight:600}',

  /* ── 浮层根：不挡点击 ─────────────────────────────────────────── */
  '#knest-echo-layer{position:fixed;inset:0;z-index:2147483000;pointer-events:none;font-family:inherit}',

  /* 声呐环：只在"刚圈住"的一瞬出现 */
  '.knest-sonar{position:absolute;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;border:1px solid var(--kn-echo);opacity:.7;animation:knest-sonar 620ms cubic-bezier(.16,.72,.24,1) forwards}',
  '.knest-sonar:nth-of-type(2){animation-delay:110ms}',

  '.knest-head{display:flex;align-items:flex-start;gap:8px;padding:14px 15px 9px}',
  '.knest-phrase{margin:0;font-family:"Songti SC","Noto Serif SC","Source Han Serif SC",Georgia,serif;font-size:19px;line-height:1.36;font-weight:500;letter-spacing:.01em;overflow-wrap:anywhere}',
  '.knest-kind{flex:0 0 auto;margin-left:auto;font-size:10.5px;line-height:16px;color:var(--kn-mute);border:1px solid var(--kn-rule);padding:0 5px}',
  '.knest-x{flex:0 0 auto;width:20px;height:20px;border:0;background:none;color:var(--kn-mute);font-size:15px;line-height:1;cursor:pointer;padding:0}',
  '.knest-x:hover{color:var(--kn-echo)}',
  '.knest-body{padding:12px 15px 13px}',
  '.knest-here{margin:0 0 11px;font-size:15px;line-height:1.74;letter-spacing:.004em;overflow-wrap:anywhere}',
  '.knest-hr{height:1px;background:var(--kn-rule);margin:11px -15px}',
  '.knest-h{margin:0 0 6px;font-size:11px;font-weight:600;color:var(--kn-mute);letter-spacing:.06em}',
  '.knest-list{margin:0;padding:0;list-style:none}',
  '.knest-list li{margin:0 0 8px;overflow-wrap:anywhere}',
  '.knest-list li:last-child{margin-bottom:0}',
  '.knest-quote{display:block;color:var(--kn-ink);opacity:.94}',
  '.knest-quote::before{content:"\\201C";color:var(--kn-echo)}',
  '.knest-quote::after{content:"\\201D";color:var(--kn-echo)}',
  '.knest-why{display:block;color:var(--kn-mute);font-size:12px;margin-top:1px}',
  '.knest-alt{color:var(--kn-ink)}',
  '.knest-alt-note{color:var(--kn-mute);font-size:12px}',
  '.knest-tree>li{margin-bottom:7px}',
  '.knest-node{display:flex;gap:6px;color:var(--kn-ink)}',
  '.knest-node::before{content:"";flex:0 0 auto;width:5px;height:5px;margin-top:7px;border:1px solid var(--kn-signal);transform:rotate(45deg)}',
  '.knest-kids{margin:4px 0 0 2px;padding:0 0 0 12px;list-style:none;border-left:1px solid var(--kn-rule)}',
  '.knest-kids li{position:relative;padding-left:9px;margin-bottom:4px;color:var(--kn-mute);font-size:12px}',
  '.knest-kids li::before{content:"";position:absolute;left:-12px;top:8px;width:9px;height:1px;background:var(--kn-rule)}',
  '.knest-foot{display:flex;align-items:center;gap:8px;padding:8px 15px 10px;border-top:1px solid var(--kn-rule);font-size:11px;color:var(--kn-mute);font-variant-numeric:tabular-nums}',
  '.knest-foot .knest-gap{flex:1}',
  '.knest-conf{display:inline-flex;gap:2px;align-items:center}',
  '.knest-conf i{width:3px;height:8px;background:var(--kn-rule)}',
  '.knest-conf i[data-on="true"]{background:var(--kn-echo)}',
  '.knest-conf[data-tone="low"] i[data-on="true"]{background:var(--kn-warn)}',
  '.knest-retry{border:1px solid var(--kn-rule);background:none;color:var(--kn-ink);font:inherit;font-size:11.5px;padding:2px 8px;cursor:pointer}',
  '.knest-retry:hover{border-color:var(--kn-echo);color:var(--kn-echo)}',

  /* 计算中：一条扫过的线，比转圈诚实 */
  '.knest-scan{position:relative;height:2px;background:var(--kn-rule);overflow:hidden;margin:2px 0 10px}',
  '.knest-scan::after{content:"";position:absolute;inset:0;background:var(--kn-echo);transform:translateX(-100%);animation:knest-sweep 1.15s cubic-bezier(.5,0,.5,1) infinite}',
  '.knest-skel{height:9px;background:var(--kn-rule);opacity:.55;margin-bottom:7px}',
  '.knest-skel[data-w="84"]{width:84%}',
  '.knest-skel[data-w="62"]{width:62%}',

  /* ── 「启用圈词」竖牌（贴右侧边缘） ───────────────────────────── */
  '#knest-switch[data-hidden="true"]{display:none}',
  '#knest-switch{position:fixed;right:44px;top:22%;z-index:2147482999;pointer-events:auto}',
  '.knest-toast{position:fixed;right:56px;top:calc(38% - 8px);max-width:min(340px,60vw);padding:7px 11px;background:var(--kn-panel);border:1px solid var(--kn-rule);box-shadow:var(--kn-shadow);color:var(--kn-ink);font-size:12px;line-height:1.55;overflow-wrap:anywhere;pointer-events:none;z-index:2147483007;opacity:0;transform:translateX(6px);transition:opacity .16s ease,transform .16s ease}',
  '.knest-toast[data-show="true"]{opacity:1;transform:none}',
  /* 拖动时的字数提示：贴在指针旁，告诉用户已经选中多少字 */
  '.knest-drag-hint{position:fixed;z-index:2147483006;padding:4px 9px;border-radius:999px;border:1px solid var(--kn-echo);background:var(--kn-panel);color:var(--kn-echo);font-size:11px;line-height:1.5;font-variant-numeric:tabular-nums;white-space:nowrap;pointer-events:none;box-shadow:0 2px 8px rgba(0,0,0,.28);opacity:0;transform:translateY(-3px);transition:opacity .12s ease,transform .12s ease}',
  '.knest-drag-hint[data-show="true"]{opacity:1;transform:none}',
  /* 设置面板：注入到宿主页面里的配置浮层 */
  '.knest-gear{position:fixed;right:18px;bottom:18px;z-index:2147483005;width:34px;height:34px;display:flex;align-items:center;justify-content:center;border-radius:50%;border:1px solid var(--kn-rule);background:var(--kn-panel);color:var(--kn-mute);font-size:15px;line-height:1;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.28);transition:color .15s ease,border-color .15s ease,transform .15s ease}',
  '.knest-gear:hover{color:var(--kn-ink);border-color:var(--kn-echo);transform:rotate(35deg)}',
  /* 右侧竖条入口：贴在窗口右边缘，比角落小圆点显眼得多 */
  '.knest-edge-tab{position:fixed;right:2px;top:34%;z-index:2147483005;display:flex;align-items:center;justify-content:center;padding:18px 8px;border:1px solid var(--kn-echo);border-right:0;border-radius:11px 0 0 11px;background:color-mix(in srgb,var(--kn-echo) 14%,var(--kn-panel));color:var(--kn-echo);cursor:pointer;font:inherit;box-shadow:-2px 0 16px rgba(0,0,0,.28);transition:padding .18s ease,background .18s ease}',
  '.knest-edge-tab:hover{padding-right:14px;background:color-mix(in srgb,var(--kn-echo) 24%,var(--kn-panel))}',
  '.knest-edge-tab[data-open="true"]{color:var(--kn-echo);border-color:var(--kn-echo)}',
  '.knest-edge-tab span{display:block;writing-mode:vertical-rl;text-orientation:mixed;letter-spacing:.26em;font-size:11.5px;line-height:1;white-space:nowrap}',
  '.knest-edge-tab[data-alert="1"]::after{content:"";position:absolute;top:8px;right:7px;width:7px;height:7px;border-radius:50%;background:#ff6b6b;box-shadow:0 0 0 3px rgba(255,107,107,.22);animation:knest-pulse 1.8s ease-in-out infinite}',
  '@keyframes knest-pulse{0%,100%{opacity:1}50%{opacity:.35}}',
  '.knest-settings{position:fixed;right:18px;bottom:62px;width:352px;max-height:calc(100vh - 110px);overflow:auto;z-index:2147483004;background:var(--kn-panel);border:1px solid var(--kn-rule);border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.42);color:var(--kn-ink);font-size:12.5px;line-height:1.6;padding:14px 16px 16px;display:none}',
  '.knest-settings[data-open="true"]{display:block}',
  '.knest-set-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}',
  '.knest-set-head b{font-size:13px;font-weight:600}',
  '.knest-set-x{background:transparent;border:0;color:var(--kn-mute);font-size:17px;line-height:1;cursor:pointer;padding:2px 4px}',
  '.knest-set-x:hover{color:var(--kn-ink)}',
  '.knest-set-status{background:rgba(127,127,127,.08);border:1px solid var(--kn-rule);border-radius:8px;padding:8px 10px;margin-bottom:12px;font-size:11.5px}',
  '.knest-set-status b{color:var(--kn-echo);font-weight:500}',
  '.knest-set-path{color:var(--kn-mute);font-size:10.5px;overflow-wrap:anywhere;margin-top:4px}',
  '.knest-set-presets{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:12px}',
  '.knest-set-presets button{text-align:left;background:transparent;border:1px solid var(--kn-rule);border-radius:8px;padding:7px 9px;cursor:pointer;color:var(--kn-ink);font:inherit;transition:border-color .15s ease}',
  '.knest-set-presets button:hover{border-color:var(--kn-echo)}',
  '.knest-set-presets button[data-on="1"]{border-color:var(--kn-echo);background:var(--kn-echo-soft)}',
  '.knest-set-presets b{display:block;font-size:12px;font-weight:600;margin-bottom:1px}',
  '.knest-set-presets span{display:block;color:var(--kn-mute);font-size:10.5px;line-height:1.45}',
  '.knest-set-fields label{display:block;margin-bottom:9px;color:var(--kn-mute);font-size:11px}',
  '.knest-set-fields input{width:100%;margin-top:3px;background:rgba(0,0,0,.22);border:1px solid var(--kn-rule);border-radius:7px;color:var(--kn-ink);padding:6px 8px;font:inherit;font-size:12px;outline:none}',
  '.knest-set-fields input:focus{border-color:var(--kn-echo)}',
  '.knest-set-key-row[data-optional="1"]{opacity:.6}',
  '.knest-set-actions{display:flex;gap:8px;margin-top:4px}',
  '.knest-set-actions button{flex:1;border-radius:8px;padding:7px 10px;font:inherit;font-size:12px;cursor:pointer;border:1px solid var(--kn-rule);background:transparent;color:var(--kn-ink)}',
  '.knest-set-actions button.knest-set-save{background:var(--kn-echo);border-color:var(--kn-echo);color:#08130d;font-weight:600}',
  '.knest-set-actions button:disabled{opacity:.5;cursor:default}',
  '.knest-set-msg{margin-top:10px;font-size:11.5px;white-space:pre-wrap;word-break:break-all;display:none}',
  '.knest-set-msg[data-kind="ok"]{display:block;color:var(--kn-echo)}',
  '.knest-set-msg[data-kind="bad"]{display:block;color:#ff6b6b}',
  '.knest-switch-btn{display:flex;flex-direction:column;align-items:center;gap:9px;padding:13px 4px;background:var(--kn-panel);color:var(--kn-mute);border:1px solid var(--kn-rule);border-radius:0;cursor:pointer;font:inherit;transition:transform .16s ease,color .16s ease,border-color .16s ease}',
  '.knest-switch-btn:hover{transform:translateX(-3px);color:var(--kn-ink);border-color:var(--kn-signal)}',
  '.knest-switch-btn:focus-visible{outline:1px solid var(--kn-signal);outline-offset:-3px}',
  '.knest-switch-text{writing-mode:vertical-rl;text-orientation:mixed;letter-spacing:.22em;font-size:10.5px;line-height:1}',
  '.knest-switch-dot{width:7px;height:7px;border-radius:50%;border:1px solid var(--kn-mute);background:transparent;transition:background .16s ease,box-shadow .16s ease}',
  '#knest-switch[data-on="true"] .knest-switch-text{color:var(--kn-ink)}',
  '#knest-switch[data-on="true"] .knest-switch-dot{background:var(--kn-echo);border-color:var(--kn-echo);box-shadow:0 0 0 3px var(--kn-echo-soft)}',
  '#knest-switch[data-on="false"] .knest-switch-btn{border-style:dashed;opacity:.72}',

  /* ── 右键菜单（关掉圈词时用） ─────────────────────────────────── */
  '#knest-menu-layer{position:fixed;inset:0;z-index:2147483001;pointer-events:none}',
  '.knest-menu{position:absolute;pointer-events:auto;min-width:176px;padding:5px;background:var(--kn-panel);color:var(--kn-ink);border:1px solid var(--kn-rule);box-shadow:var(--kn-shadow);font-size:12.5px;line-height:1.5}',
  '.knest-mi{display:flex;align-items:center;gap:9px;width:100%;padding:6px 8px;border:0;background:none;color:var(--kn-ink);font:inherit;text-align:left;cursor:pointer}',
  '.knest-mi:hover:not(:disabled){background:var(--kn-echo-soft)}',
  '.knest-mi:disabled{opacity:.36;cursor:default}',
  '.knest-mi svg{flex:0 0 auto}',
  '.knest-mi-label{flex:1}',
  '.knest-mi-hint{font-size:10.5px;color:var(--kn-mute);font-variant-numeric:tabular-nums}',
  '.knest-mi[data-action="query"] .knest-mi-label{color:var(--kn-echo)}',
  '.knest-mdiv{height:1px;background:var(--kn-rule);margin:4px 6px}',
  '.knest-mi-lead{color:var(--kn-mute)}',
  '.knest-mi-more{color:var(--kn-signal)}',
  '.knest-menu[data-page] .knest-mi{animation:knest-menu-in .12s ease-out both}',

  /* ── 批注模式：红字 + 删除线 + 常驻气泡 ─────────────────────── */
  '::highlight(knest-note){color:#e0564a;text-decoration:line-through;text-decoration-thickness:1.5px;text-decoration-color:#e0564a}',
  '.knest-notes-layer{position:fixed;inset:0;z-index:2147483005;pointer-events:none}',
  'body[data-knest-annotate="true"]::after{content:"批注模式：拖过一段字就标红 · Esc 退出";position:fixed;left:50%;top:10px;transform:translateX(-50%);z-index:2147483010;padding:4px 12px;border-radius:999px;background:#e0564a;color:#fff;font:12px/1.6 inherit;pointer-events:none;box-shadow:0 2px 10px rgba(224,86,74,.35)}',
  '.knest-note-toggle{position:fixed;right:44px;top:calc(22% + 84px);z-index:2147482999;width:28px;padding:9px 0;border:1px solid var(--kn-rule);border-radius:8px;background:var(--kn-panel);color:var(--kn-mute);font:11px/1 inherit;letter-spacing:.16em;writing-mode:vertical-rl;letter-spacing:.18em;line-height:1;cursor:pointer}',
  '.knest-note-wipe{position:fixed;right:44px;top:calc(22% + 140px);z-index:2147482999;width:28px;padding:7px 0;border:1px solid var(--kn-rule);border-radius:8px;background:var(--kn-panel);color:var(--kn-mute);font:10px/1 inherit;writing-mode:vertical-rl;cursor:pointer;opacity:.8}',
  '.knest-note-wipe:hover{color:#e0564a;border-color:#e0564a;opacity:1}',
  '.knest-note-toggle[data-on="true"]{border-color:#e0564a;color:#e0564a}',
  '.knest-note-bubble[data-collapsed="true"]{max-width:220px}',
  '.knest-note-bubble[data-collapsed="true"] .knest-note-input{display:none}',
  '.knest-note-bubble[data-kind="strike"] .knest-note-input{opacity:.4;caret-color:transparent}',
  '.knest-note-bubble[data-submitted="true"]{opacity:.45;border-color:var(--kn-rule)}',
  '.knest-note-head{display:flex;align-items:center;gap:4px;flex:0 0 auto}',
  '.knest-note-kind{border:1px solid currentColor;background:none;color:#e0564a;font:10px/1.4 inherit;padding:0 4px;cursor:pointer;border-radius:3px}',
  '.knest-notes-clear{position:absolute;left:14px;top:14px;pointer-events:auto;padding:3px 9px;border:1px solid #e0564a;border-radius:999px;background:var(--kn-panel);color:#e0564a;font:11px/1.5 inherit;cursor:pointer;opacity:.7}',
  '.knest-notes-clear:hover{opacity:1}',
  '.knest-note-bubble{position:absolute;pointer-events:auto;display:flex;align-items:flex-start;gap:4px;padding:5px 6px;border:1px solid #e0564a;border-radius:6px;background:var(--kn-panel);box-shadow:var(--kn-shadow);max-width:320px}',
  '.knest-note-input{flex:1;min-width:120px;min-height:18px;border:0;background:none;color:var(--kn-ink);font:12px/1.5 inherit;resize:none;outline:none;overflow:hidden;caret-color:var(--kn-ink);cursor:text}',
  '.knest-note-del{flex:0 0 auto;width:18px;height:18px;border:0;background:none;color:var(--kn-mute);cursor:pointer;padding:0;font-size:13px;line-height:1}',
  '.knest-note-del:hover{color:#e0564a}',
  'body[data-knest-annotate="true"] .knest-switch-btn{border-color:#e0564a;color:#e0564a}',
  '.knest-pending{position:fixed;left:50%;top:10px;transform:translateX(-50%);z-index:2147483646;padding:4px 12px;border-radius:999px;border:1px solid #e0564a;background:var(--kn-panel);color:#e0564a;font:11.5px/1.6 inherit;cursor:pointer}',
  '.knest-guide{position:fixed;left:50%;bottom:88px;transform:translateX(-50%);z-index:2147483647;max-width:min(640px,80vw);padding:10px 16px;border-radius:999px;border:1px solid var(--kn-rule);background:var(--kn-panel);color:var(--kn-ink);font:12.5px/1.7 inherit;box-shadow:0 8px 24px rgba(0,0,0,.3)}',
  /* ── 知识库面板（Ctrl+K 呼出） ─────────────────────────────── */
  '.knest-lib{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:flex-start;justify-content:center;padding-top:14vh;background:color-mix(in srgb,#000 42%,transparent)}',
  '.knest-lib-box{width:min(560px,86vw);max-height:64vh;display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--kn-rule);border-radius:12px;background:var(--kn-panel);box-shadow:0 18px 50px rgba(0,0,0,.4)}',
  '.knest-lib-input{width:100%;box-sizing:border-box;border:0;border-bottom:1px solid var(--kn-rule);background:none;color:var(--kn-ink);font:14px/1.6 inherit;padding:12px 14px;outline:none}',
  '.knest-lib-list{overflow:auto;padding:6px}',
  '.knest-lib-meta{padding:4px 8px 8px;font-size:11px;color:var(--kn-mute)}',
  '.knest-lib-row{display:grid;grid-template-columns:minmax(0,auto) minmax(0,1fr) auto;gap:8px;align-items:baseline;width:100%;text-align:left;border:0;border-radius:8px;background:none;color:var(--kn-ink);font:inherit;font-size:12.5px;padding:7px 9px;cursor:pointer}',
  '.knest-lib-row[data-active="true"],.knest-lib-row:hover{background:var(--kn-echo-soft)}',
  '.knest-lib-phrase{font-family:\"Songti SC\",\"Noto Serif SC\",Georgia,serif;font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:180px}',
  '.knest-lib-lead{color:var(--kn-mute);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.knest-lib-tag{font-size:10px;color:var(--kn-echo);border:1px solid var(--kn-rule);border-radius:999px;padding:0 6px}',
  /* ── 圈词本 ──────────────────────────────────────────────── */
  '.knest-notes{margin:22px 20px 8px;max-width:640px;border-top:1px solid var(--kn-rule);padding-top:10px}',
  '.knest-notes-head{display:flex;align-items:baseline;gap:8px;margin-bottom:8px}',
  '.knest-notes-head h3{margin:0;font-size:12px;font-weight:600;letter-spacing:.04em}',
  '.knest-note-list{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:2px}',
  '.knest-note-list li{display:flex;align-items:flex-start;gap:6px;max-width:560px}',
  '.knest-note-open{flex:1;display:flex;flex-direction:column;gap:2px;padding:6px 8px;border:0;border-left:1px solid transparent;background:none;color:var(--kn-ink);font:inherit;text-align:left;cursor:pointer}',
  '.knest-note-open:hover{border-left-color:var(--kn-echo);background:var(--kn-echo-soft)}',
  '.knest-note-phrase{font-size:12.5px;color:var(--kn-echo)}',
  '.knest-note-lead{font-size:11.5px;color:var(--kn-mute);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
  '.knest-note-del{flex:0 0 auto;width:20px;height:20px;border:0;background:none;color:var(--kn-mute);cursor:pointer;font-size:14px;line-height:1}',
  '.knest-note-del:hover{color:#b4443c}',

  /* ── 设置面板 ────────────────────────────────────────────────── */
  '.knest-form{display:flex;flex-direction:column;gap:10px;font-size:13px;color:var(--kn-ink);max-width:60ch}',
  '.knest-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
  '.knest-row label{color:var(--kn-mute);font-size:12px}',
  '.knest-row input[type="text"],.knest-row select{background:var(--kn-panel);color:var(--kn-ink);border:1px solid var(--kn-rule);border-radius:0;padding:3px 6px;font:inherit;font-size:12.5px}',
  '.knest-note{color:var(--kn-mute);font-size:11.5px;line-height:1.65}',
  '.knest-ok{color:var(--kn-echo)}',
  '.knest-bad{color:var(--kn-warn)}',
  '.knest-input{flex:1;min-width:0;height:26px;padding:0 7px;border:1px solid var(--kn-rule);background:var(--kn-panel);color:var(--kn-ink);font:inherit;font-size:12px}',
  '.knest-input:focus{outline:none;border-color:var(--kn-echo)}',
  '.knest-rule{border:0;border-top:1px solid var(--kn-rule);margin:10px 0 8px}',
  '.knest-file-preview{margin:6px 0 0;padding:8px 10px;max-height:160px;overflow:auto;border:1px solid var(--kn-rule);background:var(--kn-echo-soft);color:var(--kn-ink);font:11.5px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere}',
  '.knest-btn{border:1px solid var(--kn-rule);background:none;color:var(--kn-ink);font:inherit;font-size:12px;padding:3px 10px;cursor:pointer;border-radius:0}',
  '.knest-btn:hover{border-color:var(--kn-echo);color:var(--kn-echo)}',
  '.knest-btn:disabled{opacity:.45;cursor:default}',

  /* ── 知识树画布（取代原来的独立浮窗） ─────────────────────────── */
  '#knest-board{position:fixed;inset:0;z-index:2147483647;display:flex;overflow:visible;pointer-events:none;background:transparent}',
  '#knest-board[data-open="false"]{display:none}',
  '#knest-board[data-dragging="true"]{cursor:grabbing}',
  '.knest-board-main{position:relative;flex:1;min-width:0;min-height:0;overflow:visible;pointer-events:none}',
  '.knest-board-world{position:absolute;left:0;top:0;transform-origin:0 0;will-change:transform;pointer-events:none}',
  '.knest-board-edges{position:absolute;left:0;top:0;width:1px;height:1px;overflow:visible;pointer-events:none}',
  '.knest-edge{fill:none;stroke:color-mix(in srgb,var(--kn-ink) 46%,transparent);stroke-width:1.6}',
  '.knest-edge[data-orientation="horizontal"]{stroke:var(--kn-signal);opacity:.9;stroke-width:1.8}',
  '.knest-board-nodes{position:absolute;left:0;top:0;width:0;height:0}',
  '.knest-tnode{pointer-events:auto;position:absolute;width:300px;border-radius:var(--dsw-radius-lg,8px);border-radius:var(--dsw-radius-lg,8px);background:var(--kn-panel);color:var(--kn-ink);border:1px solid var(--kn-rule);box-shadow:var(--kn-shadow);font-size:12.5px;line-height:1.6}',
  '.knest-tnode[data-selected="true"]{border-color:var(--kn-signal);box-shadow:0 0 0 1px var(--kn-signal),var(--kn-shadow)}',
  '.knest-tnode[data-depth="0"]{border-color:color-mix(in srgb,var(--kn-echo) 45%,var(--kn-rule))}',
  '.knest-tnode[data-collapsed="true"] .knest-tnode-body{display:none}',
  '.knest-tnode-bar{display:flex;align-items:center;gap:6px;height:32px;padding:0 4px 0 10px;border-bottom:1px solid var(--kn-rule);cursor:grab;user-select:none}',
  '.knest-tnode-bar:active{cursor:grabbing}',
  '.knest-tnode-title{flex:1;font-family:"Songti SC","Noto Serif SC",Georgia,serif;font-size:13px;line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.knest-tnode-kind{flex:0 0 auto;font-size:10px;line-height:15px;color:var(--kn-mute);border:1px solid var(--kn-rule);padding:0 4px}',
  '.knest-tnode-btn{flex:0 0 auto;width:20px;height:20px;border:0;background:none;color:var(--kn-mute);font:inherit;line-height:1;cursor:pointer;padding:0}',
  '.knest-tnode-btn:hover{color:var(--kn-ink)}',
  '.knest-tnode-btn[data-act="close"]:hover{color:#b4443c}',
  '.knest-tnode-body{padding:10px 12px 11px}',
  '.knest-tnode-lead{margin:0 0 8px;font-size:12.5px;line-height:1.7;overflow-wrap:anywhere}',
  '.knest-tnode-evidence{margin:0 0 8px;padding:0;list-style:none;display:flex;flex-direction:column;gap:3px;font-size:11.5px;color:var(--kn-mute)}',
  '.knest-tnode-links{display:flex;flex-wrap:wrap;gap:5px;margin-top:2px}',
  '.knest-chip{border:1px solid var(--kn-rule);background:none;color:var(--kn-echo);font:inherit;font-size:11.5px;line-height:1.5;padding:2px 7px;cursor:pointer}',
  '.knest-chip:hover:not(:disabled){background:var(--kn-echo-soft);border-color:var(--kn-echo)}',
  '.knest-chip:disabled{color:var(--kn-mute);opacity:.55;cursor:default}',
  '.knest-tnode-foot{margin-top:8px;font-size:10.5px;color:var(--kn-mute);font-variant-numeric:tabular-nums}',
  '.knest-board-hud{position:absolute;right:16px;bottom:16px;top:auto;left:auto;display:flex;align-items:center;gap:2px;padding:3px;pointer-events:auto;background:color-mix(in srgb,var(--kn-panel) 92%,transparent);border:1px solid var(--kn-rule);box-shadow:var(--kn-shadow);opacity:.72;transition:opacity .14s ease;cursor:grab;user-select:none;touch-action:none}',
  '.knest-board-hud:hover{opacity:1}',
  '.knest-board-hud[data-dragging="true"]{cursor:grabbing;opacity:1}',
  '.knest-board-hud .knest-hud-btn{cursor:pointer}',
  '.knest-hud-btn{width:24px;height:24px;border:0;background:none;color:var(--kn-mute);font:14px/1 ui-sans-serif,system-ui;cursor:pointer;padding:0;border-radius:4px}',
  '.knest-hud-btn:hover{color:var(--kn-ink);background:var(--kn-echo-soft)}',

  /* ── 动效 ────────────────────────────────────────────────────── */
  /* 暗色：从下方「浮上来」——深海里的东西是被推上来的 */
  '@keyframes knest-rise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}',
  /* 亮色：像纸被压平——先虚一点再定住，不做位移动画 */
  '@keyframes knest-print{from{opacity:0;filter:blur(1.5px)}to{opacity:1;filter:none}}',
  '@keyframes knest-sonar{from{transform:scale(.35);opacity:.75}to{transform:scale(2.6);opacity:0}}',
  '@keyframes knest-sweep{from{transform:translateX(-100%)}to{transform:translateX(100%)}}',
  '@keyframes knest-pulse{0%,100%{background:transparent}50%{background:var(--kn-echo)}}',
  '@keyframes knest-depth{from{transform:translateY(0)}to{transform:translateY(-26px)}}',
  '@keyframes knest-caustic{from{background-position:0 0,0 0,0 0,0 0}to{background-position:0 0,0 0,180px 0,-140px 0}}',
  '@keyframes knest-menu-in{from{opacity:0;transform:translateX(-3px)}to{opacity:1;transform:none}}',

  '@media (prefers-reduced-motion: reduce){.knest-stage::before{animation:none!important}.knest-sonar{display:none}.knest-scan::after{animation:none;transform:none;opacity:.5}.knest-point[data-pending="true"] .knest-ring-dot{animation:none;background:var(--kn-echo-soft)}}',
].join('\n');

/**
 * 注入/刷新样式表。
 *
 * ⚠ 踩过的坑：早先"发现已有 style[data-knest-style] 就 return"，于是插件半热更新后
 * 旧 CSS 一直留着。现在改成**原地替换 textContent**，保证样式与当前构建永远同版本。
 * @param {Document} [doc] - 文档（测试可注入）。
 * @returns {void}
 */
export function ensureStyles(doc) {
  try {
    const document = doc ?? (typeof globalThis.document === 'undefined' ? null : globalThis.document);
    if (document === null || typeof document.createElement !== 'function') return;
    const existing = typeof document.querySelector === 'function'
      ? document.querySelector('style[data-knest-style]')
      : null;
    if (existing !== null && existing !== undefined) {
      if (existing.textContent !== KNEST_CSS) existing.textContent = KNEST_CSS;
      existing.setAttribute('data-knest-style', KNEST_STYLE_REV);
      return;
    }
    const style = document.createElement('style');
    style.setAttribute('data-knest-style', KNEST_STYLE_REV);
    style.textContent = KNEST_CSS;
    const head = document.head ?? document.body;
    if (head !== null && head !== undefined && typeof head.appendChild === 'function') head.appendChild(style);
  } catch {
    /* 样式注入失败不影响功能 */
  }
}
