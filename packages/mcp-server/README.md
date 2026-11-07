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

## 自测

```bash
node --test                                   # 13 例：工具契约 / 缓存 / 错误码 / 备用模型 / stdio 全链路
node tools/fake-model-server.mjs --port 8787  # 假模型端点，不联网、不花钱

npx @modelcontextprotocol/inspector --cli node src/index.js \
  -e OPENAI_API_KEY=sk-fake -e OPENAI_BASE_URL=http://127.0.0.1:8787/v1 -e OPENAI_MODEL=fake-model \
  --method tools/call --tool-name knowledge_nest_explain \
  --tool-arg text=推倒重来 "context=你：推倒重来；答：全部重做。" mode=explain
```

Inspector 的 schema 检查：`--method tools/list --strict` → `0 errors, 0 warnings`。

## 目录

```
src/model.js          key/地址/模型解析（env → config → 供应商默认）
src/explain-tool.js   入参校验 + 调 explainer + 拼卡片（不依赖 SDK，可单测）
src/server.js         MCP Server 注册 tool（SDK 在这一层）
src/index.js          stdio 入口
tools/fake-model-server.mjs  本地假端点（联调/演示用）
test/explain-tool.test.mjs   11 例工具层用例
test/stdio.test.mjs          2 例真子进程端到端
```
