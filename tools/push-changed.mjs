/**
 * 只把「本地比远端新的文件」用 Contents API 推上去。
 * 用法：GH_TOKEN=xxx node tools/push-changed.mjs <owner> <repo> <sinceRef>
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const [owner, repo, since] = process.argv.slice(2);
const token = process.env.GH_TOKEN;
if (!owner || !repo || !since || !token) {
  console.error('用法：GH_TOKEN=xxx node tools/push-changed.mjs <owner> <repo> <sinceRef>');
  process.exit(1);
}

const API = 'https://api.github.com';
const headers = {
  authorization: `token ${token}`,
  accept: 'application/vnd.github+json',
  'user-agent': 'knest-push',
  'content-type': 'application/json',
};

async function call(method, path, body) {
  const res = await fetch(`${API}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${(await res.text()).slice(0, 160)}`);
  return res.status === 204 ? {} : res.json();
}

const files = execFileSync('git', ['-c', 'core.quotepath=false', 'diff', '--name-only', since, 'HEAD'], { encoding: 'utf8' })
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line !== '');

console.log('待推文件', files.length);
for (const path of files) {
  const content = readFileSync(path);
  let sha = null;
  try {
    const info = await call('GET', `/repos/${owner}/${repo}/contents/${encodeURI(path)}?ref=main`);
    sha = typeof info?.sha === 'string' ? info.sha : null;
  } catch {
    sha = null;
  }
  const body = { message: `更新 ${path}`, content: content.toString('base64'), branch: 'main' };
  if (sha !== null) body.sha = sha;
  await call('PUT', `/repos/${owner}/${repo}/contents/${encodeURI(path)}`, body);
  console.log('  ok', path);
}
console.log('完成');
