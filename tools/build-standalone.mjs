/**
 * 打包独立版：把与宿主无关的模块拼成一份可直接注入页面的脚本。
 *
 * 用法：node tools/build-standalone.mjs
 * 产出：client-standalone.js
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

/** 只含与宿主无关的模块；view.js（需要 React）不在此列。 */
const SOURCES = [
  'client/util.js',
  'client/theme.js',
  'client/phrase.js',
  'client/card.js',
  'client/api.js',
  'client/painter.js',
  'client/selector.js',
  'client/menu.js',
  'client/annotate.js',
  'client/tree-board.js',
  'client/styles.js',
  'client/settings.js',
  'client/standalone.js',
];

const strip = (code) => code
  .split('\n')
  .filter((line) => !/^\s*import\s/.test(line))
  .map((line) => line.replace(/^export\s+(const|function|class|async function)/, '$1'))
  .join('\n');

const parts = [];
for (const file of SOURCES) {
  const code = readFileSync(join(ROOT, file), 'utf8');
  parts.push(`/* ===== ${file} ===== */\n${strip(code)}`);
}

const bundle = `/* 词林 独立版（由 tools/build-standalone.mjs 生成，勿手改） */
(function () {
${parts.join('\n\n')}

  window.__knestMount = function (options) {
    return mountKnest(Object.assign({ appName: 'Cherry Studio' }, options || {}));
  };
})();
`;

writeFileSync(join(ROOT, 'client-standalone.js'), bundle, 'utf8');
console.log(`client-standalone.js generated: ${bundle.length} bytes`);
