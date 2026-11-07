/**
 * 流程图布局：**会话是一条竖轴，圈过的词是挂在轴上的节点**。
 *
 * 为什么这么排：
 *   - 横轴表示"第几条消息"没有意义（消息长度差太多），竖轴才是时间；
 *   - 词挂在它**第一次出现**的那条消息旁边，一眼看出"这个词是在哪一句里冒出来的"；
 *   - 同一条消息圈了几个词就**竖着错开**，用一根肘形支线串起来。
 *   为什么不是横着排泳道：标签是横排中文，横着排会互相压字（第一版就压了）。
 *
 * 纯函数：给消息与节点，返回坐标；React 只负责画。
 */

/** 几何参数（一处改，全图跟着走）。 */
export const MAP_GEOMETRY = Object.freeze({
  spineX: 22,
  branchX: 36,
  nodeX: 62,
  stackGap: 19,
  minRow: 26,
  maxRow: 64,
  top: 12,
  bottom: 30,
});

/**
 * 单条消息在轴上的高度：按字数长（开方，避免长消息撑爆），但有上下限，
 * 并且必须放得下**挂在这条消息上的所有节点**。
 * @param {string} text - 消息正文。
 * @param {number} count - 挂在这条消息上的节点数。
 * @returns {number} 行高。
 */
function rowHeight(text, count) {
  const length = typeof text === 'string' ? text.length : 0;
  const base = MAP_GEOMETRY.minRow + Math.sqrt(Math.min(length, 1200)) * 1.15;
  const need = count > 0 ? count * MAP_GEOMETRY.stackGap + 10 : 0;
  return Math.min(MAP_GEOMETRY.maxRow + need, Math.max(MAP_GEOMETRY.minRow, base, need));
}

/**
 * 算整张图的坐标。
 * @param {{messages?:object[], nodes?:object[]}} input - 消息与节点。
 *   nodes: `{id, phrase, messageIndex, count, explained}`。
 * @returns {{height:number, ticks:object[], points:object[], stems:object[], branches:object[], edges:object[]}} 布局。
 */
export function layoutMap(input) {
  const messages = Array.isArray(input?.messages) ? input.messages : [];
  const nodes = Array.isArray(input?.nodes) ? input.nodes : [];
  const g = MAP_GEOMETRY;

  /** 先按消息归组，行高要知道每行挂几个节点。 @type {Map<number, object[]>} */
  const groups = new Map();
  for (const node of nodes) {
    if (node === null || typeof node !== 'object') continue;
    const raw = Number.isFinite(node.messageIndex) ? Math.floor(node.messageIndex) : 0;
    const index = messages.length === 0 ? 0 : Math.min(Math.max(raw, 0), messages.length - 1);
    const bucket = groups.get(index) ?? [];
    bucket.push(node);
    groups.set(index, bucket);
  }

  const ticks = [];
  let cursor = g.top;
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    const height = rowHeight(message?.text, groups.get(index)?.length ?? 0);
    ticks.push({
      id: typeof message?.id === 'string' ? message.id : '',
      role: message?.role === 'you' ? 'you' : 'ai',
      y: cursor,
      height,
      center: cursor + height / 2,
      index,
    });
    cursor += height;
  }
  const height = Math.max(cursor + g.bottom, g.top + g.bottom + g.minRow);

  const points = [];
  const stems = [];
  const branches = [];
  const edges = [];

  for (const [index, bucket] of groups) {
    const tick = ticks[index];
    if (tick === undefined) continue;
    const count = bucket.length;
    bucket.forEach((node, order) => {
      const y = tick.center + (order - (count - 1) / 2) * g.stackGap;
      points.push({
        id: String(node.id ?? `${index}-${order}`),
        phrase: typeof node.phrase === 'string' ? node.phrase : '',
        messageIndex: index,
        count: Number.isFinite(node.count) ? node.count : 1,
        kind: typeof node.kind === 'string' ? node.kind : '',
        explained: node.explained === true,
        x: g.nodeX,
        y,
      });
      /* 每一支：从支线到节点圆点前 */
      branches.push({ x1: g.branchX, y1: y, x2: g.nodeX - 7, y2: y });
    });
    /* 主轴到支线的短接 */
    stems.push({ x1: g.spineX, y1: tick.center, x2: g.branchX, y2: tick.center });
    /* 支线本身：把同一行上的几个节点串起来 */
    if (count > 1) {
      const ys = points
        .filter((point) => point.messageIndex === index)
        .map((point) => point.y)
        .sort((left, right) => left - right);
      edges.push({
        x1: g.branchX,
        y1: ys[0],
        x2: g.branchX,
        y2: ys[ys.length - 1],
        kind: 'same',
      });
    }
  }

  return { height, ticks, points, stems, branches, edges };
}
