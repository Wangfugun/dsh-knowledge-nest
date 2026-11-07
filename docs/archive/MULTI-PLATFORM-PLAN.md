# MULTI-PLATFORM-PLAN · 圈词（dsh-knowledge-nest）多平台适配方案

> 状态：**方案稿，未写任何适配代码。**
> 基线：`dsh-knowledge-nest@1.3.1`（部署目录与源码零差异，53/53 测试全绿）。
> 证据：平台结论来自同目录的 [MULTI-PLATFORM-RESEARCH.md](./MULTI-PLATFORM-RESEARCH.md)（一手来源 + 逐条 URL）。
> 本文件只回答「拆成哪两层、每层怎么落地、每个平台走哪条路」，不含实现。
>
> **标注约定**：`已核实` = 有一手来源或本机实测；`待验证` = 只有线索；`无法确认` = 查过但官方文档没写。

---

## 1. 平台能力表

| 平台 | 能否注入 DOM 脚本/样式 | MCP 支持（传输） | 官方扩展机制 | 能否在对话正文上圈选高亮 |
|---|---|---|---|---|
| **Cherry Studio**（Electron 45） | **样式：官方支持**（设置→外观→自定义 CSS，注入每窗口 `<head>` 的 `<style id="user-defined-custom-css">`）；**脚本：无官方入口** | **stdio + SSE + 可流式 HTTP**；UI 或 JSON 导入；可导入 **DXT / MCPB** 包 | MCP 服务器 + 技能 + **生成式小程序 `.miniapp`**（独立沙盒，可调 `window.cherry`） | **无法确认**（文档未给正文 DOM 结构/选择器） |
| **WorkBuddy**（腾讯，桌面端） | **无法确认**（官方无 CSS/JS 注入说明） | **是**：连接器 = MCP + CLI，支持「安装自定义 MCP 服务」；**传输类型文档未写** | 连接器 / 技能 / 专家 / Buddy 应用 / 小程序；开发者走 `open.workbuddy.cn` 审核 | **无法确认** |
| **ChatGPT**（Web） | **否**：无注入点；App UI 跑在沙盒 iframe | **仅远程**（HTTPS 端点或 Secure MCP Tunnel）；**不能直连本地 stdio** | Apps SDK（MCP+UI）/ Plugins / Connectors；完整 MCP 限 Business·Enterprise·Edu，Pro 仅 read/fetch | **否** |
| **Claude**（Desktop） | **否**：无 CSS/JS 入口；MCP App 在沙盒 iframe（`*.claudemcpcontent.com`） | **stdio**（`claude_desktop_config.json` / `.mcpb`）+ 远程 HTTPS connector | **MCPB（原 DXT）单文件安装包** + Plugins + MCP Apps + 目录 | **否** |
| **千问**（三条产品线） | **无法确认**：Qwen Chat 无官方注入说明；Qwen Code 有插件体系但非 DOM 注入 | **有**：千问AI平台（自定义 MCP，SSE + Streamable HTTP，云托管不能访问本地）、百炼 Responses API（`server_protocol: sse`）、Qwen Code（MCP 客户端） | Managed Agent + MCP 商店 / Skill 市场 / Sandbox；Qwen Code：Channel 插件 / Agent 插件 / Mods | **无法确认** |

**一句话读表**：五个平台里，**没有一个提供官方的 JS 注入入口**（Cherry Studio 只有 CSS，WorkBuddy 与千问无说明，ChatGPT/Claude 明确禁止）。所以层 2「完整交互」在这五个平台上**全部落不了地**；能落地的只有层 1。

---

## 2. 分层架构

```
                        ┌──────────────────────────────────────────┐
   层 2（宿主相关，可选） │  圈选手势 / 绿色高亮 / 右键菜单 / 卡片窗 / 地图  │
                        │  selector · painter · menu · window · switch │
                        │  只在「能注入 JS 的宿主」成立                  │
                        └───────────────▲──────────────────────────┘
                                        │ 同进程调用（或 HTTP）
                        ┌───────────────┴──────────────────────────┐
   层 1（平台无关，必备） │  explain(phrase, sentence, context, mode)   │
                        │        → { here, kind, literal,           │
                        │            readings[], evidence[],        │
                        │            links[], confidence, usage }   │
                        │  lib/explain.js · prompt.js · shape.js ·   │
                        │  gate.js · cache.js                        │
                        └───────────────▲──────────────────────────┘
                                        │
                              A. 自带 key 调模型（唯一可靠路径）
```

**缝本来就在**：`lib/*` 已经是一个无 UI 的纯函数库（key → cache → gate → prompt → shape），`client/*` 里只有 `view.js` 绑死宿主。分平台不需要改架构，只需要换"壳"。

**层 1 对外契约（= 现在 `explainer.explain()` 的入参与产物）**

| 入参 | 说明 |
|---|---|
| `phrase` ≤200 字 | 圈出来的文本 |
| `sentence` | 它所在整句（可选） |
| `context` | 前后几条对话拼成的文本（客户端已裁剪） |
| `mode` | `default｜rephrase｜example｜translate` |
| `fingerprint` | 对话指纹，缓存键的一部分 |

出参：`data.here / kind / literal / confidence`、`readings[] / evidence[] / links[]`、`cached / model / ms / usage`。

作为 MCP Server 暴露：**一个 tool + 一个 resource**
`explain_phrase(phrase, context, mode?) → JSON`；`knest://notebook → 已收藏条目（只读）`。

---

## 3. 层 1 的模型来源：两个选项

### 选项 A：服务端自带 key 调模型（现状）

| 维度 | 实情 |
|---|---|
| 用户成本 | 配一把模型 key（现有三路自动查找：配置 → 环境变量 → 凭据文件） |
| prompt 控制 | **完全可控**：system、JSON schema、四种模式都在我们手里 |
| 输出稳定性 | 高。实测：精简 836 / 换说法 573 / 举例 506 / 翻译 401 token，全部返回合法 JSON |
| 缓存 | 可按 `词+指纹+模式` 落盘，跨进程复用 |
| 平台限制 | 只要进程能出网就行；ChatGPT 侧还要求**公网 HTTPS 端点** |

### 选项 B：交给宿主模型（MCP Sampling）

| 维度 | 实情 |
|---|---|
| 用户成本 | 零配置，用宿主额度 |
| prompt 控制 | **基本失控**：只能给自然语言请求，宿主决定怎么答 |
| 输出稳定性 | 中低：非结构化，需要二次解析 |
| **可用性（致命）** | ① 规范里它是**可选客户端能力**，宿主不实现就没有；② 本次调查的五个平台，**没有任何一家的官方文档承诺支持**；③ 更关键：**Sampling 已被 SEP-2577 正式弃用（Final）**，官方理由是采用率低，宽限期后可能移除 |

**结论：选项 A 为唯一主路径，B 不作为路线。**
B 的唯一价值是「不想配 key 的用户」的兜底，而这条兜底今天在五个平台上都不可验证——把产品架在一个「已弃用且无人实现」的能力上，等于把可用性押在不确定项上。保留一个**适配钩子**（若某宿主将来声明支持，再接线）即可，不写进承诺。

> 补充：这条结论来自一手来源，不是偏好。见 `MULTI-PLATFORM-RESEARCH.md` §F（含 spec 与 SEP 链接）。

---

## 4. 层 2 的模块搬运矩阵

按源码实测的依赖面分档（DOM 依赖数 / DSH 依赖数）：

| 档 | 模块 | DOM | DSH | 搬走要做什么 |
|---|---|---|---|---|
| **原样搬** | `util` `phrase` `transcript` `layout` `card` `actions` `config` `store` `api` | 0 | 0 | 只改 `api.js` 的 `EXPLAIN_ENDPOINT` 一个常量 |
| **原样搬** | `window`(16) `menu`(14) `styles`(12) `selector`(8) `switch`(8) `painter`(3) | 中 | **0** | 纯标准浏览器 API，一行不用改 |
| **改一处** | `theme`(23) | 高 | 2 | 只读宿主令牌 `--dsw-alias-bg-base`，换成目标宿主的主题来源 |
| **重写** | `view`(5) | 低 | **16** | 槽位注册 / `ctx.get('sessions')` / `eventSource` 契约 / `ctx.on('dispose')` 全在这一个文件 |

依赖图印证：`window / menu / painter / selector / styles / switch / theme` **不 import 任何同目录模块**；`view.js` 是唯一中枢。所以「换壳」= 重写 `view.js`。

**降级形态**（不能注入 DOM 的平台）：选中文字 → 调用 MCP tool → 结果以文本块 / MCP App 卡片返回。
丢掉的体验：绿色高亮、右键拖选、可拖拽窗口、会话地图——这四项都依赖「能拿到宿主正文的 DOM」。

---

## 5. 每个平台的适配路径

| 平台 | 路径 | 依据与理由 |
|---|---|---|
| **Claude Desktop** | **仅核心能力（首选落地）** | MCPB 单文件、stdio、离线、无需公网。用户装一个 `.mcpb` 就能用；层 2 无官方 JS 入口、MCP App 在沙盒 iframe 里碰不到正文 → 不做 |
| **Cherry Studio** | **核心能力 + 轻度美化** | MCP 支持 stdio/SSE/HTTP，且能直接导入 DXT/MCPB 包；官方**只有自定义 CSS** → 可做「解释卡样式」「高亮配色」，但**做不了圈选手势**。若坚持层 2，只能走非官方注入，不建议 |
| **ChatGPT** | **仅核心能力，且门槛最高** | 自定义 MCP 只收**公网 HTTPS 端点**或 Secure MCP Tunnel，本地 stdio 不行；完整 MCP 只在 Business/Enterprise/Edu（Pro 仅 read/fetch）；App UI 在沙盒 iframe，无法碰正文 |
| **WorkBuddy** | **待验证后再说** | 确认支持「自定义 MCP 服务」，但**传输类型官方未写**；DOM 注入无任何说明。建议先做一个最小 MCP server 实测连接，再谈适配 |
| **千问** | **平台侧可行，消费端待验证** | 千问AI平台「自定义 MCP」明确支持 SSE + Streamable HTTP，但**云托管、不能访问本地资源**；百炼 `server_protocol` 当前只支持 `sse`；Qwen Chat 桌面端是否支持 MCP 只有二手说法 → 待验证 |

**层 2 的现实**：本次调查的五个平台，官方能力**全部止步于层 1**。若将来要恢复完整交互，可行载体只有两类，且都等于「自己做壳」：浏览器扩展（content script 可注入任意页面）或自建 Electron 客户端。这是另一个产品决策，不在本方案内。

---

## 6. 已核实 / 待验证清单

**已核实**
- Cherry Studio 是 Electron 45 应用（仓库 `package.json`）；官方支持自定义 CSS 注入 `<head>`；MCP 支持 stdio/SSE/可流式 HTTP，可导入 DXT/MCPB。
- Cherry Studio **没有**自定义 JS 注入的官方入口（官方文档只讲 CSS；官方文档问答亦答复未说明支持）。
- WorkBuddy 是腾讯的桌面端 AI 工作台，官方文档确认「连接器 = MCP + CLI」并支持自定义 MCP 服务；开发者平台 `open.workbuddy.cn`。
- ChatGPT 可接自定义 MCP Server（Plugins → Add custom MCP server），但**仅远程 + 仅 Web**，完整支持限 Business/Enterprise/Edu，Pro 仅 read/fetch。
- MCP Apps 的 UI **运行在 host 控制的沙盒 iframe**，规范明确禁止访问父页面 DOM / cookie / localStorage，只能 `postMessage`。
- `.mcpb`（原 `.dxt`）是 zip + `manifest.json`，stdio 传输，Claude for macOS/Windows 用其单文件安装。
- MCP Sampling 是 client capability，**已被 SEP-2577 正式弃用**。
- 本机未安装任何这五个客户端（安装目录与开始菜单均无），无法做本地实测。

**待验证**
- Qwen Chat 桌面版是否支持 MCP（仅二手来源）。
- WorkBuddy 的 MCP 传输类型（stdio？SSE？）。
- Cherry Studio 消息正文的 DOM 结构（同 document 已间接证明，节点组织未知）。

**无法确认**
- Cherry Studio / WorkBuddy / 千问 能否圈选对话正文。
- 任何平台是否实现 MCP Sampling。
- OpenAI Apps SDK 自有 CSP 字段（`openai/widgetCSP`）：`developers.openai.com` / `platform.openai.com` 在本机被 Cloudflare 403，改用 MCP Apps 规范 + Help Center 交叉；该列为「规范层已核实，OpenAI 专有字段无法确认」。
- MCPB `manifest.json` 逐字段的必填性：只核实到字段族与「manifest.json 是唯一必需文件」，MANIFEST.md 全文未逐条读（`raw.githubusercontent.com` 本机 DNS 不通）。
- Cherry Studio 消息区是否**同一 document**：官方零说明，只能由「自定义 CSS 能改 `--chat-user` 气泡背景」间接推断，需运行时实测。

---

## 7. 风险与未决问题

1. **层 2 无处安放**：五个平台都没有官方 JS 注入。这是本次调查最硬的结论，也是「多平台」这个目标最大的天花板。
2. **DOM 契约不稳定**：即便将来某个 Electron 壳允许注入，流式输出会重建节点；现有实现靠「Range 失效后按文本重解析」应对，换宿主必须重新验证。
3. **分发半径不同**：Claude 是单文件本地包（最好发），ChatGPT 要公网端点 + 企业套餐（最难发），Cherry Studio 走 MCP 配置（中等）。
4. **两份 key 的心智负担**：A 方案要求用户为插件单独配 key；DSH 用户已接受这个前提，换平台要重新说服。
5. **缓存与隐私**：对话片段进入 `context` 发给模型服务；跨平台时每个宿主都要说清楚。
6. **MCPB 目录已变**：桌面扩展的目录收录已废弃，要进目录需把本地 server 包进 plugin——影响分发策略。

---

## 8. 下一步（等你拍板，不写代码）

- [x] **模型来源**：按第 3 节，A（自带 key）为唯一主路径；B 只留钩子。**若你不同意，这里需要你推翻。**
- [ ] **首批平台**：建议 **Claude Desktop**（MCPB 最好发、本地 stdio 最省事），其次 Cherry Studio。
- [ ] **层 1 的交付形态**：独立 MCP Server（stdio 可执行 + MCPB 打包）／纯 npm 库（给别人自己接）。
- [ ] **层 2 是否彻底冻结**：五个平台都做不了；要么接受「只交付层 1」，要么另立项做浏览器扩展/自建壳。
- [ ] WorkBuddy 与 Qwen：要不要各花半天做「最小 MCP 连接探针」（只回一句话），把「待验证」变成结论。

