#!/usr/bin/env node
/**
 * 探测器：看看 Cherry 把 Word / PPT / PDF 打开后，页面里到底是什么结构。
 *
 * 为什么需要它：词林的圈选依赖真实 DOM 文本节点。
 * 如果 Cherry 把文档渲染成普通 HTML，圈选直接可用；
 * 如果渲染进 iframe 或 canvas，就得另做适配。
 * 这一步只能看实际页面，猜不出来。
 *
 * 用法：
 *   1. 在 Cherry 里打开一个 Word 或 PPT（拖进去，或者用它的附件入口）
 *   2. 跑：node tools/probe-doc-render.mjs
 *
 * 输出：页面里可选中的文本、iframe 清单、可疑容器，以及一段可读的结论。
 */
const PORT = Number(process.env.PROBE_PORT ?? 9222);

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const pages = list.filter((item) => item.type === 'page' && (item.url ?? '').includes('renderer'));
if (pages.length === 0) {
  console.error('没找到 Cherry 的页面。确认它带 --remote-debugging-port 启动。');
  process.exit(1);
}

console.log(`检查 ${pages.length} 个页面`);
console.log('');

for (const page of pages) {
  let ws;
  try {
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', () => reject(new Error('连不上')), { once: true });
    });
  } catch {
    continue;
  }

  let seq = 0;
  const call = (method, params) => new Promise((resolve, reject) => {
    const id = ++seq;
    const onMsg = (event) => {
      const payload = JSON.parse(event.data);
      if (payload.id !== id) return;
      ws.removeEventListener('message', onMsg);
      payload.error ? reject(new Error(JSON.stringify(payload.error))) : resolve(payload.result);
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });

  /* 用 CDP 的 DOM 能力把所有 frame（含 iframe）一起看 */
  let report;
  try {
    const result = await call('Runtime.evaluate', {
      expression: `(() => {
        const out = { url: location.href, title: document.title };

        /* 1. 页面上能选中多少文本 */
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let textNodes = 0;
        let chars = 0;
        let samples = [];
        while (walker.nextNode()) {
          const node = walker.currentNode;
          const t = (node.textContent || '').trim();
          if (t.length < 4) continue;
          const el = node.parentElement;
          if (!el || el.closest('#knest-board, .knest-settings, .knest-edge-tab, script, style')) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          const box = range.getBoundingClientRect();
          if (box.width < 2 || box.height < 2) continue;
          textNodes += 1;
          chars += t.length;
          if (samples.length < 5) samples.push(t.slice(0, 40));
        }
        out.selectable = { textNodes, chars, samples };

        /* 2. iframe 清单：跨域的圈不到，同源的可以 */
        out.iframes = [...document.querySelectorAll('iframe')].map((el) => {
          let sameOrigin = false;
          let innerText = 0;
          try {
            const d = el.contentDocument;
            sameOrigin = d !== null && d !== undefined;
            innerText = sameOrigin ? (d.body?.innerText || '').length : 0;
          } catch {
            sameOrigin = false;
          }
          return { src: (el.src || '').slice(0, 80), sameOrigin, innerChars: innerText };
        });

        /* 3. 可疑的文档渲染容器 */
        out.candidates = ['canvas', '.docx', '[class*="doc"]', '[class*="office"]', '[class*="preview"]', '[class*="file-view"]', '[class*="pdf"]']
          .map((sel) => ({ sel, count: document.querySelectorAll(sel).length }))
          .filter((item) => item.count > 0);

        /* 4. 页面上有没有 Word/PPT 的痕迹（标题、文件名） */
        out.hints = /\\.(docx?|pptx?|xlsx?|pdf)/i.test(document.body.innerText || '')
          || /\\.(docx?|pptx?|xlsx?|pdf)/i.test(location.href);

        return JSON.stringify(out);
      })()`,
      returnByValue: true,
      awaitPromise: true,
    });
    report = JSON.parse(result?.result?.value ?? '{}');
  } catch {
    ws.close();
    continue;
  }
  ws.close();

  console.log('─'.repeat(60));
  console.log('页面:', report.title || '(无标题)');
  console.log('地址:', (report.url || '').slice(0, 90));
  console.log('');
  console.log('可选中的文本:', report.selectable?.textNodes, '个节点，共', report.selectable?.chars, '字');
  if ((report.selectable?.samples ?? []).length > 0) {
    for (const line of report.selectable.samples) console.log('   ·', line);
  }
  console.log('');
  if ((report.iframes ?? []).length > 0) {
    console.log('iframe:');
    for (const item of report.iframes) {
      console.log(`   ${item.sameOrigin ? '同源（可圈选）' : '跨域（圈不到）'} ${item.innerChars} 字  ${item.src}`);
    }
  } else {
    console.log('iframe: 没有');
  }
  console.log('');
  if ((report.candidates ?? []).length > 0) {
    console.log('可疑容器:');
    for (const item of report.candidates) console.log(`   ${item.sel} × ${item.count}`);
  }
  console.log('');

  /* 结论 */
  const chars = report.selectable?.chars ?? 0;
  if (chars > 200) {
    console.log('结论：页面上有大量可选文本，词林的圈选应该直接可用。');
  } else if ((report.iframes ?? []).some((item) => item.sameOrigin && item.innerChars > 100)) {
    console.log('结论：正文在 iframe 里，但同源——需要给 selector 加 iframe 支持。');
  } else if ((report.iframes ?? []).some((item) => !item.sameOrigin)) {
    console.log('结论：正文在跨域 iframe 里，圈选拿不到，只能另想别的办法。');
  } else if ((report.candidates ?? []).some((item) => item.sel === 'canvas')) {
    console.log('结论：文档被画在 canvas 上，没有文本节点，圈选做不到。');
  } else {
    console.log('结论：没找到明显的文档内容。确认文件已经打开了。');
  }
  console.log('');
}
