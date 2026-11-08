# @knest/mcp-server · knowledge_nest_explain

> 状态：独立 MCP 工具，仅提供文本输入输出的解释能力，不包含圈选/高亮/卡片等 UI 交互。主插件的完整交互仅在 DeepSeek Harness 中可用。

把「这个词在这段对话里是什么意思」做成一个 **MCP tool**：任何支持 MCP 的客户端（Claude Desktop、Cherry Studio、自建 host 等）都能调用**这个工具**——注意只是工具，不是主插件那套交互。

- **复用什么**：`lib/explain.js`（缓存 → 闸门 → 出网 → 收敛）、`lib/prompt.js`、`lib/shape.js`、`lib/cache.js`、`lib/gate.js`、`lib/errors.js`，以及 `client/card.js` 的卡片模型。
- **不复用什么**：`ctx.webServer`、`DSH_HOME`、`.credentials.yaml` 一律不碰——配置与钥匙由本包自己的 `src/model.js` 解析。
- **传输**：stdio。stdout 只走协议，日志全在 stderr。

## 工具契约

名字：`knowledge_nest_explain`

| 入参 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `text` | string | ✅ | 圈出来的词或句子（≤200 字） |
| `context` | string | — | 前后几条对话拼成的纯文本（≤8000 字）。**给得越贴近原文，解释越准** |
| `mode` | `explain` \| `rephrase` \| `example` \| `translate` | — | 默认 `explain`；`translate` 只出译文 |

出参：

```json
{ "ok": true, "card": { "phrase": "...", "lead": "...", "evidence": [ ... ], "meta": { ... }, "mode": "explain" } }
{ "ok": false, "code": "no-key", "message": "..." }
```

失败**在返回值里表达**（`ok:false` + `code`），不走 JSON-RPC 错误——调用方拿到 code 自己决定怎么提示。

错误码：`bad-request` `bad-mode` `disabled` `no-key` `no-base-url` `no-model`
`unauthorized` `rate-limited` `timeout` `network` `http` `empty` `bad-json` `model-unavailable`。

## 装与跑

```bash
cd packages/mcp-server
npm install
node src/index.js          # stdio，等客户端握手
```

客户端配置（以 Claude Desktop 的 `claude_desktop_config.json` 为例）：

```json
{
  "mcpServers": {
    "knowledge-nest": {
      "command": "node",
      "args": ["<绝对路径>/packages/mcp-server/src/index.js"],
      "env": { "DEEPSEEK_API_KEY": "sk-..." }
    }
  }
}
```

## 模型来源（key / 地址 / 模型）

**三元组取自同一层**，不会出现「DeepSeek 的 key + 别家的模型名」这种混搭。

查找顺序：

1. **环境变量**（MCP 客户端通常用 `env` 传）
   - `OPENAI_API_KEY` + `OPENAI_BASE_URL`（任意 OpenAI 兼容接口）+ `OPENAI_MODEL`（必填）
   - 或 `DEEPSEEK_API_KEY`（地址默认 `https://api.deepseek.com`，模型默认 `deepseek-flash`）
2. **配置文件**：`$KNEST_CONFIG`，否则 `$KNEST_HOME/config.json`（默认 `~/.knest/config.json`）

```json
{
  "apiKey": "sk-...",
  "baseUrl": "https://api.deepseek.com",
  "model": "deepseek-flash",
  "fallbackModel": "deepseek-v4-pro",
  "maxTokens": 700,
  "timeoutMs": 45000
}
```

`env` 里给了 key 就整组走 env（+ 供应商默认）；没给才读配置文件。模型名不猜：非 DeepSeek 端点必须显式给 `OPENAI_MODEL`，否则调用前就会返回 `no-model`。

数据目录 `$KNEST_HOME`（默认 `~/.knest`）存放 `config.json` 与解释缓存 `explain-cache.json`（30 天、只存成功、按 `词+上下文指纹+模式` 去重）。

> **Windows 提醒**：默认的 `~/.knest` 落在系统盘。这台机器如果禁止写 C 盘，请把 `KNEST_HOME` 指到别的盘，否则缓存会写到 `C:\Users\<你>\.knest`。启动时 stderr 会主动提示这件事。

### 本地免费模型

不想花钱就把解释请求打到本机推理上，本地端点不需要钥匙：

| 变量 | 效果 |
|---|---|
| `KNEST_PROVIDER=ollama` | 端点 `http://127.0.0.1:11434/v1` |
| `KNEST_PROVIDER=lmstudio` | 端点 `http://127.0.0.1:1234/v1` |
| `KNEST_PROVIDER=vllm` | 端点 `http://127.0.0.1:8000/v1` |

配上 `OPENAI_MODEL`（例如 `qwen2.5:7b`）即可；本地模型慢，把 `KNEST_TIMEOUT_MS` 调到 120000 左右。

## 自测

三步，从最轻到最实。

**一、命令行自检**（推荐先跑这个）

```bash
node tools/selfcheck.mjs                      # 12 项检查，退出码 0 表示可被客户端拉起
node tools/selfcheck.mjs --env=D:\cherry.json # 用客户端那份 env 跑，直接吐出能粘贴的配置
node tools/selfcheck.mjs --call               # 顺便真调一次（会花 token）
node tools/selfcheck.mjs --json               # 机器可读，方便接到自己的脚本里
```

它模拟客户端的方式：用 `command + args + env` 起子进程，走一遍 `initialize`、`tools/list`，再检查 stdout 有没有被日志污染。

退出码：`0` 全通过，`1` 有硬错误，`2` 能起动但配置不全（多半是缺钥匙）。

**二、单元与端到端测试**

```bash
node --test                                   # 18 例：工具契约 / 缓存 / 错误码 / 备用模型 / 本地预设 / stdio 全链路
node tools/fake-model-server.mjs --port 8787  # 假模型端点，不联网、不花钱
```

**三、官方 Inspector**

```bash
npx @modelcontextprotocol/inspector --cli node src/index.js \
  -e OPENAI_API_KEY=sk-fake -e OPENAI_BASE_URL=http://127.0.0.1:8787/v1 -e OPENAI_MODEL=fake-model \
  --method tools/call --tool-name knowledge_nest_explain \
  --tool-arg text=推倒重来 "context=你：推倒重来；答：全部重做。" mode=explain
```

Inspector 的 schema 检查：`--method tools/list --strict`，应为 `0 errors, 0 warnings`。

## 打包给客户端

MCP 客户端（Cherry Studio、Claude Desktop）拉起子进程时**不会**替你 `npm install`，所以依赖必须随包带。

```bash
node tools/pack.mjs                        # 输出 dist/knest-mcp
node tools/pack.mjs --out=D:\knest-mcp     # 指定位置
node tools/pack.mjs --zip                  # 额外打一个 zip
```

产出目录里除了源码与 `node_modules`，还有：

- `cherry-config.json`：填好 command/args 的客户端配置，改一下 env 就能粘；
- `怎么用.md`：三步接入说明与排错表；
- `tools/selfcheck.mjs`：在客户端机器上也能跑的自检。

## 在 Cherry Studio 里用

1. 跑 `node tools/selfcheck.mjs`，退出码 0；
2. 打开 Cherry 的 MCP 设置，加一个自定义服务器，粘 `cherry-config.json` 并把 env 补全：

```json
{
  "mcpServers": {
    "knowledge-nest": {
      "command": "C:\\Program Files\\nodejs\\node.exe",
      "args": ["<绝对路径>\\packages\\mcp-server\\src\\index.js"],
      "env": {
        "KNEST_HOME": "D:\\knest-data",
        "DEEPSEEK_API_KEY": "sk-..."
      }
    }
  }
}
```

3. 在对话里说：「用 knowledge-nest 解释一下『某某词』在这段话里的意思，上下文是……」。

工具名、入参、返回结构都不变，和 Claude Desktop 里完全一致。

## 目录

```
src/model.js          key/地址/模型解析（env → config → 供应商默认）+ 启动诊断
src/explain-tool.js   入参校验 + 调 explainer + 拼卡片（不依赖 SDK，可单测）
src/server.js         MCP Server 注册 tool（SDK 在这一层）
src/index.js          stdio 入口，外加 --help / --version
tools/selfcheck.mjs   按客户端方式拉起并自检
tools/pack.mjs        打包成可分发的目录
tools/check-model.mjs 只验模型端点通不通
tools/fake-model-server.mjs  本地假端点（联调/演示用）
test/explain-tool.test.mjs   工具层用例
test/model.local.test.mjs    本地预设与无钥匙放行
test/stdio.test.mjs          真子进程端到端
```
