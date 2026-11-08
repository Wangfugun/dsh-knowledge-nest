# packages/mcp-server 现状盘点（Cherry Studio 适配前）

> 本文是适配的**事实基础**。所有结论都来自读代码或实跑，不是推测。
> 实测环境：Windows，Node v24.19.0，包路径 `D:\dsh-workspace\knest-v2\packages\mcp-server`。

---

## 一、入口与启动命令

| 项 | 事实 |
|---|---|
| 入口文件 | `src/index.js`（ESM，带 `#!/usr/bin/env node`） |
| 启动命令 | `node <绝对路径>\src\index.js` |
| 是否需要 `--stdio` 之类的参数 | **不需要**，无参数启动即进入 stdio 模式 |
| bin 入口 | `"knest-mcp": "src/index.js"`，装成全局后可直接 `knest-mcp` |
| 传输 | 代码里硬编码 `StdioServerTransport`，没有别的传输方式可选 |

**实测**：从包目录启动、从 `C:\Windows` 启动，两次都正常完成 initialize 与 tools/list。说明**不依赖 cwd**，Cherry 用任意工作目录拉起都能跑。

---

## 二、运行时与构建

| 项 | 事实 |
|---|---|
| 语言 | 纯 JavaScript，`"type": "module"` |
| 构建步骤 | **没有**。无 `tsconfig.json`，`src/` 下 4 个 `.js`、0 个 `.ts` |
| 预构建产物 | 不需要，源码即产物 |
| Node 要求 | `"engines": { "node": ">=20" }`，实测 v24.19.0 |
| 依赖是否就位 | 已装，92 个包 |

依赖版本（实测）：

```
@modelcontextprotocol/sdk  1.32.2
zod                        3.25.76
```

**这是适配的关键前提**：Cherry Studio 拉子进程时**不会替你 `npm install`。所以 `node_modules` 必须已经躺在那儿，或者随包分发时带上。当前它已存在于包目录，直接可用；将来要分发，得把 `node_modules` 一起打进去，或者提供一个安装脚本。

---

## 三、环境变量清单

### 模型的钥匙与端点

| 变量 | 作用 | 默认 |
|---|---|---|
| `DEEPSEEK_API_KEY` | DeepSeek 的钥匙 | 无 |
| `OPENAI_API_KEY` | 任意 OpenAI 兼容接口的钥匙 | 无 |
| `OPENAI_BASE_URL` | 接口地址 | 只给 `OPENAI_API_KEY` 时兜底 `https://api.openai.com/v1` |
| `DEEPSEEK_BASE_URL` | DeepSeek 地址 | `https://api.deepseek.com` |
| `OPENAI_MODEL` | 模型名 | 非 DeepSeek 端点**必须显式给** |
| `DEEPSEEK_MODEL` | 模型名 | `deepseek-flash`，备用 `deepseek-v4-pro` |

**三元组取自同一层**：给了哪一家的 key，就走那一家的地址与默认模型，不会出现「DeepSeek 的钥匙配别家的模型名」。

### provider 预设

| 变量 | 取值 | 效果 |
|---|---|---|
| `KNEST_PROVIDER` | `ollama` | 端点 `http://127.0.0.1:11434/v1`，钥匙自动填 `ollama` |
| | `lmstudio` | 端点 `http://127.0.0.1:1234/v1` |
| | `vllm` | 端点 `http://127.0.0.1:8000/v1` |

本地端点（`127.0.0.1`、`localhost`、`::1`）**不需要真钥匙**，代码里会自动放行。

### 数据目录与调参

| 变量 | 作用 | 默认 |
|---|---|---|
| `KNEST_HOME` | 配置与缓存的根目录 | `~/.knest` |
| `KNEST_CONFIG` | 直接指定配置文件 | `$KNEST_HOME/config.json` |
| `KNEST_MAX_TOKENS` | 单次回答上限 | 700 |
| `KNEST_TIMEOUT_MS` | 请求超时 | 45000 |

### 一个必须处理的问题

实测启动日志打出来是：

```
[knowledge-nest] home:   C:\Users\Administrator\.knest
```

**默认 home 落在 C 盘。** 本机有「C 盘零增写」的硬规定，所以 Cherry 的配置里**必须显式设 `KNEST_HOME`** 到 D 盘，否则缓存会写到 `C:\Users\Administrator\.knest\explain-cache.json`。

---

## 四、stdout 与 stderr 策略

实测（一次 initialize 加一次 tools/list）：

```
stdout 行数        2
非 JSON-RPC 行数   0
stderr 行数        3
```

stdout 两行分别是 initialize 的响应与 tools/list 的响应，**没有任何多余输出**；三行日志全部走 stderr：

```
[knowledge-nest] MCP server ready
[knowledge-nest] home:   ...
[knowledge-nest] config: ...
```

结论：**符合 stdio 契约**，Cherry 不会因为 stdout 污染而解析失败。

---

## 五、工具列表

当前只暴露一个工具。

| 字段 | 内容 |
|---|---|
| 名字 | `knowledge_nest_explain` |
| 标题 | `Explain a phrase inside a conversation` |
| 描述 | 英文，说明「解释一个词在**给定对话里**的意思，而不是词典义」，并列出返回结构（语境释义、依据引用、其他读法、相关概念、置信度）与四种 mode |
| 入参 | `text`（必填，≤200 字）、`context`（可选，≤8000 字）、`mode`（可选，四选一） |
| 出参 | `ok`（布尔）、`card`（成功时的结构卡片）、`code`（失败码）、`message`（失败说明） |
| 注解 | `readOnlyHint: true`、`openWorldHint: true` |
| 输出 schema | 有，`card` 的字段全部显式声明，不是自由对象 |

工具名与描述来自 `src/server.js` 的常量，稳定；描述改了会影响模型是否愿意调用。

**一个观察**：描述是**英文**，而 Cherry Studio 是中文界面、用户用中文提问。模型沿英文描述理解没问题，但中文客户端里显示会比较突兀，是否补一版中文描述，属于适配层可做的包装，不影响核心逻辑。

---

## 六、无钥匙时的行为

实测（清空环境变量，只留 PATH 与 KNEST_HOME 后调 tools/call）：

```json
{
  "isError": false,
  "payload": {
    "ok": false,
    "code": "no-key",
    "message": "没找到 key：设 DEEPSEEK_API_KEY（或 OPENAI_API_KEY），或写进 $KNEST_HOME/config.json 的 apiKey"
  }
}
```

两个要点：

1. **失败写在返回值里，协议层是成功**（`isError: false`）。Cherry 会把这段 JSON 原样显示给模型，模型能读到 code 与 message。
2. 缺 key、缺地址、缺模型名各有各的 code（`no-key` / `no-base-url` / `no-model`），排错时看 code 就知道卡在哪一步。

---

## 七、给 Cherry Studio 的配置模板

基于以上事实，Cherry 里应该这样填（`command` 用 `node` 的绝对路径更稳）：

```json
{
  "mcpServers": {
    "knowledge-nest": {
      "command": "C:\\Program Files\\nodejs\\node.exe",
      "args": ["D:\\dsh-workspace\\knest-v2\\packages\\mcp-server\\src\\index.js"],
      "env": {
        "KNEST_HOME": "D:\\dsh-cache\\knest",
        "DEEPSEEK_API_KEY": "sk-你的钥匙"
      }
    }
  }
}
```

想用本机免费模型，把 env 换成：

```json
{
  "KNEST_HOME": "D:\\dsh-cache\\knest",
  "KNEST_PROVIDER": "ollama",
  "OPENAI_MODEL": "qwen2.5:7b",
  "KNEST_TIMEOUT_MS": "120000"
}
```

---

## 八、适配层做了什么（已落地）

| 编号 | 事项 | 落地方式 |
|---|---|---|
| A1 | 默认 `KNEST_HOME` 落 C 盘 | `model.js` 新增 `isOnSystemDrive()` 与 `startupDiagnostics()`，启动时往 stderr 打醒目提醒；默认值不变，跨平台语义不动 |
| A2 | 工具描述只有英文 | `server.js` 的 title 与 description 改成中英双语，并补上「何时用 / 何时不用」；工具名、入参、出参一字未改 |
| A3 | `node_modules` 必须随包 | 新增 `tools/pack.mjs`，把源码、`lib/`、`client/card.js`、`client/util.js`、`node_modules` 一起打进可分发的目录，并顺手改写跨包导入 |
| A4 | 缺一键自检 | 新增 `tools/selfcheck.mjs`，13 项检查，退出码 0/1/2 可当健康检查用 |
| A5 | Cherry 的配置字段名 | 仍待实机确认；自检产出的 JSON 用的就是 `command` / `args` / `env`，与 Claude Desktop 一致 |

### 新增的入口能力

| 命令 | 作用 |
|---|---|
| `node src/index.js` | 正常 stdio 模式，行为不变 |
| `node src/index.js --help` | 打印用法、当前配置来源、需要注意的点（走 stderr，不进 stdout） |
| `node src/index.js --version` | 打印 `knowledge-nest 0.1.0` |

其它任何参数都会被忽略，客户端塞 `--stdio` 之类不会报错。

### 自检脚本的十三项

静态四项：Node 版本、入口存在、依赖已装、无构建步骤。

协议八项：initialize 有响应、stdout 全是 JSON-RPC、至少一个工具、工具名正确、描述非空、描述含中文、有输出 schema、入参含 text。

可选一项：`--call` 时真调一次（轮询等结果，最多 60 秒）。

实测（带真实钥匙）：13 项全过，模型 `deepseek-flash`，2527ms，退出码 0。

### 打包产物的结构

```
dist/knest-mcp/
  src/                 入口与工具实现
  lib/                 从仓库根复制过来的纯逻辑（explain / cache / gate / prompt / shape / errors / key）
  client/              card.js 与 util.js（卡片视图模型）
  node_modules/        运行时依赖，客户端不会替你装
  tools/selfcheck.mjs  在客户端机器上也能跑
  cherry-config.json   填好 command/args 的客户端配置
  怎么用.md            三步接入与排错表
```

打包时会把 `src/server.js`、`src/explain-tool.js` 里的 `../../../lib/` 改写成 `../lib/`，让产物自包含。**只改产物，不动源码**，它在 monorepo 里作为子包仍然原样工作。

实测：3436 个文件，14.2 MB，打包耗时 2.1 秒；产物自检 13 项全过。

---

## 九、复现本文结论的命令

```powershell
# 1. 看入口与依赖
cd D:\dsh-workspace\knest-v2\packages\mcp-server
Get-Content package.json
Test-Path node_modules

# 2. 直连跑一次（手工发 JSON-RPC）
'{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"1"}}}' | node src/index.js

# 3. 官方 Inspector 看工具列表
npx --yes @modelcontextprotocol/inspector --cli node src/index.js --method tools/list

# 4. 看模型端点是否通
KNEST_PROVIDER=ollama OPENAI_MODEL=qwen2.5:7b node tools/check-model.mjs
```
