/**
 * 把 client/*.js 拼成浏览器能直接加载的 client.js。
 *
 * 为什么需要这一步：宿主用 `<script src>`（classic script）加载 bundle，
 * 所以 client.js 里不能出现 import/export，也不能 fetch 同目录的兄弟文件。
 * 于是这些 ES 模块在这里被拼进同一个工厂作用域：去掉单行 `import`、去掉 `export ` 前缀，
 * 其余原样保留。
 *
 * 约束（改 client/*.js 时务必遵守，否则打包后会互相覆盖）：
 *  - 顶层声明的名字必须全局唯一（统一前缀见各文件；跨文件不许重名）；
 *  - 不允许 `export default`、不允许 `export { ... }` 列表；
 *  - 模块之间只能靠「函数调用」，不能在顶层取兄弟模块的值。
 *
 * 用法：node tools/build-client.mjs        # 重新生成 client.js
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 拼接顺序：被依赖的放前面（util 是纯工具，最先；view 最后）。 */
const SOURCES = [
  'client/util.js',
  'client/theme.js',
  'client/config.js',
  'client/phrase.js',
  'client/transcript.js',
  'client/store.js',
  'client/api.js',
  'client/layout.js',
  'client/card.js',
  'client/actions.js',
  'client/painter.js',
  'client/annotate.js',
  'client/selector.js',
  'client/styles.js',
  'client/skins.js',
  'client/prefs.js',
  'client/i18n.js',
  'client/lang-picker.js',
  'client/appearance.js',
  'client/look-fab.js',
  'client/menu.js',
  'client/library.js',
  'client/switch.js',
  'client/tree-board.js',
  'client/view.js',
];

/**
 * 不进 DSH 包的模块。
 *
 * - `client/standalone.js`：独立注入版的外壳，不依赖 React，也不该混进 DSH 的 bundle；
 * - `client/settings.js`：设置面板，只有独立版用它（DSH 版走宿主自己的界面）。
 *
 * 这两个由 `tools/build-standalone.mjs` 单独打包成 `client-standalone.js`。
 */
const STANDALONE_ONLY = [
  'client/standalone.js',
  'client/settings.js',
];

/**
 * 装配自检：`client/` 里的每个 .js 要么在 SOURCES 里，要么在 STANDALONE_ONLY 里。
 *
 * 这条是踩过坑之后加的——actions.js 曾经漏登记，bundle 里函数"被引用但未定义"，
 * 点菜单才炸，而所有测试都照常通过。宁可 build 失败，也不要静默生成残缺包。
 *
 * @returns {string[]} 漏登记的文件名；空数组表示齐全。
 */
function missingSources() {
  const dir = path.join(ROOT, 'client');
  const onDisk = fs.readdirSync(dir)
    .filter((name) => name.endsWith('.js'))
    .map((name) => `client/${name}`);
  return onDisk.filter((relative) => !SOURCES.includes(relative) && !STANDALONE_ONLY.includes(relative));
}

const OPEN = `// GENERATED FILE —— 由 tools/build-client.mjs 从 client/*.js 生成，不要手改。
// 改完 client/*.js 后运行：node tools/build-client.mjs
// 契约照 dsh-purge / dsh-video-storyboard：classic script + window.__ModuleLoader__.load；
// 工厂**返回**插件对象（不是 module.exports），require('react') 走平台 seed。
(function () {
  if (typeof window === 'undefined' || !window.__ModuleLoader__) return;
  window.__ModuleLoader__.load({
    id: 'dsh-knowledge-nest',
    factory(require) {
      'use strict';
      const React = require('react');
      const h = React.createElement;
`;

const CLOSE = `      return createPlugin({ h, React });
    },
  });
})();
`;

/**
 * 去掉单行 import 与 export 前缀，把 ES 模块变成同一作用域下的普通声明。
 * @param {string} source - 模块源码。
 * @returns {string} 处理后的源码。
 */
function stripModule(source) {
  return source
    .split('\n')
    .filter((line) => !/^import\s/.test(line))
    .map((line) => line.replace(/^export\s+(?=(?:const|let|var|function|class|async)\s)/u, ''))
    .join('\n')
    .replace(/\s*$/, '\n');
}

/**
 * 生成 client.js 的完整文本。
 * @returns {string} 可直接写入 client.js 的内容。
 */
export function build() {
  const parts = SOURCES.map((relative) => {
    const source = fs.readFileSync(path.join(ROOT, relative), 'utf8');
    return `      /* ===== ${relative} ===== */\n${stripModule(source)
      .split('\n')
      .map((line) => (line === '' ? '' : `      ${line}`))
      .join('\n')}`;
  });
  return `${OPEN}${parts.join('\n')}${CLOSE}`;
}

// CLI：直接写盘
if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const missing = missingSources();
  if (missing.length > 0) {
    console.error(`client/ 里有文件没登记进 SOURCES，拒绝生成残缺包：\n  ${missing.join('\n  ')}`);
    process.exit(1);
  }
  const output = build();
  fs.writeFileSync(path.join(ROOT, 'client.js'), output);
  console.log(`client.js generated: ${output.length} bytes`);
}
