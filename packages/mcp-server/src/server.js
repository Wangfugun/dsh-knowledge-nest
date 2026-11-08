/**
 * MCP Server：把 `knowledge_nest_explain` 注册成一个 tool。
 *
 * 传输在 `index.js` 里接（stdio）；这里只造 server，方便单测用内存传输或直接调 handler。
 *
 * 与 DSH 插件的关系：**不共享进程、不读 DSH_HOME、不读 .credentials.yaml**。
 * 复用的是 `lib/` 里的纯逻辑（explain / cache / gate / prompt / shape / errors）与
 * `client/card.js` 的卡片视图模型；配置与钥匙由 `model.js` 自己解析后注入。
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { createExplainer } from '../../../lib/explain.js';
import { MODE_VALUES, TOOL_NAME, runExplainTool } from './explain-tool.js';
import { createModelProvider, resolveModel } from './model.js';

/** 版本号（与 package.json 保持一致，免得客户端缓存对不上）。 */
export const SERVER_VERSION = '0.2.0';

/** 服务名。 */
export const SERVER_NAME = 'knowledge-nest';

/**
 * 调模型前的自检：缺什么就返回什么 code，别让请求发出去才炸。
 * @param {Record<string,string|undefined>} env - 环境变量。
 * @returns {{ok:false, code:string, message:string}|null} 阻断原因；可继续则 null。
 */
export function precheckModel(env = process.env) {
  const model = resolveModel(env);
  if (model.enabled === false) {
    return { ok: false, code: 'disabled', message: 'config.json 里 enabled=false，功能被关掉了' };
  }
  if (model.apiKey === '') {
    return {
      ok: false,
      code: 'no-key',
      message: '没找到 key：设 DEEPSEEK_API_KEY（或 OPENAI_API_KEY），或写进 $KNEST_HOME/config.json 的 apiKey',
    };
  }
  if (model.baseUrl === '') {
    return { ok: false, code: 'no-base-url', message: '没找到接口地址：设 OPENAI_BASE_URL 或 DEEPSEEK_BASE_URL' };
  }
  if (model.model === '') {
    return { ok: false, code: 'no-model', message: '没找到模型名：设 OPENAI_MODEL 或 DEEPSEEK_MODEL（非 DeepSeek 端点必须显式给）' };
  }
  return null;
}

/**
 * 卡片的结构化契约。
 *
 * 不用 `z.record(z.any())`：那会生成 `additionalProperties: {}`（等于"什么都不约束"），
 * MCP Inspector 的 --strict 会把它记为一条 warning。这里把真实字段写清楚，
 * 客户端因此能直接渲染表单/校验，代价是改 `client/card.js` 时要同步这里。
 */
const cardSchema = z.object({
  phrase: z.string(),
  kind: z.string(),
  lead: z.string(),
  literal: z.string(),
  mode: z.string().describe('explain / rephrase / example / translate'),
  confidence: z.object({ label: z.string(), tone: z.string() }),
  evidence: z.array(z.object({ quote: z.string(), why: z.string() })),
  readings: z.array(z.object({ label: z.string(), note: z.string() })),
  tree: z.array(z.object({
    label: z.string(),
    note: z.string(),
    children: z.array(z.object({ label: z.string(), note: z.string() })),
  })),
  meta: z.object({
    count: z.number(),
    model: z.string(),
    cached: z.boolean(),
    ms: z.number(),
    usage: z.object({ prompt: z.number(), completion: z.number(), total: z.number() }),
  }),
});

/**
 * 造 server。
 * @param {{env?:Record<string,string|undefined>, explainer?:object}} [options] - 注入点（测试用）。
 * @returns {McpServer} 已注册好 tool 的 MCP server（尚未 connect）。
 */
export function createKnestServer(options = {}) {
  const env = options.env ?? process.env;
  const explainer = options.explainer ?? createExplainer({ provider: createModelProvider(env), env });

  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  server.registerTool(
    TOOL_NAME,
    {
      title: '解释对话里的词 / Explain a phrase in conversation',
      description:
        '解释一个词或一句话在给定对话里的意思，而不是词典义。'
        + '把用户圈出的文字和前后对话一起传进来，它返回一张结构化卡片：语境释义、依据引用、其他读法、相关概念、置信度。'
        + '何时用它：用户问“这个词在这里是什么意思”“这句话怎么理解”“换个说法”“举个例子”“翻译一下”，'
        + '而上下文明显示意偏向某个专业或私人语境时。'
        + '何时不用：查字典式的通用释义、需要联网查资料、需要改写整篇文章。'
        + '四种模式：explain 语境释义（默认）/ rephrase 换个说法 / example 举个例子 / translate 翻译（中英互译）。'
        + 'English: explain what a word or sentence means inside the given conversation, '
        + 'returning contextual meaning, evidence quotes, alternative readings, related concepts and a confidence level. '
        + 'Modes: explain (default), rephrase, example, translate.',
      inputSchema: {
        text: z.string().min(1).describe('圈出来的词或句子（纯文本，≤200 字）'),
        context: z.string().optional().describe('前后几条对话拼成的纯文本，越贴近原文越好（≤8000 字）'),
        mode: z.enum(MODE_VALUES).optional().describe('explain=语境释义（默认）/ rephrase=换个说法 / example=举个例子 / translate=翻译'),
      },
      outputSchema: {
        ok: z.boolean().describe('是否成功'),
        card: cardSchema.optional().describe('成功时的解释卡片'),
        code: z.string().optional().describe('失败时的机器可读错误码'),
        message: z.string().optional().describe('失败时的人话说明'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async (args) => {
      const result = await runExplainTool(explainer, args, { precheck: () => precheckModel(env) });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },
  );

  return server;
}
