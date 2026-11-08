#!/usr/bin/env node
/**
 * 打包成「可直接给 MCP 客户端用」的目录。
 *
 * 为什么需要它：Cherry Studio / Claude Desktop 拉起 stdio server 时**不会**替你
 * `npm install`，所以 node_modules 必须已经在包里。这个脚本把源码、依赖、自检脚本
 * 一起复制到一个干净目录，并生成一份填好的客户端配置。
 *
 * 用法：
 *   node tools/pack.mjs                输出到 dist/knest-mcp
 *   node tools/pack.mjs --out=D:\x     指定输出目录
 *   node tools/pack.mjs --zip          额外打一个 zip
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, '..');
const argv = process.argv.slice(2);
const outArg = argv.find((a) => a.startsWith('--out='));
const outDir = outArg ? outArg.slice('--out='.length) : join(PKG, 'dist', 'knest-mcp');
const wantZip = argv.includes('--zip');

if (!existsSync(join(PKG, 'node_modules', '@modelcontextprotocol', 'sdk'))) {
  console.error('依赖没装，先在这个目录跑 npm install');
  process.exit(1);
}

console.log(`输出目录 ${outDir}`);
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

/* 1. 源码与元数据 */
const items = ['src', 'package.json', 'README.md'];
for (const item of items) {
  const from = join(PKG, item);
  if (!existsSync(from)) continue;
  cpSync(from, join(outDir, item), { recursive: true });
}
mkdirSync(join(outDir, 'tools'), { recursive: true });
cpSync(join(PKG, 'tools', 'selfcheck.mjs'), join(outDir, 'tools', 'selfcheck.mjs'));
cpSync(join(PKG, 'tools', 'check-model.mjs'), join(outDir, 'tools', 'check-model.mjs'));
cpSync(join(PKG, 'tools', 'setup.mjs'), join(outDir, 'tools', 'setup.mjs'));

/* 1.5 把跨包依赖搬进包里，让产物自包含
 *
 * mcp-server 复用仓库根的两处代码：
 *   lib/*.js        （explain / cache / gate / prompt / shape / errors / key）
 *   client/card.js  （卡片视图模型）
 * 源码里写的是 `../../../lib/...`；打包后层级变浅，必须在产物里把这段路径改写成 `../lib/...`。
 * 只改产物，不动源码——这样它作为 monorepo 子包时仍然正常工作。 */
const REPO = join(PKG, '..', '..');
cpSync(join(REPO, 'lib'), join(outDir, 'lib'), {
  recursive: true,
  filter: (src) => !src.endsWith('.md'),
});
mkdirSync(join(outDir, 'client'), { recursive: true });
cpSync(join(REPO, 'client', 'card.js'), join(outDir, 'client', 'card.js'));
cpSync(join(REPO, 'client', 'util.js'), join(outDir, 'client', 'util.js'));

const rewrite = (file) => {
  const before = readFileSync(file, 'utf8');
  const after = before
    .replace(/(['"])\.\.\/\.\.\/\.\.\/lib\//gu, '$1../lib/')
    .replace(/(['"])\.\.\/\.\.\/\.\.\/client\//gu, '$1../client/');
  if (after !== before) {
    writeFileSync(file, after, 'utf8');
    return true;
  }
  return false;
};
const touched = ['src/server.js', 'src/explain-tool.js', 'src/setup.js'].filter((rel) => rewrite(join(outDir, rel)));
console.log(`已改写跨包导入：${touched.join(', ') || '（无需改写）'}`);

/* 2. 运行时依赖（客户端不会替你装） */
console.log('复制 node_modules …');
cpSync(join(PKG, 'node_modules'), join(outDir, 'node_modules'), { recursive: true });

/* 3. 一份填好的客户端配置 */
const entry = join(outDir, 'src', 'index.js');
const sampleEnv = {
  KNEST_HOME: 'D:\\knest-data',
  DEEPSEEK_API_KEY: '<你的钥匙>',
};
const clientConfig = {
  mcpServers: {
    'knowledge-nest': {
      command: process.execPath,
      args: [entry],
      env: sampleEnv,
    },
  },
};
writeFileSync(join(outDir, 'cherry-config.json'), `${JSON.stringify(clientConfig, null, 2)}\n`, 'utf8');

writeFileSync(join(outDir, '怎么用.md'), `# 怎么把它接进 Cherry Studio

## 1. 先自检

\`\`\`
"${process.execPath}" "${join(outDir, 'tools', 'selfcheck.mjs')}"
\`\`\`

十二项全过（退出码 0）才往下走。若提示「数据目录落在系统盘」，把下面配置里的
KNEST_HOME 改到别的盘再自检。

## 2. 填钥匙：用配置页，不用手改 JSON

把它接进客户端之后（见第 3 步），客户端启动这个 server 时，日志里会多出一行：

\`\`\`
[knowledge-nest] 配置页：http://127.0.0.1:7332/?token=xxxxxxxx
\`\`\`

**把那个地址复制到浏览器打开**，你会看到一个配置页：

- 四个选项：DeepSeek、其他 OpenAI 兼容接口、本机 Ollama、本机 LM Studio
- 选本机模型不用填钥匙，选云端填一把 key
- 点「保存并测试」，它会立刻发一次真实请求，成不成当场就知道
- 保存后**不用重启客户端**，下一次调用就按新配置走

如果找不到那行日志，或者想知道地址，直接在对话里让模型解释一个词：没有钥匙时
它返回的错误里就带着这个地址。

只想用命令行？也可以：

\`\`\`
"${process.execPath}" "${join(outDir, 'tools', 'check-model.mjs')}"
\`\`\`

## 3. 填进客户端

Cherry Studio 的 MCP 设置里添加一个自定义服务器，粘贴 cherry-config.json 的内容：

\`\`\`json
${JSON.stringify(clientConfig, null, 2)}
\`\`\`

要点：

- \`command\` 用 node 的绝对路径，不要写裸 \`node\`（客户端的环境变量未必带你习惯的 PATH）；
- \`args\` 指向本包的 \`src/index.js\`，路径别抄示例，用你实际解压的位置；
- \`env\` 至少要给 KNEST_HOME；钥匙可以不填，用第 2 步的配置页填更省事。

## 4. 用

在对话里说：「用 knowledge-nest 解释一下『某某词』在这段话里的意思，上下文是……」

## 排错

| 现象 | 原因 |
|---|---|
| 客户端里工具列表是空的 | command 路径错，或 node 版本低于 20 |
| 调用返回 no-key | env 里没给钥匙，或 KNEST_HOME 指错了配置文件 |
| 调用返回 no-model | 非 DeepSeek 端点没给 OPENAI_MODEL |
| 超时 | 本地模型慢，调大 KNEST_TIMEOUT_MS |
`, 'utf8');

/* 4. 统计（用原生 readdir，别再拿 PowerShell 逐目录列文件，上万个小文件会拖死） */
import { readdirSync } from 'node:fs';

let files = 0;
let bytes = 0;
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    files += 1;
    try {
      bytes += statSync(full).size;
    } catch {
      /* 忽略统计失败 */
    }
  }
};
walk(outDir);

console.log(`完成：${files} 个文件，${(bytes / 1024 / 1024).toFixed(1)} MB`);
console.log(`客户端配置 ${join(outDir, 'cherry-config.json')}`);

if (wantZip) {
  const zipPath = `${outDir}.zip`;
  try {
    execFileSync('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${outDir}\\*' -DestinationPath '${zipPath}' -CompressionLevel Optimal -Force`], { stdio: 'inherit' });
    console.log(`已打包 ${zipPath}`);
  } catch (error) {
    console.error('打 zip 失败：', String(error.message).slice(0, 200));
  }
}

/* 5. 顺手把版本号打出来，方便贴进 issue */
const pkg = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8'));
console.log(`版本 ${pkg.name}@${pkg.version}`);
