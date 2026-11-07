# dsh-knowledge-nest · 圈词

在 DeepSeek Harness 的对话里，**按住鼠标右键拖过一个词或一句话，松手它就变绿**；
host 会把「圈出来的字 + 前后几句对话」发给 DeepSeek，问清楚**它在这一整段对话里到底指什么**。
答案贴在你圈的地方，同时这个句子会在 `圈词` 视图里留下一个节点。

- 一次圈词 = 一次小请求（默认约 800 token，可切档），同一个词在同一段对话里只问一次；
- 绿色高亮用 CSS Custom Highlight 画，**不改宿主 DOM**；
- 没有联网百科、没有词表：只有语境解释。

---

## 平台支持范围

本插件依赖对对话正文的 DOM 操作（圈选、高亮、右键菜单、可拖动卡片、会话地图），**目前仅在 DeepSeek Harness 中完整可用**。其他平台因沙盒隔离或未开放脚本注入，无法提供同等交互，故不适配：

- **ChatGPT / Claude**：MCP App 运行在沙盒 iframe，规范禁止访问父页面 DOM
- **Cherry Studio**：官方仅支持自定义 CSS，无脚本注入入口
- **WorkBuddy / 千问**：扩展能力未确认

`packages/mcp-server/` 提供独立的 MCP 解释工具（仅文本输入输出，无 UI 交互），可用于任何支持 MCP 的客户端，但它不具备本插件的完整交互能力。

---

## 一、怎么用

1. **开关**：对话区右侧竖着一块「启用圈词」，点一下切换；默认快捷键 `Alt+Q`（设置里可改）。
2. **圈**：开着时，在聊天区按住鼠标右键，拖过要问的字，松手。
   - 只是点一下不放、不拖 → 取指针所在的那一整句。
   - 拖选上限 120 字（再长就不是"一个词/一句话"了）。
3. **绿**：选中的字立刻变绿并留在那里；松手后画布打开，**根节点落在画布中心**。
4. **读**：节点里从上到下是 —— 在这段对话里指什么 → 依据（引用原文）→ 可继续展开的词 → token 用量。
5. **长**：点节点里的词（`往下再一层` 的那些 label），会以它为子节点再问一次，**父子之间自动连一条贝塞尔曲线**；子节点越多，弧线扇形展开。最多 **3 层**，到第 3 层词不再可点。
6. **摆**：拖标题栏移动节点（连线实时跟着重算）；空白处按住拖动平移画布；滚轮以光标为中心缩放；节点右上角 `—` 折叠、`×` 关闭（**连带它的所有子节点一起删**）。
7. **收**：按 `Esc`，或点画布左下角的「全部关闭」，整个画布清空并收起遮罩。
8. **回头看**：切到 `圈词` 标签页，是一张图 —— 会话是一条竖轴，圈过的词挂在它第一次出现的那条消息旁边；点节点重开画布。

**关掉开关以后**：右键**照样能拖选**（这一点上一版做错了），只是松手不再自动解释，而是在选区**右上角**弹出一个小方框，一级四个常用动作，其余收进「更多」：

```
一级                         更多
  ⧉ 复制                       ‹ 返回
  ⌕ 查询（圈词）                ▤ 复制释义
  ↻ 换个说法                    ✦ 举个例子
  ⚑ 收进圈词本                  ◍ 翻译
  ─────────────                ◁ 朗读
  › 更多                        ❞ 复制引用块
                               ⊕ 定位出处
```

| 动作 | 做什么 | 花多少 |
|---|---|---|
| 复制 | 选区原文进剪贴板 | 0 |
| 查询 | 对这一次选中做完整语境解释 | 约 800 token（首次） |
| 换个说法 | 让模型用大白话重讲一遍 | 约 570 token |
| 收进圈词本 | 存进 `圈词` 页下面的收藏列表 | 0 |
| 复制释义 | 把 AI 那段解释拼成纯文本 | 0 |
| 举个例子 | 让模型给一个具体场景 | 约 500 token |
| 翻译 | 中↔英，只出译文 | 约 400 token |
| 朗读 | 离线 TTS 念释义或原文 | 0 |
| 复制引用块 | `> 原句 —— 你 · 第 3 条` | 0 |
| 定位出处 | 高亮并滚到它第一次出现的那条消息 | 0 |

变体（换说法 / 例子 / 翻译）各开一扇新窗，不会顶掉原释义，也不进地图；缓存键里带了模式，同一模式只问一次。

**圈词本**：收进去的条目存在 `localStorage['dsh.knowledge-nest.notebook']`，在 `圈词` 页地图下面列出来——点一条用存下的字段重开卡片（不再花钱），右侧 `×` 删掉，顶部能「导出 Markdown」（写进剪贴板）。

最小化后的卡片会缩到右侧托盘（就是 `气泡` 那种小牌子），点一下原样还原；托盘里的牌子按开窗顺序排。

图上同一行圈了几个词，就竖着错开、用一根肘形支线连起来；节点实心表示解释过了，空心表示还没问出来。

---

## 一点五、token 花在哪

中文大致是 **1 字 ≈ 0.6 token**，成本几乎全在"喂多少上下文"。实测（`node tools/measure-tokens.mjs`）：

| 档位 | 上下文 | prompt | completion | 合计 |
|---|---|---|---|---|
| 精简（默认） | 约 550 字 | 594 | 242 | **836** |
| 标准 | 约 1430 字 | 1109 | 220 | 1329 |
| 详细 | 约 3770 字 | 2500 | 224 | 2724 |

旧版是按「命中那条消息前后 13 条 × 每条 320 字」喂的，一次能到 **3081 token**——
这就是你觉得"不止几百"的原因：**system 只占 300 上下，其余全是上下文**。
现在默认精简档（命中那条 ±1 条、每条 180 字），并把 system 压到 300 字以内；
`prompt_cache_hit_tokens` 那一栏就是 DeepSeek 侧的命中缓存，重复问同一段话会更便宜。

---

## 二、装

插件放在 `$DSH_HOME/profiles/desktop/node_modules/dsh-knowledge-nest`，并在
`$DSH_HOME/profiles/desktop/cordis.patch.yml` 里登记（`cordis.patch.yml` 随包附带）。

```powershell
$p = "$env:DSH_HOME\profiles\desktop\node_modules\dsh-knowledge-nest"
node tools/build-client.mjs     # 改完 client/*.js 必跑（bundle 是生成物，测试会校验新鲜度）
node --test                     # 全绿再装
```

装完**重启 `dsh`**：host 路由是在插件 `apply()` 里注册的，不重启就只有旧路由。

---

## 三、钥匙从哪来

host 按这个顺序找 DeepSeek key（先到先得）：

1. `$DSH_HOME/knowledge-nest/explain.json` 里的 `apiKey`（手填，最优先）；
2. 进程环境变量 `DEEPSEEK_API_KEY`；
3. `$DSH_HOME/.credentials.yaml` 的 `refs.DEEPSEEK_API_KEY`（DSH 自己存 key 的地方，本机就有）。

浏览器**永远拿不到 key**：它只发"词 + 对话片段"，请求由 host 发出。

`explain.json` 还能改这些：

```json
{
  "model": "deepseek-flash",
  "fallbackModel": "deepseek-v4-pro",
  "baseUrl": "https://api.deepseek.com",
  "maxTokens": 900,
  "timeoutMs": 45000,
  "enabled": true
}
```

设置页（`设置 → 圈词`）能看钥匙状态、切模型（`deepseek-flash` 快、`deepseek-v4-pro` 细）、清缓存。

---

## 四、路由

```
POST   /knowledge-nest/explain   {phrase, sentence, context, fingerprint, model?}
                               → {ok, data, cached, model, ms}
GET    /knowledge-nest/explain   → {ok, status}      # 钥匙状态、缓存计数、闸门计数
DELETE /knowledge-nest/explain   → {ok, cleared}     # 清解释缓存
```

错误码：`no-key`(503) `disabled`(503) `unauthorized`(401) `rate-limited`(429)
`timeout`(504) `network|http|bad-json|empty|model-unavailable`(502) `bad-request|too-large`(400)。

来源校验：**带了 `Origin` 就必须同源**；没带的放行（桌面端 origin 常是 `app://`/`null`）。

---

## 五、结构

```
index.js                  host 入口：路由注册 + 请求体/来源校验
lib/key.js                钥匙解析（配置 → 环境变量 → 凭据文件）
lib/cache.js              磁盘缓存（FORMAT 1，30 天，只存成功，原子写）
lib/gate.js               并发闸门（≤3 在飞、同 key 单飞、起步间隔 250ms）
lib/prompt.js             system 提示词 + 变体模式（释义/换说法/举例/翻译）+ 上下文裁剪
lib/shape.js              模型输出收敛（长度/层级/枚举全部封顶）
lib/explain.js            编排：缓存 → 闸门 → 出网 → 收敛 → 写缓存
lib/errors.js             统一错误形状

client/util.js            清洗 markdown、哈希、截断
client/config.js          开关 / 模型 / 快捷键 / 档位（localStorage）
client/actions.js         菜单动作的纯逻辑：拼释义/引用、笔记本增删导出、朗读
client/theme.js           主题判定（宿主令牌 → body 亮度 → 系统偏好）+ 写到 <html>
client/phrase.js          圈选文本归一化、整句、两点取文
client/transcript.js      事件包装 → 消息 → 上下文窗口 + 指纹
client/painter.js         CSS Custom Highlight 上绿（降级：单节点 <mark>）
client/selector.js        全文档右键按住拖动
client/api.js             浏览器侧客户端（内存缓存 + 唯一 fetch）
client/layout.js          流程图坐标（竖轴 + 节点 + 肘形支线）
client/card.js            卡片视图模型 + 错误文案
client/menu.js            关掉圈词时的右键菜单（复制/查询/换说法/圈词本 + 「更多」二级）
client/switch.js          「启用圈词」右侧竖牌
client/tree-board.js      知识树画布：无限画布 + 节点 + SVG 贝塞尔连线（连线几何是纯函数）
client/styles.js          令牌 / 图案 / 动效（暗：等深线；亮：细网格 + 光斑）
client/view.js            地图视图 + 设置面板 + 插件装配
client.js                 ⚠ 生成物（tools/build-client.mjs）
```

数据落在：

- `$DSH_HOME/knowledge-nest/explain-cache.json` —— 解释缓存；
- `localStorage['dsh.knowledge-nest.map']` —— 每个会话圈过的词；
- `localStorage['dsh.knowledge-nest.config']` —— 开关、模型、快捷键、上下文档位。

---

## 六、宿主契约（别猜，照抄）

1. `conversation.view` 的宿渲染**不带 sessionId**，必须靠注册项上的
   `inject: (sessionId) => ({ sessionId })` 传进去，否则视图永远空白。
2. 事件条目是 `{ event: { seq, type, data } }` **包装**，测试夹具是裸事件——两种都要认。
3. 路由用 `ctx.effect(() => ctx.webServer.register({kind:'exact', path, handler}))`，
   `register` 返回 disposer，交给 `ctx.effect` 收。
4. 样式表要**原地替换 `textContent`**，不能"已存在就 return"；版本号写进 `data-knest-style`。
5. `::highlight()` 的变量要从**被高亮文字所在的元素**继承——所以令牌挂在 `<html data-knest-theme>` 上。

---

## 七、测试

```powershell
node --test
```

- `test/unit.test.mjs` —— 清洗 / 哈希 / 圈词 / 快照 / 上下文 / 布局 / 卡片；
- `test/host.test.mjs` —— 钥匙优先级、缓存过期与版本、闸门并发与单飞、模型输出收敛、提示词；
- `test/route.test.mjs` —— 路由状态码、缓存命中、429 不落盘、模型名不被认时退备用、非 JSON 降级；
- `test/bundle.test.mjs` —— bundle 与源文件同步、无模块语法、槽位契约、样式令牌齐全。

真机冒烟（会花钱，一次几百 token）：

```powershell
node tools/smoke-explain.mjs     # 真 key + 真接口，第二次调用应命中磁盘缓存
```

看设计（不需要宿主，用 Edge 无头截图）：

```powershell
node tools/preview.mjs           # preview/dark.html、preview/light.html
node tools/preview-states.mjs    # 空态 / 计算中 / 失败 / 翻到上方
```

---

## 八、已知取舍

- **上下文按"命中那条消息前后几条"截取**，不是整个会话：整段太贵，且会让解释变笼统。
- **对话一变，指纹就变**：同一句在对话继续增长后会被重新问一次（客户端内存缓存只挡同一次浏览）。
- **模型名写死两种**：`deepseek-flash` / `deepseek-v4-pro`；换别的家要自己改 `baseUrl` 与 `buildBody`。
- **宿主流式重渲染会打断 Range**：每次快照刷新后按文本重新解析；跨元素的选区在极端情况下只高亮首段。
- **0 条消息**、**没配 key**、**路由没重启** 这三种状态卡片里都有专门文案，不会出现空白卡。
