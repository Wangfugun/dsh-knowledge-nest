/**
 * 知识库面板：一个可按词/释义/原文/领域搜索的浮层列表。
 *
 * 为什么不是常驻侧栏：宿主右侧已经有自己的轨道，再插一条会把界面挤爆。
 * 这里做**呼出式**面板（`Ctrl+K` 或右侧「知识库」竖条点开），按 Esc 关。
 *
 * 数据来源：`store.cards`（内存）——下一步会换成 host 侧的 cards.jsonl。
 */

/** 面板 id。 */
export const LIBRARY_ID = 'knest-library';

/**
 * 纯函数：在一堆卡片里筛选。
 * @param {object[]} cards - 卡片数组（含 phrase / lead / domain / literal）。
 * @param {string} query - 关键词。
 * @param {{domain?:string}} [filters] - 领域过滤。
 * @returns {object[]} 命中项。
 */
export function searchCards(cards, query, filters = {}) {
  const list = Array.isArray(cards) ? cards : [];
  const needle = typeof query === 'string' ? query.trim().toLowerCase() : '';
  const domain = typeof filters?.domain === 'string' ? filters.domain : '';
  return list.filter((card) => {
    if (card === null || typeof card !== 'object') return false;
    if (domain !== '' && card.domain !== domain) return false;
    if (needle === '') return true;
    const hay = [card.phrase, card.lead, card.literal, card.domain, ...(Array.isArray(card.evidence) ? card.evidence.map((e) => e?.quote ?? '') : [])]
      .filter((item) => typeof item === 'string')
      .join('\n')
      .toLowerCase();
    return hay.includes(needle);
  });
}

/**
 * 造面板。
 * @param {{doc?:Document, onOpen?:Function, getCards?:Function, searchRemote?:Function}} [options] - 依赖。
 *   `searchRemote(q)` 返回 `{ok, rows}`：有 host 存储时用它，否则退回内存里的 `getCards()`。
 * @returns {{toggle:Function, open:Function, close:Function, isOpen:Function, refresh:Function}} 句柄。
 */
export function createLibrary(options = {}) {
  const doc = options.doc ?? (typeof globalThis.document === 'undefined' ? null : globalThis.document);
  const onOpen = options.onOpen;
  const getCards = options.getCards;
  const searchRemote = options.searchRemote;

  let panel = null;
  let input = null;
  let listBox = null;
  let active = 0;
  let rows = [];

  const cardsOf = () => {
    try {
      return typeof getCards === 'function' ? getCards() : [];
    } catch {
      return [];
    }
  };

  const close = () => {
    if (panel !== null && panel.parentNode !== null) panel.parentNode.removeChild(panel);
    panel = null;
    input = null;
    listBox = null;
    rows = [];
    active = 0;
  };

  const pick = (index) => {
    const card = rows[index];
    if (card === undefined) return;
    close();
    try {
      onOpen?.(card);
    } catch {
      /* 忽略 */
    }
  };

  /**
   * 重画列表。
   * @param {string} query - 关键词。
   * @returns {void}
   */
  const renderRemote = (query) => {
    if (typeof searchRemote !== 'function') return;
    Promise.resolve(searchRemote(query)).then((result) => {
      if (result?.ok !== true || !Array.isArray(result.rows)) return;
      if (panel === null || input?.value !== query) return;
      drawRows(result.rows.map((row) => ({
        phrase: row.phrase,
        lead: row.lead,
        domain: row.domain,
      })), query, result.stats?.total);
    }).catch(() => {});
  };

  const drawRows = (list, query, total) => {
    if (listBox === null) return;
    rows = list;
    active = 0;
    listBox.textContent = '';
    const head = doc.createElement('div');
    head.className = 'knest-lib-meta';
    head.textContent = total === undefined ? `${rows.length} 张卡片` : `${rows.length} / ${total} 张卡片`;
    listBox.appendChild(head);
    for (const [index, card] of rows.slice(0, 80).entries()) {
      const row = doc.createElement('button');
      row.className = 'knest-lib-row';
      row.type = 'button';
      row.setAttribute('data-active', index === 0 ? 'true' : 'false');
      const phrase = doc.createElement('span');
      phrase.className = 'knest-lib-phrase';
      phrase.textContent = card.phrase ?? '(无词)';
      const lead = doc.createElement('span');
      lead.className = 'knest-lib-lead';
      lead.textContent = card.lead ?? '';
      row.appendChild(phrase);
      row.appendChild(lead);
      row.addEventListener('click', () => pick(index));
      listBox.appendChild(row);
    }
  };

  const render = (query) => {
    if (listBox === null) return;
    const all = cardsOf();
    const domains = [...new Set(all.map((card) => card?.domain).filter((item) => typeof item === 'string' && item !== ''))];
    rows = searchCards(all, query);
    active = 0;
    listBox.textContent = '';

    const head = doc.createElement('div');
    head.className = 'knest-lib-meta';
    head.textContent = `${rows.length} / ${all.length} 张卡片${domains.length === 0 ? '' : ` · 领域：${domains.join('、')}`}`;
    listBox.appendChild(head);

    for (const [index, card] of rows.slice(0, 60).entries()) {
      const row = doc.createElement('button');
      row.className = 'knest-lib-row';
      row.type = 'button';
      row.setAttribute('data-active', index === 0 ? 'true' : 'false');

      const phrase = doc.createElement('span');
      phrase.className = 'knest-lib-phrase';
      phrase.textContent = card.phrase ?? '(无词)';

      const lead = doc.createElement('span');
      lead.className = 'knest-lib-lead';
      lead.textContent = card.lead ?? '';

      row.appendChild(phrase);
      row.appendChild(lead);
      if (typeof card.domain === 'string' && card.domain !== '') {
        const tag = doc.createElement('span');
        tag.className = 'knest-lib-tag';
        tag.textContent = card.domain;
        row.appendChild(tag);
      }
      row.addEventListener('click', () => pick(index));
      listBox.appendChild(row);
    }
  };

  const open = () => {
    if (doc === null) return;
    if (panel !== null) {
      input?.focus?.();
      return;
    }
    panel = doc.createElement('div');
    panel.id = LIBRARY_ID;
    panel.className = 'knest-lib';
    const box = doc.createElement('div');
    box.className = 'knest-lib-box';

    input = doc.createElement('input');
    input.className = 'knest-lib-input';
    input.type = 'search';
    input.placeholder = '搜词 / 释义 / 原文 / 领域…';
    input.addEventListener('input', () => {
      render(input.value);
      renderRemote(input.value);
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (rows.length === 0) return;
        active = Math.max(0, Math.min(rows.length - 1, active + (event.key === 'ArrowDown' ? 1 : -1)));
        for (const [index, node] of [...listBox.querySelectorAll('.knest-lib-row')].entries()) {
          node.setAttribute('data-active', index === active ? 'true' : 'false');
        }
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        pick(active);
      }
    });

    listBox = doc.createElement('div');
    listBox.className = 'knest-lib-list';

    box.appendChild(input);
    box.appendChild(listBox);
    panel.appendChild(box);
    panel.addEventListener('pointerdown', (event) => {
      if (event.target === panel) close();
    });
    (doc.body ?? doc.documentElement).appendChild(panel);
    render('');
    renderRemote('');
    input.focus?.();
  };

  return {
    open,
    close,
    toggle() {
      if (panel === null) open();
      else close();
    },
    isOpen() {
      return panel !== null;
    },
    refresh() {
      if (panel === null) return;
      render(input?.value ?? '');
    },
  };
}
