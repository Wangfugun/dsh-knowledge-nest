# 圈词 · 项目全貌

> 最后更新：2026-11-06（v2 画布版）
> 位置：`default-workspace/knest-v2/`　｜　部署：`~/.dsh/profiles/desktop/node_modules/dsh-knowledge-nest/`
> 本文是**唯一的功能与原理底账**。改功能前先读它，改完回来更新它。

---

## 0. 一句话

在 DeepSeek Harness 的对话里**按住右键拖过一个词**，它变绿，host 把「这个词 + 前后几句对话」发给 DeepSeek，问清楚**它在这一整段对话里到底指什么**；答案落在一张无限画布上，可以顺着卡片里的词一路展开成一棵知识树。

三条底线：

1. **只解释语境，不做百科**——不查词表、不联网；
2. **网络请求只有一条**：host 路由 → DeepSeek API；
3. **不改宿主 DOM**：上色用 CSS Custom Highlight，画布是覆盖层。

---

## 1. 功能清单（用户视角）

| 能力 | 怎么触发 | 结果 | 成本 |
|---|---|---|---|
| **圈词** | 在对话区按住**右键**拖过文字，松手 | 文字变绿，画布上出现一张解释卡 | 约 800 token（首次） |
| **整句兜底** | 右键单击不放、不拖 | 取指针所在那一整句 | 同上 |
| **解释卡** | 自动 | 语境释义 → 依据（逐字引用）→ 可展开词 → token 用量 | — |
| **知识树** | 点卡片里的词（`card.tree` 的 label） | 生成子节点，父子之间连一条贝塞尔曲线 | 每层一次请求 |
| **层级上限** | — | 最多 4 层（根 = 第 1 层），到顶的词置灰不可点 | — |
| **移动 / 平移 / 缩放** | 拖标题栏 / `Alt`+拖 / `Ctrl`+滚轮 | 节点自由摆放，连线实时重算 | 0 |
| **折叠 / 关闭** | 卡片 `—` / `×` | `×` 连同所有后代一起删 | 0 |
| **收起画布** | `Esc` 或「全部关闭」 | 清空画布并隐藏覆盖层 | 0 |
| **变体追问** | 右键菜单：换个说法 / 举例 / 翻译 | 挂成当前根节点下的子节点 | 约 500 token |
| **同领域标橙** | 右键菜单「标出同领域」 | 把**对话正文里**同 domain 的词染橙（CSS Highlight 第二条） | 0 |
| **圈词本** | 右键菜单「收进圈词本」 | 存进本地笔记本，可导出 Markdown | 0 |
| **开关** | 右侧竖牌 / `Alt+Q` | 关掉后右键改为弹菜单（复制/查询/…） | 0 |
| **文件读取通道** | `GET /knowledge-nest/read?path=…` | 读工作区内文本文件（≤1MB，白名单后缀） | 0 |
| **MCP 工具** | 任意 MCP 客户端调 `knowledge_nest_explain` | 纯文本进出，无 UI | 同上 |

---

## 2. 应用场景

1. **读陌生代码**：圈 `pointer-events:none`、圈 `DALS`、圈一个函数名 → 得到"在这段对话里它是什么"，而不是词典义。
2. **追术语链**：`pointer-events:none` → `CSS 属性` → …… 一层层展开成树，比翻文档快。
3. **确认自己理解对不对**：卡片会给出**依据**（逐字引用原文），能对着原文核对。
4. **写稿/写方案时对齐说法**：同一个词在讨论里漂移时，圈一次看它现在指什么。
5. **复习**：圈词本 + 知识树 = 一次会话里所有被问过的词，回头看。
6. **把解释能力搬去别处**：`packages/mcp-server` 让 Claude Desktop / Cherry Studio 之类也能调同一个工具（只有文本，没有卡片）。

---

## 3. 数据流

```
右键拖选
  └─ client/selector.js        caretRangeFromPoint → Range → 文本
      └─ view.js pickPhrase()  归一化、上绿（painter）、记账（store）、开问
          └─ runExplain()
              ├─ transcript.js buildContext()  取命中消息前后窗口 → {context, fingerprint}
              ├─ card.js     parentContextOf()  如果是从卡片展开，拼上【上级概念】
              ├─ api.js      POST /knowledge-nest/explain
              │   └─ index.js 路由 → lib/explain.js
              │        ├─ lib/cache.js  命中? → 直接返回
              │        ├─ lib/gate.js   并发闸门（3 路、单飞、250ms 间隔）
              │        ├─ lib/key.js    配置 → 环境变量 → ~/.dsh/.credentials.yaml
              │        └─ lib/prompt.js + shape.js  拼请求 / 收敛 JSON
              └─ tree-board.js  openRoot / addChild → 画节点、连贝塞尔曲线
```

---

## 4. 模块地图

### 宿主侧

| 文件 | 职责 | 关键点 |
|---|---|---|
| `index.js` | 插件入口，注册两条路由 | `inject: ['webServer','fs']`；`safeService()` 取服务（cordis 代理访问未注入属性会抛）；`routeState` / `diagState` 诊断字段挂在 `GET /explain` |
| `lib/explain.js` | 编排：缓存→闸门→出网→收敛 | `createExplainer({home, env, transport, now, model, cache, gate, provider})`，`provider` 是给 MCP 包预留的接缝 |
| `lib/key.js` | 找钥匙 | 优先级：插件配置 → 环境变量 → `.credentials.yaml`；`deepseek-flash` 默认，`deepseek-v4-pro` 备用 |
| `lib/cache.js` | 磁盘缓存 | 30 天、只存成功、原子写；键 = `词 + 对话指纹 + 模式` |
| `lib/gate.js` | 并发闸门 | 最多 3 路在飞、同键单飞、相邻请求间隔 250ms |
| `lib/prompt.js` | 提示词 | 输出 schema + 硬规则 + `【上级概念】` 规则 + `domain` 规则；`max_tokens 700` |
| `lib/shape.js` | 收敛 | 长度上限、枚举校验、`domain` 截到 10 字、坏条目丢弃 |
| `lib/errors.js` | 错误归一 | `NestError` + `asNestError` |

### 浏览器侧（`client/`，17 个文件打进 `client.js`）

| 文件 | 职责 |
|---|---|
| `util.js` | markdown 清洗、`hashString`、`clampText`、`clampMiddle` |
| `theme.js` | 主题判定（宿主令牌 → body 亮度 → 系统偏好）→ 写 `data-knest-theme` |
| `config.js` | 开关 / 模型 / 快捷键 / 上下文档位（localStorage） |
| `phrase.js` | 圈选文本归一化、整句扩展、两点取文 |
| `transcript.js` | 事件包装 → 消息 → 上下文窗口 + 指纹 |
| `store.js` | 内存 store + 订阅（cards / nodes / notebook / pendingId） |
| `api.js` | 浏览器客户端：内存缓存 + 唯一 fetch；`readFile()` |
| `painter.js` | CSS Custom Highlight 上绿/上橙（两条独立高亮名） |
| `selector.js` | 全文档右键按住拖动，产出 `{phrase, range, rect}` |
| `card.js` | 卡片视图模型 + `parentContextOf()` |
| `menu.js` | 右键菜单：一级 5 项 + 「更多」6 项，`menuItemsFor()` 纯函数决定可用态 |
| `switch.js` | 右侧竖牌 + 独立 toast |
| `tree-board.js` | 无限画布：节点数组、SVG 连线、拖拽/平移/缩放、层级、去重 |
| `actions.js` | 菜单动作纯逻辑：拼释义/引用、笔记本增删、朗读 |
| `layout.js` | `圈词` 视图里的会话竖轴布局 |
| `styles.js` | 全部 CSS（字符串数组，`ensureStyles()` 注入一次） |
| `view.js` | 组装：插槽注册、事件接线、`runExplain`、设置面板 |

### MCP 包（`packages/mcp-server/`）

`src/model.js`（自己的 key/地址/模型解析）→ `src/explain-tool.js`（入参校验 + 调 explainer）→ `src/server.js`（注册 `knowledge_nest_explain`）→ `src/index.js`（stdio 入口）。

---

## 5. 关键实现原理

### 5.1 圈选（`selector.js`）
- 监听 `pointerdown/move/up`，**右键**视为圈选手势；
- 用 `caretRangeFromPoint(x, y)` 取落点文本节点与偏移，`rangeBetween()` 拼 Range；
- 跳过 `INPUT/TEXTAREA/SELECT/contenteditable`；
- 上限 120 字；不拖 = 取整句。

### 5.2 上色（`painter.js`）
- 主路：`CSS.highlights.set('knest-echo', new Highlight(range))`，**不改 DOM**；
- 降级：宿主不支持时用单节点 `<mark>`；
- 同领域用第二条高亮 `knest-domain`（橙色），两条互不覆盖。

### 5.3 上下文（`transcript.js:buildContext`）
- 找到词首次出现的消息，取前后 N 条（档位决定 N 与每条字数）；
- 找不到就取末尾若干条；
- 指纹 = `hash(词 + 上下文)`——**缓存键的一半**；
- 从卡片展开的子词另有 `【上级概念】` 前缀，指纹随之重算，避免不同父节点共用缓存。

### 5.4 缓存
- 内存：`api.js` 的 `Map`（120 条，键含 session/词/指纹/模式）；
- 磁盘：`$DSH_HOME/knowledge-nest/explain-cache.json`，30 天，只存成功；
- 「再试一次」= 丢掉内存条目 + `force` 透传，绕过两级缓存。

### 5.5 闸门（`lib/gate.js`）
最多 3 路并发；同键单飞（避免同一词重复请求）；相邻请求间隔 250ms（防瞬时打崩）。

### 5.6 模型请求
`lib/prompt.js` 给 schema + 硬规则；模型只输出 JSON；`shape.js` 逐字段收敛（超长截断、枚举兜底、坏条目丢弃），保证前端永远拿到结构完整的卡片。

### 5.7 画布（`tree-board.js`）
- 数据：`nodes = [{id, text, x, y, parentId, depth, model, collapsed}]`；
- 世界坐标 + `translate(panX,panY) scale(s)`；滚轮 `Ctrl` 才缩放，`Alt`+拖平移；
- 连线：`edgeFor()` 决定"上下叠着走竖向、横向拉开走横向"，`pathFor()` 出 `M … C …`；
- 层级：`MAX_LEVELS = 3`，超过 `addChild` 返回 `null`；
- 去重：同 `text` 复用已有节点（返回真实 id，调用方按它更新结果）；
- 覆盖层 `pointer-events:none`，只有卡片/圆点吃事件 → 下面的对话照常可选中。

### 5.8 主题
`theme.js` 判定后写 `<html data-knest-theme="dark|light">`；`styles.js` 的 `--kn-*` 令牌按主题取值。

### 5.9 文件读取通道（`index.js:createReadHandler`）
四道闸，顺序固定：**同源 → GET → 路径形状（无 `..`、无 NUL）→ 后缀白名单 → `fs.contains` 工作区 → `stat` 大小 → 边读边计数**。
错误码：`bad-request 400` / `forbidden 403` / `not-found 404` / `method 405` / `too-large 413` / `unsupported-type 415` / `fs-unavailable 503`。
读文本用 `ctx.fs.streamText()`（**没有 `readFile`**），`collectText()` 兼容字符串/异步迭代/Web Stream/Node Readable。

### 5.10 MCP 工具
stdio，stdout 只走协议；复用 `lib/*` 与 `client/card.js`；`provider` 接缝让它不依赖 `DSH_HOME`。

### 5.11 持久化
localStorage：`dsh.knowledge-nest.config` / `.map` / `.notebook`；磁盘缓存见 5.4；MCP 用 `~/.knest/`。

---

## 6. 宿主契约（别猜，照抄）

| 契约 | 用法 |
|---|---|
| `ctx.slots.register` + `inject('conversation.view' / 'settings.section')` | 注册两个视图 |
| `entry.event.{seq,type,data}` | 会话事件包装（也认裸事件） |
| `ctx.webServer.register({kind:'exact', path, handler})` | 两条路由；匹配用 **pathname** |
| `inject: ['webServer','fs']` | 缺 `fs` 时整个插件不加载——这是硬依赖 |
| `ctx.get(name)` 可能返回 `undefined` | 必须再回退 `ctx[name]`，且两者都可能抛 |

---

## 7. 已做的取舍（含被否决的方向）

| 决定 | 原因 |
|---|---|
| 不做联网百科 | 与"语境解释"重复，且增加失败面 |
| **不做多平台适配**（ChatGPT/Claude/Cherry/千问/WorkBuddy） | 五家都不给脚本注入；只有 DSH 能跑完整交互 |
| 独立浮窗 → **无限画布** | 多张卡片互相遮挡，看不出关系 |
| **不自建阅读区**，用 DSH 自带 | 宿主已有预览器，重复造轮子 |
| 画布**不标**同领域 | 同类词是"文字"的事，树不该染色；改为右键菜单标记正文 |
| 文件读取只读、只读文本、只读工作区 | 最小暴露面 |
| HUD 方向（已定，待实现） | 1c 收起成左下角小圆点；2d 提示改 tooltip；4c 去掉缩放按钮只留 `Ctrl+滚轮`；5c 圆点固定在左下角 |

---

## 8. 已知问题 / 待办

- **文件读取通道尚未在真机验证通过**：需重启后 `GET /explain` 看 `diag.fs` / `diag.resolve`。
- HUD 改造未落地（见 §7 最后一行）；`Esc` 关闭按钮是否保留（Q3）未定。
- 圈词本只有「收进/删除/导出」，没有检索。
- 画布状态不持久化：刷新即清空。
- 分屏宽度、图标尺寸等未做响应式。

---

## 9. 测试

`node --test`：插件 79 例 + MCP 13 例。覆盖：圈选归一化、上下文窗口与指纹、卡片收敛、缓存、闸门、路由（含越权/后缀/大小/跨源）、画布几何与去重/层级、菜单可用态、文件读取四道闸、MCP 工具契约与 stdio 全链路。

---

## 10. 术语

| 词 | 含义 |
|---|---|
| 圈词 | 右键拖选一个词/句并请求语境解释 |
| 卡片 / 节点 | 画布上的一张解释卡 |
| 根节点 | 一次圈词产生的第一张卡，深度 0 |
| 依据（evidence） | 模型逐字引用的对话原文 |
| 指纹（fingerprint） | 上下文的内容哈希，缓存键的一半 |
| 档位（depth） | 上下文预算档（compact / balanced / wide） |
| 领域（domain） | 模型判定的所属领域，用于「标出同领域」 |

---

## 11. 变更记录

### 2026-11-07

**本轮完成**

| 项 | 内容 | 落点 |
|---|---|---|
| A 令牌对齐 | `--kn-*` 优先取宿主 `--dsw-alias-*`（bg-base / bg-layer-1 / border-l2 / label-primary / label-tertiary），取不到才回退自带色板；卡片圆角改 `--dsw-radius-lg` | `client/styles.js` |
| E 回路（B 回跳） | 每张非根卡片的标题栏左侧多一个 `↑`，点了把父卡片拉回视野中央并闪一下边框 | `client/tree-board.js` |
| F 画布持久化 | `board.snapshot()/restore()` + view 侧 400ms 防抖写 `localStorage[dsh.knowledge-nest.board]`，刷新后位置/折叠/展开都在 | `client/tree-board.js`、`client/view.js` |
| 批注清空入口 | 右侧「批注」竖条下方加「清空」，一键清红字+气泡+AGENTS 标记块 | `client/view.js`、`client/annotate.js` |
| 批注模式右键 | 批注模式优先接管右键：不弹菜单、不弹系统菜单；selector 的开关判定把模式算进去 | `client/view.js` |
| 批注入口改名 | 菜单项「批注模式」→「批注这段（一次性）」，避免误以为是模式 | `client/menu.js` |

**仍未完成（按优先级）**

1. **B/C 知识库侧栏 + host 存储**（`cards.jsonl` + `GET /knowledge-nest/cards` 搜索路由）——最大的一块；
2. D 卡片右键菜单、G 快捷操作（双击标题复制 / Alt+点词原地换）、H 拖动吸附、I 首次引导、J 导出树、L 多选；
3. K 文件读取通道真机验证（重启后看 `diag.fs` / `diag.resolve`）；
4. 批注欠账：「还有 N 条更早批注」提示、气泡靠近屏幕顶时翻转到下方、窄屏适配。

**已知限制**

- 批注气泡锚在 `Range` 上，文本被宿主回收（虚拟列表滚动）时会不再跟随；
- `Ctrl+R / Ctrl+D / Ctrl+S` 只是菜单标注，尚未接全局快捷键。

### 2026-11-07（续）

| 项 | 内容 |
|---|---|
| 顶部安全区 | 卡片拖动时实时夹在「窗口顶 + 80px」，松手回推 40px；居中上限 80px（44 与 120 之间取的折中值） |
| G 快捷操作 | 双击卡片标题 = 复制释义；Alt+点击卡片里的词 = **原地换解释**（不新增子节点，直接刷新那张卡） |
| J 导出树 | HUD 新增 `⤓`，把整棵树导成 Markdown 大纲并复制到剪贴板 |

### 2026-11-07（知识库面板）

| 项 | 内容 |
|---|---|
| 右侧竖轨重排 | 三颗按钮整体内移到 `right:44px`，避开宿主悬浮球；统一 28px 宽、8px 圆角、等距（22% / +84 / +140） |
| B 知识库检索面板（v1） | `client/library.js`：`Ctrl/Cmd+K` 或点右侧「知识库」竖条呼出；输入框实时搜 **词 / 释义 / 原文引用 / 领域** 四个字段；`↑↓` 选、`Enter` 打开、`Esc` 关；点一行即在画布上打开那张卡 |
| 测试 | `searchCards` 四字段匹配 + 领域过滤（1 例） |

**B 仍是 v1**：数据来自内存 `store.cards`，刷新后只剩当前会话；**C（迁到 host `cards.jsonl` + `GET /knowledge-nest/cards`）未做**。

### 2026-11-07（收尾：C/D/H/I）

| 项 | 内容 |
|---|---|
| **C 卡片仓库** | `lib/cards.js`：`$DSH_HOME/knowledge-nest/cards.jsonl`，按词合并、原子重写、坏行跳过；host 新路由 `GET/POST /knowledge-nest/cards`（搜索支持词/释义/原文/领域 + limit）；`routeState.cards` / `diagState.cards` 可查 |
| C 客户端 | `api.saveCard()` / `api.searchCards()`；每张成功的卡自动写库；知识库面板**优先走 host 搜索**，失败退回内存 |
| **D 卡片右键菜单** | 卡片上右键 = 复制释义 / 删掉这张（连带子卡片）；菜单复用现有组件 |
| **H 拖动吸附** | 拖动时按 12px 网格吸附，按住 `Alt` 关闭吸附 |
| **I 首次引导** | 首次装好出现一条提示条，9 秒后自动消失，标记写 `localStorage[dsh.knowledge-nest.guided]` |
| 右侧竖轨 | 三颗按钮内移到 `right:44px`，避开宿主悬浮球 |

**仍未做**：L 多选（Shift 框选、整组操作）；批注欠账（更早批注提示条、贴顶翻转）；K 文件通道真机验证。

### 2026-11-07（收尾 2）

| 项 | 内容 |
|---|---|
| **L 多选与整组** | `Shift+点击` 卡片切换选中（信号色描边）；选中多张时**拖动任意一张整组移动**；`Delete/Backspace` 删除全部选中（各自连带子卡片）；`Esc` 先清选中再退模式/收画布 |
| 批注欠账① | 气泡上方放不下时**翻到文字下方**（`data-side="below"`），不被窗口顶切掉 |
| 批注欠账② | 顶部出现「还有 N 条更早的批注没提交」提示条，点一下全部标记已提交并写进 AGENTS |
| HUD 位置 | 三颗按钮（导出/回到根节点/全部关闭）挪到**窗口左下角** |

**仍然只有一项没闭环**：K 文件读取通道需要重启后跑 `curl "http://127.0.0.1:<port>/knowledge-nest/explain"`，把 `routes` 与 `diag` 贴回来才能定位（`diagState.cards` 也会显示卡片仓库路径）。
