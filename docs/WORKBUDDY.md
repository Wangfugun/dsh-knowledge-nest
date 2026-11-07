# 在 WorkBuddy 里用词林

先说清楚能到什么程度，免得白折腾。

**能做**：把词林的解释能力接成 WorkBuddy 的「自定义连接器」，让它在任务里帮你解释某个词在这段对话里指什么。

**做不到**：右键圈词、绿字高亮、知识树画布、批注气泡。WorkBuddy 只对外开放连接器、技能、Buddy 应用、小程序四种扩展形态，没有一种能碰对话正文的 DOM，也没有注入 CSS 或脚本的入口。

原因不复杂：这些交互需要一个能被我们自由绘制的页面，而 WorkBuddy 把聊天界面关在它自己的壳里。

---

## 免费算力怎么来

解释请求默认走 DeepSeek 的付费接口。可以换成**本机跑的模型**，一分钱不花，也不出网。

支持三种本地端点，装一个就行：

| 端点 | 默认地址 | 装法 |
| --- | --- | --- |
| Ollama | `http://127.0.0.1:11434/v1` | 官网下载安装，`ollama pull qwen2.5:7b` |
| LM Studio | `http://127.0.0.1:1234/v1` | 官网下载，界面里启动本地服务 |
| vLLM | `http://127.0.0.1:8000/v1` | 自己部署 |

本地端点**不需要钥匙**，插件会自动放行（以前会报「没有钥匙」，这是这版改的）。

先用一条命令确认它能用：

```bash
cd packages/mcp-server
KNEST_PROVIDER=ollama OPENAI_MODEL=qwen2.5:7b node tools/check-model.mjs
```

它会把端点、模型、耗时、返回的前三百个字符打出来。跑通了再往下。

---

## 装进 WorkBuddy

打开 WorkBuddy，左侧「专家·技能·连接器」→ 连接器页签 → 右上角「自定义连接器」，粘这段：

```json
{
  "mcpServers": {
    "knowledge-nest": {
      "type": "stdio",
      "command": "node",
      "args": ["C:\\Users\\Administrator\\Documents\\deepseek-harness\\default-workspace\\knest-v2\\packages\\mcp-server\\src\\index.js"],
      "env": {
        "KNEST_PROVIDER": "ollama",
        "OPENAI_MODEL": "qwen2.5:7b",
        "KNEST_TIMEOUT_MS": "120000"
      }
    }
  }
}
```

要点：

- `args` 里的路径换成你自己机器上的绝对路径，别抄这段；
- 本地模型慢，`KNEST_TIMEOUT_MS` 给到 12 万毫秒比较稳；
- 想用付费接口就把 `KNEST_PROVIDER` 去掉，换成 `DEEPSEEK_API_KEY`，二者互斥。

装好之后在会话里说一句：

```text
用 knowledge-nest 解释一下「闸门」在这次任务里指什么，上下文是下面这段：
（把相关几句话贴上）
```

模型会调用 `knowledge_nest_explain`，返回一张解释卡片的文本版：语境释义、依据引文、可继续展开的词。

---

## 会踩的坑

**连接器不认 stdio**。WorkBuddy 的文档只说「配置方式与 MCP 配置类似」，把读者指向 IDE 那份 MCP 文档，而那份文档里的例子是 `type: stdio` 加 `command`/`args`/`env`。这是目前唯一的依据，**没有针对 WorkBuddy 客户端的官方说明**。如果它只认远程端点，就得把 MCP server 挂到一个 HTTPS 地址上再填进来。

**模型不主动调工具**。没有圈选手势，你得在话里点名让模型去调。第一次没反应就把句子说死一点：先给上下文，再说「用 knowledge-nest 解释 X」。

**回复是纯文本**。工具返回 JSON，WorkBuddy 会把它渲染成一段文本或表格，不会有我们那个卡片外观。

**积分照旧消耗**。免费的是解释这一步，任务本身的推理还是走 WorkBuddy 的积分。

---

## 想要完整体验

那就不是接连接器的事了。两条路：

1. **浏览器扩展**：把圈选、画布、批注做进网页版聊天，那边我们拿得到 DOM；
2. **独立网页**：左边贴对话或拖文件，右边是我们的画布，完全不依赖任何客户端。

两条路复用同一套 `client/` 代码，不用重写解释逻辑。
