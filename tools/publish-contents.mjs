/**
 * 用 Contents API 把仓库内容写上去（空仓库也能用）。
 *
 * 令牌从环境变量 GH_TOKEN 读，绝不打印。
 * 用法：node tools/publish-contents.mjs <owner> <repo>
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const [owner, repo] = process.argv.slice(2);
const token = process.env.GH_TOKEN;
if (!owner || !repo || !token) {
  console.error('用法：GH_TOKEN=xxx node tools/publish-contents.mjs <owner> <repo>');
  process.exit(1);
}

const API = 'https://api.github.com';
const headers = {
  authorization: `token ${token}`,
  accept: 'application/vnd.github+json',
  'user-agent': 'knest-publish',
  'content-type': 'application/json',
};

async function call(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 200)}`);
  }
  return res.status === 204 ? {} : res.json();
}

/** 取远端已有文件的 sha（更新时必需）。 */
async function existingSha(path) {
  try {
    const info = await call('GET', `/repos/${owner}/${repo}/contents/${encodeURI(path)}?ref=main`);
    return typeof info?.sha === 'string' ? info.sha : null;
  } catch {
    return null;
  }
}

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter((item) => item !== '');

console.log(`文件数 ${files.length}`);
let done = 0;
let failed = 0;

for (const path of files) {
  try {
    const content = readFileSync(path);
    const sha = await existingSha(path);
    const body = {
      message: `添加 ${path}`,
      content: content.toString('base64'),
      branch: 'main',
    };
    if (sha !== null) {
      body.sha = sha;
      body.message = `更新 ${path}`;
    }
    await call('PUT', `/repos/${owner}/${repo}/contents/${encodeURI(path)}`, body);
  } catch (error) {
    failed += 1;
    console.log(`\n失败 ${path}: ${String(error.message).slice(0, 160)}`);
  }
  done += 1;
  process.stdout.write(`\r${done}/${files.length}`);
}

console.log(`\n完成 ${done - failed} 个，失败 ${failed} 个`);
console.log(`https://github.com/${owner}/${repo}`);
