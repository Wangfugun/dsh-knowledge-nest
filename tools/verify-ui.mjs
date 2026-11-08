/**
 * 在真实 Cherry 里验证新界面：
 *   logo 按钮在不在、点开有没有滑块、拖滑块主题会不会真的换。
 */
const PORT = 9222;

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((x) => x.type === 'page' && (x.url || '').includes('renderer'));
if (!page) { console.log('找不到页面'); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => {
  ws.addEventListener('open', r, { once: true });
  ws.addEventListener('error', () => j(new Error('ws')), { once: true });
});

let seq = 0;
const call = (method, params) => new Promise((resolve, reject) => {
  const id = ++seq;
  const onMsg = (event) => {
    const m = JSON.parse(event.data);
    if (m.id !== id) return;
    ws.removeEventListener('message', onMsg);
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
  };
  ws.addEventListener('message', onMsg);
  ws.send(JSON.stringify({ id, method, params }));
  setTimeout(() => reject(new Error('timeout ' + method)), 30000);
});

const ev = async (expr) => {
  const r = await call('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  return r?.result?.value;
};

console.log('=== 1. logo 按钮 ===');
console.log(await ev(`(() => {
  const b = document.querySelector('.knest-logo-btn');
  if (!b) return '没有 logo 按钮';
  const r = b.getBoundingClientRect();
  return JSON.stringify({
    存在: true,
    位置: [Math.round(r.left), Math.round(r.bottom)],
    文字: b.textContent.trim(),
    在左下角: r.left < 100 && r.bottom > window.innerHeight - 100,
  });
})()`));

console.log('\n=== 2. 当前皮肤 ===');
console.log(await ev(`(() => {
  const h = document.documentElement;
  return JSON.stringify({
    skin: h.getAttribute('data-knest-skin'),
    size: h.getAttribute('data-knest-size'),
    depth: h.getAttribute('data-knest-depth'),
    lang: h.getAttribute('data-knest-lang'),
  });
})()`));

console.log('\n=== 3. 点开设置面板 ===');
console.log(await ev(`(() => {
  const b = document.querySelector('.knest-logo-btn');
  if (!b) return '无按钮';
  b.click();
  return '已点击';
})()`));
await new Promise((r) => setTimeout(r, 600));

console.log(await ev(`(() => {
  const p = document.querySelector('.knest-settings');
  if (!p) return '面板没出来';
  const sliders = p.querySelectorAll('.knest-slider');
  const inputs = p.querySelectorAll('input[type=range]');
  return JSON.stringify({
    面板可见: p.getAttribute('data-open'),
    滑块数: sliders.length,
    滑块名: [...sliders].map(s => s.querySelector('.nm')?.textContent),
    当前值: [...inputs].map(i => i.value),
    有预览卡: !!p.querySelector('.knest-set-preview'),
  });
})()`));

console.log('\n=== 4. 拖滑块换皮肤 ===');
console.log(await ev(`(() => {
  const p = document.querySelector('.knest-settings');
  const input = p.querySelectorAll('input[type=range]')[0];
  if (!input) return '没有第一个滑块';
  const before = document.documentElement.getAttribute('data-knest-skin');
  input.value = '1';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  const after = document.documentElement.getAttribute('data-knest-skin');
  return JSON.stringify({ 拖前: before, 拖后: after, 变了: before !== after });
})()`));

console.log('\n=== 5. 换语言看菜单文字 ===');
console.log(await ev(`(() => {
  const p = document.querySelector('.knest-settings');
  const inputs = p.querySelectorAll('input[type=range]');
  const langInput = inputs[inputs.length - 1];
  if (!langInput) return '没有语言滑块';
  langInput.value = '1';
  langInput.dispatchEvent(new Event('input', { bubbles: true }));
  return JSON.stringify({ lang: document.documentElement.getAttribute('data-knest-lang') });
})()`));

console.log('\n=== 6. 卡片样式是否跟着变 ===');
console.log(await ev(`(() => {
  const c = document.querySelector('.knest-tnode');
  if (!c) return '画布上没有卡片（正常，还没圈词）';
  const s = getComputedStyle(c);
  return JSON.stringify({ 圆角: s.borderRadius, 边框: s.borderColor, 背景: s.backgroundColor });
})()`));

ws.close();
