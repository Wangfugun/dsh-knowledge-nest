# 词林 · 一页纸速读

> 这份文件是给**没参与过开发、上下文有限的 AI** 看的。读完你应该能回答：它是什么、怎么实现、用在哪、Cherry Studio 适配到什么程度、接下来怎么改。
> 不需要读源码，但需要时本文给了准确的文件路径和命令。

---

## 三十秒版

**词林是一个"圈词解释器"。** 用户在对话里按住鼠标右键拖过一个词，这个词变绿，旁边落下一张卡片，说清**它在这一整段对话里指什么**。卡片里的词还能继续点开，一层层长成一棵可拖动的知识树。

三个关键点：

1. **只解释语境，不做百科**——它读的是你正在看的这段对话，不是词典；
2. **不发散**——同一个词在同一段对话里只问一次，结果缓存 30 天；
3. **不改宿主页面**——上色用浏览器自带的文字高亮接口，卡片画在一层不挡鼠标的透明浮层上。

---

## 一、它是干什么的

| 用户动作 | 发生什么 |
|---|---|
| 在对话正文上按住右键拖过一段字，松手 | 那段字变绿，弹出菜单 |
| 点菜单「解释这段文本」 | 画布上出现一张卡片：语境释义 + 逐字引用原文作依据 + 可继续展开的词 + token 用量 |
| 点卡片里的词 | 长出子卡片，父子之间连一条曲线，最多 4 层 |
| 拖卡片标题栏 | 卡片移动，连线实时重画 |
| 菜单「批注这段」 | 那句话标红划掉，上方气泡写「改为：」，内容写进工作区 `AGENTS.local.md`，模型下一轮能读到 |

**它刻意不做的事**：不联网查词、不做同义词推荐、不写进对话历史。

---

## 二、原理：四层

### 第 1 层 · 圈选（拿到文本）

`client/selector.js`

- 监听 `pointerdown / pointermove / pointerup`，**右键拖动**触发；
- 用 `document.caretRangeFromPoint(x, y)` 拿到落点的文本节点与字符偏移，两点之间拼成 `Range`；
- 跳过 `INPUT / TEXTAREA / SELECT / contenteditable`；
- 没拖动只是点一下，就取指针所在那一整句；
- 上限 120 字，超出不扩。

### 第 2 层 · 语境（组织上下文）

`client/transcript.js` 的 `buildContext()` + `client/phrase.js` 的 `contextAroundRange()`

上下文有两个来源，拼在一起发给模型：

**来源 A：对话窗口。** 在会话消息里找这个词第一次出现的位置，取它前后几条消息，按「档位」决定取多少（compact / balanced / wide）。

**来源 B：文档原文。** 如果选区落在右侧打开的 Markdown / PDF 预览里（这些内容不在对话消息中），就从选区所在的段落、列表项或表格单元格里取前后各 400 字。

拼好后算一个**指纹**：

```
fingerprint = hash(词 + 完整上下文)
```

指纹是缓存键的一半，所以「同一段对话里同一个词」第二次问不会重复花钱；上下文一变，指纹变，缓存自然失效。

### 第 3 层 · 模型（怎么问、怎么收）

`lib/prompt.js` + `lib/shape.js` + `lib/gate.js` + `lib/cache.js`

- **提示词**：要求模型只输出一个 JSON，字段固定（`here` 语境释义、`kind` 类型、`domain` 领域、`literal` 通常含义、`readings` 其他读法、`evidence` 逐字引用、`links` 可展开词、`confidence` 置信度）；
- **硬规则**：`evidence.quote` 必须逐字出现在对话里，不许编；
- **收敛**：模型回来之后逐字段检查，超长截断、枚举兜底、坏条目丢弃，保证前端永远拿到结构完整的卡片；
- **闸门**：同时最多 3 个请求在飞，相同的词单飞，相邻请求间隔 250 ms；
- **缓存**：内存一层 + 磁盘一层（`$DSH_HOME/knowledge-nest/explain-cache.json`，30 天，只存成功的）。

**从卡片里再点开一层时多一段「上级概念」**：把父卡片的释义一起塞进上下文。因为这种词（比如从 `pointer-events:none` 点开的「CSS 属性」）原文里往往根本没出现过，只喂对话模型会回一句「没有上下文」。

### 第 4 层 · 呈现（怎么画）

`client/painter.js` + `client/tree-board.js` + `client/annotate.js`

- **绿字高亮**：`CSS.highlights.set('knest-echo', new Highlight(range))`，不改 DOM。同领域标记用第二个高亮名 `knest-domain` 染橙；批注用第三个 `knest-note` 加删除线。
- **画布**：一个 `position:fixed` 的全屏层，`pointer-events:none`（不吃鼠标事件，下面的对话照常可选可滚）。里面的 `world` 用 `translate(panX, panY) scale(s)` 做世界坐标，节点是绝对定位的 `div`，连线是 SVG 的 `path`，`d` 由 `edgeFor()` 算——两个节点大致上下叠着就走竖向贝塞尔，横向拉开得远就走横向。
- **层级与去重**：`MAX_LEVELS = 4`；同一段文字在画布上只存在一个节点，重复圈同一个词会复用并刷新它。

---

## 三、应用场景

1. **读陌生代码**：圈 `pointer-events:none`，拿到的是「让元素不响应鼠标事件，点击会穿透到下层」，不是词典里那句「指针事件为无」。
2. **追术语链**：一个词点开一层，再点开一层，把一句话拆成树。
3. **读文档/讲义**：右侧打开的 Markdown、教材 PDF，圈里面的术语，上下文会自动带上那段原文。
4. **改稿**：批注模式把不满意的句子标红划掉，写上你要的版本，模型下一轮按你的改法理解。
5. **复习**：所有圈过的词进「知识库」标签页，可按词、释义、原文、领域四个字段搜索，卡片存在磁盘上不会丢。

---

## 四、三种运行形态

| 形态 | 怎么跑 | 有没有完整交互 |
|---|---|---|
| **DSH 插件**（主形态） | 装进 `~/.dsh/profiles/desktop/node_modules/dsh-knowledge-nest`，`cordis.patch.yml` 里注册 | 有：圈选、绿字、画布、批注、知识库 |
| **独立版 + 注入**（给 Cherry Studio 这类 Electron 客户端） | 起解释服务，用调试端口启动客户端，CDP 注入 | 有：同一套代码，同样的界面 |
| **MCP 工具** | `packages/mcp-server`，stdio | 没有 UI，只有文本进出，任何支持 MCP 的客户端都能调 |

---

## 五、Cherry Studio 适配：现状（**这条是重点**）

### 为什么走注入这条路

Cherry Studio 官方只开放自定义 CSS，没有注入脚本的入口。但它是 Electron 应用（主窗口 `contextIsolation: true`、`sandbox: false`、`webSecurity: false`），所以可以用 `--remote-debugging-port` 启动，从外部用 Chrome DevTools 协议接管渲染进程，把我们的代码注入进去。

**这条路不改它的安装目录**，关掉客户端即恢复原样。

### 已经跑通的部分（实测）

| 环节 | 状态 |
|---|---|
| 安装 Cherry Studio 2.1.10 到 `D:\Apps\CherryStudio` | 通过，sha256 校验过 |
| 带调试端口启动，`/json/list` 返回 3 个页面 | 通过 |
| 注入 `client-standalone.js`（144 KB） | 通过，返回 `mounted` |
| 卡片、连线、HUD 渲染 | 通过，截图确认 |
| 主题跟随（Cherry 是浅色，我们也切成浅色板） | 通过，检测到 `data-knest-theme = light` |

### 三条命令

```powershell
cd D:\dsh-workspace\knest-v2
.\tools\cherry-up.ps1
```

`cherry-up.ps1` 做四件事：清掉 `ELECTRON_RUN_AS_NODE`、确保解释服务在跑（7331）、确保 Cherry 带调试端口（没开就重启）、注入。

手工版：

```powershell
node tools/serve-standalone.mjs                                             # 解释服务
& "D:\Apps\CherryStudio\Cherry Studio.exe" --remote-debugging-port=9222     # 客户端
node tools/cdp-inject.mjs --port 9222                                       # 注入
```

撤掉：`node tools/cdp-inject.mjs --port 9222 --dispose`，或者直接关 Cherry。

### 三个必须知道的坑

1. **`ELECTRON_RUN_AS_NODE=1`**。这个环境变量会让 Cherry 被当成 Node 解释器启动，任何窗口参数都报 `bad option`、退出码 9。启动前必须清掉：`Remove-Item Env:ELECTRON_RUN_AS_NODE`。
2. **调试端口要显式开**。双击图标启动不带端口，`/json/list` 连不上。
3. **临时目录要有空间**。NSIS 安装器解压到 `%TEMP%`，C 盘满会失败在「无法写入 nshE218.tmp」。安装时把 `TMP`/`TEMP` 指到有空间的盘。

### 已知限制

- **重启即失效**：注入只活在当前进程，重开 Cherry 要重跑一次 `cherry-up.ps1`。
- **调试端口对本机开放**：只适合个人机器。
- **官方可能关掉这条路**：若某版本给 Electron 传 `--remote-debugging-port=0`，注入会失败，只能退回改包或独立网页。

---

## 六、如果要接着改，先看这些

### 关键文件

```
index.js                    宿主入口：注册两条路由（/explain、/annotations、/cards、/read）
lib/explain.js              编排：先查缓存，再过闸门，然后出网请求，最后收敛字段
lib/prompt.js               提示词与输出 schema
lib/shape.js                模型返回后的字段收敛
lib/key.js                  钥匙解析：插件配置优先，其次环境变量，最后读 .credentials.yaml
lib/gate.js                 并发闸门
lib/cache.js                磁盘缓存

client/selector.js          右键拖选，产出 { phrase, range, rect, docText }
client/phrase.js            文本归一化、整句、两点取文、contextAroundRange
client/transcript.js        把消息整理成上下文窗口，并算出指纹
client/painter.js           三种高亮：绿（解释）、橙（同领域）、红划掉（批注）
client/tree-board.js        无限画布：节点、连线、拖拽、缩放、多选、层级、去重
client/annotate.js          批注：红字删除线、气泡、跟随、提交淡出
client/menu.js              右键菜单：一级 6 项 + 「更多」二级
client/card.js              卡片视图模型
client/view.js              仅 DSH 版用：React 视图 + 插槽注册
client/standalone.js        独立版外壳：不依赖 React，串起上面所有模块
client-standalone.js        由 tools/build-standalone.mjs 打包，注入用的就是这个

tools/serve-standalone.mjs  独立版的解释服务（POST /explain）
tools/cdp-inject.mjs        CDP 注入器
tools/cherry-up.ps1         Cherry 一键：服务 + 端口 + 注入
tools/build-client.mjs      DSH 版打包
tools/build-standalone.mjs  独立版打包
```

### 不能动的契约

- 模型请求只走宿主路由或独立服务，**不直连模型**；
- 上色只用 CSS Custom Highlight，**不往宿主 DOM 里塞节点**；
- 画布层必须 `pointer-events: none`，只有卡片和 HUD 吃事件；
- 卡片按文本去重，同一个词只有一个节点。

### 测试

```bash
node --test          # 106 例：插件 88 + MCP 18
```

覆盖：圈选归一化、上下文与指纹、卡片收敛、缓存、闸门、路由（含越权/后缀/大小/跨源）、画布几何与去重/层级、菜单可用态、文件读取四道闸、MCP 工具契约与 stdio 全链路、本地模型解析。

### 换模型

`lib/key.js`（插件）和 `packages/mcp-server/src/model.js`（MCP 工具）是两处钥匙解析，互不干扰。

支持本地免费推理：

```bash
KNEST_PROVIDER=ollama OPENAI_MODEL=qwen2.5:7b node tools/serve-standalone.mjs
```

预设：`ollama`（11434）、`lmstudio`（1234）、`vllm`（8000）。本地端点不需要钥匙。

---

## 七、常见问题

**Q：为什么不做成普通浏览器插件？**
A：可以做，而且这是最省事的路——浏览器扩展的 content script 和网页同上下文，能拿 DOM。现在优先做客户端注入，是因为用户的主战场在桌面客户端里。

**Q：为什么不上网查词？**
A：联网查词会把「这段对话里它指什么」变成「这个词一般指什么」，正是要避免的。

**Q：卡片存哪？**
A：`$DSH_HOME/knowledge-nest/cards.jsonl`，一行一张，坏一行不影响别的行。缓存是 `explain-cache.json`。批注写在工作区 `AGENTS.local.md` 的标记块里。

**Q：为什么批注要写文件？**
A：插件改不了用户发出去的消息。宿主每轮会把 `AGENTS.local.md` 渲染进模型指令，所以把批注摘要写进去，模型下一轮就能读到，不需要拦截消息。

**Q：一次圈词花多少？**
A：首次约 800 token，追问一层约 500。同一个词在同一段对话里只问一次。

---

## 八、一句话总结

**它把「我没看懂这句话里的某个词」变成一次右键拖动，用当前这段对话的上下文回答，并让答案可以继续往下钻。**
