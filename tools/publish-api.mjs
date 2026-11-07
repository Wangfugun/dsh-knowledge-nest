/**
 * 用 GitHub REST API 把本地仓库推上去（git push 的 443 被重置时的替代路线）。
 *
 * 令牌从环境变量 GH_TOKEN 读，绝不打印、不落盘。
 * 用法：node tools/publish-api.mjs <owner> <repo>
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const [owner, repo] = process.argv.slice(2);
const token = process.env.GH_TOKEN;
if (!owner || !repo) { console.error('用法：node tools/publish-api.mjs <owner> <repo>'); process.exit(1); }
if (!token) { console.error('缺少 GH_TOKEN'); process.exit(1); }

const API = 'https://api.github.com';
const headers = {
  authorization: `token ${token}`,
  accept: 'application/vnd.github+json',
  'user-agent': 'knest-publish',
  'content-type': 'application/json',
};

async function call(method, path, body) {
  const res = await fetch(`${API}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${method} ${path} ${res.status}: ${text.slice(0, 300)}`);
  }
  return text === '' ? {} : JSON.parse(text);
}

/* 1. 列出受版本控制的文件 */
const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter((item) => item !== '');

console.log(`文件数 ${files.length}`);

/* 2. 并发上传 blob（每批 6 个，别把 API 打疼） */
const tree = [];
const BATCH = 6;
for (let index = 0; index < files.length; index += BATCH) {
  const slice = files.slice(index, index + BATCH);
  const done = await Promise.all(slice.map(async (path) => {
    const content = readFileSync(path);
    const blob = await call('POST', `/repos/${owner}/${repo}/git/blobs`, {
      content: content.toString('base64'),
      encoding: 'base64',
    });
    return { path, mode: '100644', type: 'blob', sha: blob.sha };
  }));
  tree.push(...done);
  process.stdout.write(`\r已上传 ${Math.min(index + BATCH, files.length)}/${files.length}`);
}
console.log('');

/* 3. 建树与提交 */
const rootTree = await call('POST', `/repos/${owner}/${repo}/git/trees`, { tree });
const message = execFileSync('git', ['log', '-1', '--pretty=%B'], { encoding: 'utf8' }).trim();
const commit = await call('POST', `/repos/${owner}/${repo}/git/commits`, {
  message,
  tree: rootTree.sha,
  parents: [],
});

/* 4. 指向 main */
try {
  await call('PATCH', `/repos/${owner}/${repo}/git/refs/heads/main`, { sha: commit.sha, force: true });
} catch {
  await call('POST', `/repos/${owner}/${repo}/git/refs`, { ref: 'refs/heads/main', sha: commit.sha });
}

/* 5. 打 v2.0.0 标签（附注标签） */
const tagObj = await call('POST', `/repos/${owner}/${repo}/git/tags`, {
  tag: 'v2.0.0',
  message: '词林 2.0.0',
  object: commit.sha,
  type: 'commit',
});
try {
  await call('POST', `/repos/${owner}/${repo}/git/refs`, { ref: 'refs/tags/v2.0.0', sha: tagObj.sha });
} catch (error) {
  console.log('标签已存在或创建失败：', String(error.message).slice(0, 120));
}

console.log('commit', commit.sha);
console.log(`https://github.com/${owner}/${repo}`);
