# 五个 AI 聊天客户端的扩展能力调查报告

调查时间：2026-11-06（Asia/Shanghai）。方法：只读核实，只采信一手来源（官方文档 / 官方仓库 / MCP 规范）；二手内容仅作线索并标「待验证」。凡官方文档未写明者一律写「无法确认」，不做推测。

---

## 一、平台 × 能力表

| 平台 | 能否注入 DOM 脚本/样式 | MCP 支持（传输） | 官方扩展机制 | 能否在对话正文上圈选高亮 | 置信度 |
|---|---|---|---|---|---|
| **Cherry Studio** | **样式：官方支持**（自定义 CSS，注入每个窗口 `<head>`，元素 `<style id="user-defined-custom-css">`）；**脚本：无官方入口**（文档明确只讲 CSS） | 是：**stdio（本地命令）+ SSE + 可流式 HTTP**；UI 或 JSON 导入配置 | MCP 服务器（含内置服务器 / 服务市场）、技能、**生成式小程序 `.miniapp`（独立沙盒 Web 应用，可调 `window.cherry`）** | **无法确认**：文档未给消息正文 DOM 结构/选择器，未声明选择事件接口 | CSS / MCP / 小程序 = **已核实**；DOM 圈选 = **无法确认** |
| **WorkBuddy（腾讯）** | **无法确认**：官方文档无自定义 CSS/JS/脚本注入说明 | 是：**连接器 = MCP + CLI**；支持「自定义连接器」安装自定义 MCP 服务；**具体传输类型文档未写** | 连接器、技能、专家、**Buddy 应用**、小程序；开发者走开放平台 `open.workbuddy.cn` 提交审核 | **无法确认** | 产品形态 / 连接器 / 开放平台 = **已核实**；传输与注入 = **无法确认** |
| **ChatGPT** | **否**：无任何官方注入点；Apps SDK 的 UI 跑在**沙盒 iframe** 内，规范层明确不能访问父页面 DOM | 是：**仅远程 MCP（HTTPS 端点）+ Secure MCP Tunnel**；**不能直连本地 stdio** | Apps SDK（MCP + UI）、Plugins/Connectors、目录提交；Business / Enterprise / Edu 可自建，Pro 仅 read/fetch | **否**（无官方 API / 注入点） | **已核实**（OpenAI Help Center）；iframe 细节来自 MCP Apps 规范 = **已核实（规范层）** |
| **Claude** | **否**：无自定义 CSS/JS 入口；MCP App 同样在沙盒 iframe（独立域名 `*.claudemcpcontent.com`） | 是：**stdio**（`claude_desktop_config.json` / `.mcpb` 本地扩展）+ **远程 HTTPS connector** | **MCPB（原 DXT）单文件安装包**、Plugins、MCP Apps、目录 | **否**（无官方 API / 注入点） | **已核实** |
| **千问（Qwen）** | **消费端：无法确认**（Qwen Chat 无官方注入说明）；**Qwen Code 有官方插件体系但非 DOM 注入** | 有，且分三条线：百炼 Responses API（**SSE**）、**千问AI平台**（商店 MCP / 自定义 MCP，**SSE + streamableHttp**，npx/uvx 部署）、Qwen Code（MCP 客户端） | **Managed Agent + MCP 商店/自定义 MCP + Skill 市场 + Sandbox**；Qwen Code：**Channel 插件 / Agent 插件 / 实验性 Mods / MCP** | **无法确认** | 平台侧 = **已核实**；Qwen Chat 桌面端 MCP = **待验证** |

---

## 二、逐平台详情

### A. Cherry Studio

**A1. 是不是 Electron？版本 / 仓库**
是 Electron 应用。官方仓库 `CherryHQ/cherry-studio`（AGPL-3.0，TypeScript，默认分支 main），仓库 `package.json` 中 `"electron": "45.2.2"`、`electron-vite`、`main: ./out/main/main.js`，版本号 `2.1.10`。[仓库](https://github.com/CherryHQ/cherry-studio) · [package.json](https://github.com/CherryHQ/cherry-studio/blob/main/package.json) · [最新 Release v2.1.10](https://github.com/CherryHQ/cherry-studio/releases/tag/v2.1.10) → **已核实**
文档体系已进入 V2（有 V1→V2 迁移、破坏性更新说明）。[功能差异](https://docs.cherryai.com.cn/cherry-studio/installation/v1-v2-feature-differences.md) → **已核实**

**A2. 能否向主窗口注入自定义脚本/样式？有无官方入口？**
- **样式：能，且是官方功能。** 路径【设置】→【外观】→「自定义 CSS」；写入的 CSS「会原样注入到每个窗口的 `<head>` 里面，对应一个 `<style id="user-defined-custom-css">` 元素」，且因不属内部 cascade layer，同等选择器下优先级高于自带样式。[自定义 CSS](https://docs.cherryai.com.cn/pre-basic/settings/display/custom-css.md) → **已核实**
- **脚本：无官方入口。** 官方文档只提供 CSS；小程序文档明确「它不是注入主窗口的插件」；就「是否支持自定义 JS 注入」向官方文档站检索问答接口求证，答复为「文档未说明支持」。[自定义 CSS](https://docs.cherryai.com.cn/pre-basic/settings/display/custom-css.md) · [生成式小程序](https://docs.cherryai.com.cn/cherry-studio/preview/app/generative-mini-apps.md) · [官方文档问答](https://docs.cherryai.com.cn/index.md?ask=%E6%98%AF%E5%90%A6%E6%94%AF%E6%8C%81%E8%87%AA%E5%AE%9A%E4%B9%89JavaScript%E6%B3%A8%E5%85%A5) → **已核实（无该能力）**
- 无「预览版/夜间版专属 CSS/JS 通道」的官方说明 → **无法确认**。

**A3. 消息渲染区 DOM 是否可访问（同 document？iframe？）**
- 可直接证明的只有：CSS 注入目标是每个窗口的 `<head>`，且官方示例把 `--chat-user`（用户消息气泡背景）写在 `:root` 上并称可覆盖生效——说明**消息气泡元素与注入的 `<style>` 处在同一文档树**（跨 iframe 的 CSS 变量无法生效）。[自定义 CSS](https://docs.cherryai.com.cn/pre-basic/settings/display/custom-css.md) → **已核实（间接）**
- **没有任何官方 DOM 结构说明**；消息正文是否有 iframe 隔离、文字节点如何组织，文档均未描述；就「消息渲染区域是否在 iframe / 有无 DOM 结构说明」向官方文档站检索问答接口求证，答复为：**文档没有说明**是否位于 iframe，也没有提供正文的完整 DOM 结构。[官方文档问答](https://docs.cherryai.com.cn/index.md?ask=%E6%B6%88%E6%81%AF%E6%B8%B2%E6%9F%93%E5%8C%BA%E5%9F%9F%E6%98%AF%E5%90%A6%E5%9C%A8iframe%E4%B8%AD) → **无法确认**
- 可核实的源码位置（官方文档给出的样式源）：[`src/renderer/assets/styles`](https://github.com/CherryHQ/cherry-studio/tree/main/src/renderer/assets/styles)、[`packages/ui/src/styles`](https://github.com/CherryHQ/cherry-studio/tree/main/packages/ui/src/styles)。

**A4. MCP 支持**
- 传输：本地命令 → **stdio**；远程 → **SSE 或可流式传输的 HTTP**（官方原文「本地命令通常使用标准输入输出方式；远程服务通常提供 SSE 或可流式传输的 HTTP 地址」）。[MCP 与外部工具](https://docs.cherryai.com.cn/advanced-basic/extensions/mcp.md) → **已核实**
- 配置方式：**UI 为主**（【设置】→【MCP】→【MCP 服务器】→【添加】，支持「快速创建、从 JSON 导入、手动创建」），另可绑定给指定 Agent。[同页](https://docs.cherryai.com.cn/advanced-basic/extensions/mcp.md) → **已核实**
- MCP Apps / 可嵌入 UI：文档只列**工具、资源、提示词**三类能力，未见 MCP Apps/UI 支持说明。[同页](https://docs.cherryai.com.cn/advanced-basic/extensions/mcp.md) → **无法确认（未见支持）**

**A5. 官方插件/扩展机制（能改 UI 的非 MCP 机制）**
**生成式小程序（MiniApps）**：`.miniapp` 包（zip，含 `manifest.json` + 静态页面），安装后运行在**独立沙盒**，通过 `window.cherry` / `cherry.*` 调用 AI、存储、文件、通知、网络、剪贴板；不能直接用 `localStorage`、浏览器 `fetch`、Cookie、弹窗、外部 CDN；外部 CDN 会被沙盒阻止。[生成式小程序](https://docs.cherryai.com.cn/cherry-studio/preview/app/generative-mini-apps.md) · [小程序](https://docs.cherryai.com.cn/cherry-studio/preview/app.md) → **已核实**
小程序 UI 是**自己的窗口/沙盒**，不是注入主窗口——因此它能扩展界面，但**不能改写对话正文**。

---

### B. Work Buddy

**B1. 这到底是什么产品？**
是**腾讯出品的 WorkBuddy**（桌面端 AI 工作台 / Agent 客户端，不是网页版聊天）。官方简介：「WorkBuddy 是腾讯出品的全场景 AI 工作台」，可自主规划执行任务并交付文档/表格/PPT，支持本地文件操作、多任务并行。[WorkBuddy 简介](https://www.codebuddy.cn/docs/workbuddy/Overview) → **已核实**
- 客户端形态：有 Windows / macOS / 统信 UOS / 银河麒麟 安装指南，即**桌面客户端**（且覆盖国产 Linux 发行版）。[安装指南索引](https://www.codebuddy.cn/docs/workbuddy/Overview) → **已核实**
- 站点：`workbuddy.cn`（国内）、`workbuddy.ai`（海外版）；文档挂在 `codebuddy.cn/docs/workbuddy`。[官方站点](https://www.workbuddy.cn/) · [文档](https://www.codebuddy.cn/docs/workbuddy/Overview) → **已核实**
- 另有「WorkBuddy 移动端」「WorkBuddy 小程序」两个子文档站 → 多端产品线。→ **已核实**
- **公开 GitHub 仓库：未发现**（官方文档未指向任何开源仓库）→ **无法确认**

**B2. 插件 / 扩展 / API 文档**
- **连接器（Connectors）**：官方定义为「MCP + CLI（标准化协议）」或「Skill + CLI（内置脚本）」两种形态；内置 QQ 邮箱、腾讯文档、腾讯乐享、腾讯会议、TAPD、腾讯网盘等；**支持自定义连接器**——「安装自定义的 MCP 服务」，配置方式「与 MCP 配置类似」。[连接器](https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Connector) → **已核实**
- **开发者平台**：`open.workbuddy.cn`，可提交专家 / 技能 / 连接器 / **Buddy 应用**并走审核；通知渠道含端内消息与邮件。[Buddy 应用](https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Buddy-App) → **已核实**
- **技能（Skills）** 市场、**小程序 / 网站应用开发与发布**、云服务等页面均在官方文档树中。[文档导航](https://www.codebuddy.cn/docs/workbuddy/Overview) → **已核实**
- **MCP 具体传输类型（stdio / SSE / streamable HTTP）**：官方页面未写，只写「自定义连接器的配置方式与 MCP 配置类似」并外链到 CodeBuddy IDE 的 MCP 文档 → **无法确认**
- **能否注入脚本/样式改主界面**：无任何官方说明 → **无法确认**

**B3. 搜索记录（证明找过）**
- 关键词：`Work Buddy AI 聊天客户端 桌面端`、`Work Buddy AI chat app official site`、`WorkBuddy AI assistant app plugin extension`、`WorkBuddy 连接器 MCP`。
- 结果：定位到腾讯 WorkBuddy 官方站与官方文档（`codebuddy.cn/docs/workbuddy`），据此完成 B1/B2；**未找到**官方关于 DOM 注入、自定义 CSS、MCP 传输类型的说明，也未找到公开仓库 → 相关项标 **无法确认**。
- 注意歧义：仅凭「Work Buddy」字样也可能指其他同名小产品；本报告结论只对**腾讯 WorkBuddy** 成立。

---

### C. ChatGPT

**C1. 自定义 MCP Server（Developer mode / Connectors）现状**
- 能接**自定义** MCP Server：在 **Plugins** 页 → 「+」→ **Add custom MCP server** → 填公网 **HTTPS MCP 端点**（或选 **Tunnel**，用 Secure MCP Tunnel 的 `tunnel_id`）→ 配鉴权 → 确认风险提示 → 「Create as a plugin」。**当前流程不再需要先开 Developer Mode**。[Connecting custom MCP servers in ChatGPT](https://help.openai.com/en/articles/12584461) → **已核实**
- 套餐/客户端边界：完整 MCP 支持 = **Business 与 Enterprise/Edu**，且**仅 ChatGPT web**；Business 只有 **admin/owner** 能创建与发布；Enterprise/Edu 可用 RBAC 授权成员创建、仅 admin/owner 发布；**Pro 用户能连自定义 MCP，但只有 read/fetch 权限**；**移动端不支持**连接自定义 MCP。[同页](https://help.openai.com/en/articles/12584461) → **已核实**
- **不能直连本地 MCP server**（「Not directly… ChatGPT connects to remote MCP servers」），私有网络需 Secure MCP Tunnel。[同页](https://help.openai.com/en/articles/12584461) → **已核实**
- 工具快照冻结、需管理员刷新；Deep research 只能用 read/fetch。[同页](https://help.openai.com/en/articles/12584461) → **已核实**
- Apps SDK（预览）：基于 MCP 的开发者工具包，可同时定义「对话逻辑 + 界面」；开源。[Building with the Apps SDK](https://help.openai.com/en/articles/12515353) → **已核实**

**C2. MCP Apps（Apps SDK / apps-sdk-ui）的 UI 沙箱：iframe？CSP？能否访问父页面 DOM？**
- 规范层（MCP Apps 官方扩展）：UI 以 **HTML 资源**（`ui://`）由 host 取回，**渲染在 host 控制的沙盒 iframe** 中；「The sandbox prevents your app from accessing the parent window's DOM, reading the host's cookies or local storage, navigating the parent page, or executing scripts in the parent context」；**所有通信只走 `postMessage`**；外部资源只能从 `_meta.ui.csp` 声明的来源加载（另有 `permissions` 申请麦克风/摄像头等）。[MCP Apps 概览](https://modelcontextprotocol.io/extensions/apps/overview) → **已核实（规范层）**
- OpenAI 侧：官方 Help Center 只说「MCP apps add an interactive interface to those tools」，未公开 CSP 字段细节；`developers.openai.com` 与 `platform.openai.com` 在本机被 Cloudflare 拦截（403），无法读取 Apps SDK 一手页面 → **Apps SDK 自有 CSP 字段：无法确认**
- 交叉证据：MCP 官方提供「Migrate from the OpenAI Apps SDK」指南，说明 ChatGPT 的 App UI 与 MCP Apps 是同一类「iframe + 宿主桥接」模型。
- **结论：iframe 内不能访问父页面 DOM**（规范强制隔离） → **已核实**

**C3. 能否在对话正文上做高亮/圈选？**
- 没有任何官方 API 或注入点可操作 ChatGPT 的对话正文；App 只能在自身上下文内的 iframe 里渲染自己的 UI，且规范禁止访问父页面 → **否** → **已核实（无该能力）**

---

### D. Claude

**D1. MCP 连接器打包规范：`.mcpb` 与 `.dxt` 的关系、manifest 必填字段、打包分发**
- **同一个东西改名**：官方仓库顶部「IMPORTANT NOTICE: This project is being renamed from DXT (Desktop Extensions) to MCPB (MCP Bundles)」；`dxt` CLI → `mcpb` CLI；`.dxt` 文件 → `.mcpb` 文件；`@anthropic-ai/dxt` 包 → `@anthropic-ai/mcpb`。（仓库已迁到 `modelcontextprotocol/mcpb`）[mcpb README](https://github.com/modelcontextprotocol/mcpb) → **已核实**
- 形态：`.mcpb` = zip，内含**本地 MCP server + `manifest.json`**，类比 `.crx` / `.vsix`；**`manifest.json` 是唯一必需文件**；Claude for macOS/Windows 用该仓库代码实现单击安装。[mcpb README](https://github.com/modelcontextprotocol/mcpb) → **已核实**
- 传输：MCPB 内的 server **走 stdio**、离线可用、无需 OAuth；远程连接器走 HTTPS。[Build a desktop extension with MCPB](https://claude.com/docs/connectors/building/mcpb) → **已核实**
- 打包分发：`npm i -g @anthropic-ai/mcpb` → `mcpb init`（生成 manifest）→ `mcpb pack` → 双击 `.mcpb` 安装；也可拖入窗口或 Settings → Extensions → Advanced settings → Install Extension…；**安装是 per-user**。Node.js 语言优先（macOS/Windows 版 Claude 自带运行时）；`compatibility` 段声明平台。[同页](https://claude.com/docs/connectors/building/mcpb) → **已核实**
- **清单字段**：官方权威是 [MANIFEST.md](https://github.com/modelcontextprotocol/mcpb/blob/main/MANIFEST.md)（「full schema with all fields」）；官方文档确认含 `manifest_version`、`name`、`version`、`description`、`author`、`server`（含 `server.type` = `node`/`python`/`uv`/`binary`、`server.entry_point`、`mcp_config.env`）、`compatibility`、可选 `icon`、`user_config`（自动生成设置界面）。[MCPB 文档](https://claude.com/docs/connectors/building/mcpb) · [README](https://github.com/modelcontextprotocol/mcpb) → 字段族 **已核实**；逐字段「必填/可选」的完整判定需查 MANIFEST.md 原文 → **部分无法确认**
- **目录分发已变**：桌面扩展的目录收录**已废弃**，目录不再接受 MCPB 提交；要进目录需把本地 server 包进 **plugin**。[同页](https://claude.com/docs/connectors/building/mcpb) → **已核实**

**D2. MCP Apps 沙箱限制**
- 与 C2 同一规范：沙盒 iframe、不能访问父 DOM / cookies / localStorage、只能 `postMessage`、外部资源受 `_meta.ui.csp` 限制。[MCP Apps 概览](https://modelcontextprotocol.io/extensions/apps/overview) → **已核实**
- Claude 特有实现细节：App 由**独立沙盒源**提供——`_meta.ui.domain` 必须等于「server URL 的 SHA-256 前 32 位十六进制 + `.claudemcpcontent.com`」，否则报 `Invalid ui.domain format` / `ui.domain mismatch`。[Get started with MCP Apps](https://claude.com/docs/connectors/building/mcp-apps/getting-started) → **已核实**
- Claude Desktop 本地连接方式：Settings → Developer → Edit Config → 写 `claude_desktop_config.json`（`mcpServers` → `command`/`args`），重启生效。[同页](https://claude.com/docs/connectors/building/mcp-apps/getting-started) → **已核实**

**D3. 能否在对话正文上高亮/圈选？**
- 无官方 API、无注入点；MCP App 只能在自己的 iframe 内画 UI，且被禁止访问父页面 DOM → **否** → **已核实（无该能力）**

---

### E. 千问（Qwen / 通义千问）

**E1. 官方扩展机制（分三条独立产品线，别混为一谈）**
1. **千问AI平台（platform.qianwenai.com，Agent 侧）**：MCP 分「商店 MCP」（One Key Service，用平台 API Key 直接调）与「**自定义 MCP**」（部署自有/开源 MCP，npx / uvx / 已有远程 SSE）；用法两种——**挂载到 Managed Agent**（`mcp_servers` 字段）或**在 MCP 客户端/SDK 中调用**（每个服务提供 **Streamable HTTP** 地址）。[MCP 简介](https://platform.qianwenai.com/docs/agent-infra/mcp/introduction) → **已核实**
   - 传输与限制：`type` 与路径必须匹配（`sse`→`/sse`，`streamableHttp`→`/mcp`）；托管在**函数计算 FC**，**不能访问用户本地资源**；私有 npm 仓库不支持。[MCP 常见问题](https://platform.qianwenai.com/docs/agent-infra/mcp/faq) → **已核实**
   - 另有 **Skill（技能市场 / 发布管理）** 与 **Sandbox** 两条扩展线在官方文档树中。[文档导航](https://platform.qianwenai.com/docs/agent-infra/mcp/introduction) → **已核实**
2. **阿里云百炼 / 千问模型 API（模型侧）**：通过 **Responses API** 的 `tools` 传 `type: "mcp"`，`server_protocol` **当前仅支持 `"sse"`**，最多 10 个 MCP Server；`server_url`/`headers` 必填；**不能访问本地资源**（云托管）。[百炼 MCP](https://help.aliyun.com/zh/model-studio/mcp) → **已核实**
3. **Qwen Code（CLI/Agent 侧，qwenlm.github.io）**：官方扩展体系含 **MCP**（`/users/features/mcp/`）、**扩展 → Agent 插件 / 实验性 Mods**、**开发者 → Channel 插件**（Telegram / 微信 / 钉钉 / 企业微信 / 飞书 / QQ 机器人 / GitHub / GitLab / Email 等频道）。[Qwen Code 文档](https://qwenlm.github.io/qwen-code-docs/zh/developers/channel-plugins/) · [MCP 章节](https://qwenlm.github.io/qwen-code-docs/zh/users/features/mcp/) → **已核实（目录与章节存在）**
- 开放平台 API：百炼模型 API、千问AI平台 API（Key 统一鉴权 `DASHSCOPE_API_KEY`）均已公开。[百炼 MCP](https://help.aliyun.com/zh/model-studio/mcp) · [MCP 简介](https://platform.qianwenai.com/docs/agent-infra/mcp/introduction) → **已核实**

**E2. 桌面端还是 Web？有没有能注入脚本的官方途径？**
- 形态：**两条都成立且互不等同** —— ① 消费端 Qwen Chat 有 Web 版与桌面版客户端；② Qwen Code 是 CLI/终端 Agent（另有 VS Code / Zed / JetBrains 集成文档）。[Qwen Code 文档导航](https://qwenlm.github.io/qwen-code-docs/zh/developers/channel-plugins/) → **已核实（Qwen Code 侧）**
- **Qwen Chat 桌面版是否支持 MCP / 插件**：只在二手博客见到「Qwen Chat 桌面版支持 MCP」的说法，官方站点与官方文档未给出对应说明页 → **待验证**（线索：[CSDN 文章](https://blog.csdn.net/weixin_40774379/article/details/149321197)，不可作为结论）
- **用户脚本 / 自定义 CSS / 改主界面插件**：三家官方文档（qwen.ai 系、百炼、千问AI平台、Qwen Code）均未见任何「向客户端注入 CSS/JS」的官方途径 → **无法确认（未见官方入口）**

**E3. 有没有 MCP 支持的公开说明？**
有，且是官方的：见 E1 三个链接（千问AI平台 MCP 简介/FAQ、百炼 MCP、Qwen Code MCP 章节）。→ **已核实**

---

### F. 追加问题：MCP Sampling（`sampling/createMessage`）现状

| 对象 | 结论 | 依据 / 置信度 |
|---|---|---|
| **规范原文** | Sampling 是**客户端能力（client capability）**：支持者**MUST** 在 initialize 时声明 `capabilities: { sampling: {} }`；服务器发 `sampling/createMessage` 请求宿主出词；规范强调 **必须有人类在环**（可审阅/编辑/拒绝），并给出 `modelPreferences`（hints + cost/speed/intelligence 优先级）；核心卖点原文即「**no server API keys necessary**」 | [Spec: Sampling (2025-06-18)](https://modelcontextprotocol.io/specification/2025-06-18/client/sampling) → **已核实** |
| **规范趋势（关键）** | **Sampling 已被 SEP-2577 正式弃用（Final, Standards Track）**，与 Roots、Logging 一同deprecate；理由是「复杂性高 + **客户端采用率低**」（自 2024-11 规范起就存在却少有人实现），且服务器可直接对接各家 LLM API 作为替代；弃用期线级行为不变，宽限期后**可能移除**。同 SEP 指出 Sampling 是三者中安全风险最高的（prompt injection / 数据外泄面） | [SEP-2577](https://modelcontextprotocol.io/seps/2577-deprecate-roots-sampling-and-logging) → **已核实** |
| **Claude 桌面端 / Claude Code** | **无法确认**：claude.com 的 MCP/MCPB/MCP Apps 文档只描述 tools / resources / prompts、connectors、MCP Apps，**未声明**支持 server 发起的 sampling，也未声明不支持。可确定的是 Claude 侧 MCP 主路径是「工具调用」 | [Build a desktop extension](https://claude.com/docs/connectors/building/mcpb) · [MCP Apps](https://claude.com/docs/connectors/building/mcp-apps/getting-started) → **无法确认** |
| **ChatGPT（Apps SDK / Connectors）** | **无法确认 / 未见声明**：官方 Help Center 对自定义 MCP 的能力描述集中在 tools（含 read/fetch/write）、resources、prompts、MCP App UI；**未提及 sampling**；OpenAI 开发者文档站在本机 403 无法读取 | [Connecting custom MCP servers](https://help.openai.com/en/articles/12584461) · [Apps SDK](https://help.openai.com/en/articles/12515353) → **无法确认** |
| **Cherry Studio** | **无法确认（文档未声明支持）**：官方 MCP 文档列出的能力是「工具、资源、提示词」，未提 server 向宿主请求出词；官方文档侧答复同样是「文档没有确认支持 Sampling」 | [MCP 与外部工具](https://docs.cherryai.com.cn/advanced-basic/extensions/mcp.md) · [官方文档问答](https://docs.cherryai.com.cn/index.md?ask=Cherry%20Studio%20%E6%98%AF%E5%90%A6%E6%94%AF%E6%8C%81MCP%20Sampling) → **已核实（文档未声明）** |
| **千问系** | **无法确认**：千问AI平台 MCP 文档只讲工具挂载与外部调用；百炼 Responses API 的 `mcp` 工具只讲 server 侧工具；均未提 sampling | [MCP 简介](https://platform.qianwenai.com/docs/agent-infra/mcp/introduction) · [百炼 MCP](https://help.aliyun.com/zh/model-studio/mcp) → **无法确认** |

**给决策层的直白结论：不要把 MCP Sampling 当作「层 1 免自带 Key」的通道。** 理由三条，均为一手依据：① 规范里它是**可选客户端能力**，未实现即不可用（[spec](https://modelcontextprotocol.io/specification/2025-06-18/client/sampling)）；② 五个平台**没有任何一家在官方文档中承诺支持** sampling；③ 该能力**已被 SEP-2577 弃用**，官方理由是采用率低、且后续版本可能移除（[SEP-2577](https://modelcontextprotocol.io/seps/2577-deprecate-roots-sampling-and-logging)）。→ 层 1 应默认**自带 Key 直连模型 API**，把 sampling 视为「即便命中也不能依赖」的加分项。

---

## 三、来源清单

### 1. 官方文档
**Cherry Studio（GitBook，官方）**
- https://docs.cherryai.com.cn/llms.txt （文档总索引）
- https://docs.cherryai.com.cn/pre-basic/settings/display/custom-css.md
- https://docs.cherryai.com.cn/advanced-basic/extensions/mcp.md
- https://docs.cherryai.com.cn/cherry-studio/preview/app/generative-mini-apps.md
- https://docs.cherryai.com.cn/cherry-studio/preview/app.md
- https://docs.cherryai.com.cn/cherry-studio/installation/v1-v2-feature-differences.md

**OpenAI**
- https://help.openai.com/en/articles/12584461 （Connecting custom MCP servers in ChatGPT）
- https://help.openai.com/en/articles/12515353 （Building with the Apps SDK）

**Anthropic / Claude**
- https://claude.com/docs/connectors/building/mcpb
- https://claude.com/docs/connectors/building/mcp-apps/getting-started
- https://claude.com/docs/llms.txt （文档索引）

**千问 / 阿里云 / Qwen Code**
- https://platform.qianwenai.com/docs/agent-infra/mcp/introduction
- https://platform.qianwenai.com/docs/agent-infra/mcp/faq
- https://help.aliyun.com/zh/model-studio/mcp
- https://qwenlm.github.io/qwen-code-docs/zh/users/features/mcp/
- https://qwenlm.github.io/qwen-code-docs/zh/developers/channel-plugins/

**腾讯 WorkBuddy**
- https://www.codebuddy.cn/docs/workbuddy/Overview
- https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Connector
- https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Buddy-App
- https://www.workbuddy.cn/ （官方站点）

### 2. 官方仓库
- https://github.com/CherryHQ/cherry-studio
- https://github.com/CherryHQ/cherry-studio/blob/main/package.json
- https://github.com/CherryHQ/cherry-studio/releases/tag/v2.1.10
- https://github.com/modelcontextprotocol/mcpb （原 anthropics/mcpb；MCPB 规范 + CLI）
- https://github.com/modelcontextprotocol/mcpb/blob/main/MANIFEST.md （manifest 全字段 schema）
- https://github.com/modelcontextprotocol/ext-apps （MCP Apps SDK / 示例）

### 3. 规范（modelcontextprotocol.io）
- https://modelcontextprotocol.io/specification/2025-06-18/client/sampling （Sampling 是 client capability）
- https://modelcontextprotocol.io/seps/2577-deprecate-roots-sampling-and-logging （Sampling 已弃用，Final）
- https://modelcontextprotocol.io/extensions/apps/overview （MCP Apps：沙盒 iframe / 禁止访问父 DOM / `_meta.ui.csp`）
- https://modelcontextprotocol.io/extensions/client-matrix （扩展支持矩阵；本报告核对时各客户端列为空白，未据此下结论）
- https://modelcontextprotocol.io/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp （MCP Apps SEP）

### 4. 其他（仅线索，未作结论）
- https://blog.csdn.net/weixin_40774379/article/details/149321197 —— 声称「Qwen Chat 桌面版支持 MCP」，**待验证**
- https://www.workbuddy.ai/ —— WorkBuddy 海外版站点（品牌归属的旁证）

### 未能核实的原因（如实记录）
- `developers.openai.com`、`platform.openai.com` 在本机被 Cloudflare 403 拦截，Apps SDK 的 iframe/CSP 字段细节未能读到一手页面，改用 MCP Apps 官方规范 + OpenAI Help Center。
- `raw.githubusercontent.com` DNS 不可达，仓库文件改走 GitHub REST API 读取。
- Cherry Studio 的 DOM 结构、WorkBuddy 的 MCP 传输类型、Qwen Chat 桌面端 MCP：官方文档均未覆盖，按规则写「无法确认」。
