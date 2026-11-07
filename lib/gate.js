/**
 * 并发闸门：最多 3 个请求同时在路上，同一次圈词只发一次。
 *
 * 为什么要有它：拖选很容易手滑连出三四次；DeepSeek 侧也有速率。三件事一起做——
 *   1. **同 key 单飞**：同一个 `词+对话指纹` 在飞时，后来的调用共享同一个 Promise；
 *   2. **并发上限**：超过就排队，不 reject（用户不该看到"太挤了"）；
 *   3. **起步间隔**：两次真正出网之间至少隔 `minGapMs`，避免瞬时打满。
 *
 * 纯内存、无依赖、不 throw：任务失败只会让该次调用 reject。
 */

/**
 * 造一个闸门。
 * @param {{maxActive?:number, minGapMs?:number, now?:()=>number}} [options] - 策略。
 * @returns {{run:(key:string, task:()=>Promise<any>)=>Promise<any>, stats:()=>object}} 闸门句柄。
 */
export function createGate(options = {}) {
  const maxActive = Number.isFinite(options.maxActive) ? Math.max(1, options.maxActive) : 3;
  const minGapMs = Number.isFinite(options.minGapMs) ? Math.max(0, options.minGapMs) : 250;
  const now = typeof options.now === 'function' ? options.now : Date.now;

  /** @type {Map<string, Promise<any>>} */
  const inflight = new Map();
  /** @type {{key:string, task:Function, resolve:Function, reject:Function}[]} */
  const queue = [];
  let active = 0;
  let peakActive = 0;
  let done = 0;
  let failed = 0;
  let lastStartAt = 0;
  let timer = null;

  const start = (job) => {
    active += 1;
    if (active > peakActive) peakActive = active;
    lastStartAt = now();
    let pending;
    try {
      pending = Promise.resolve(job.task());
    } catch (error) {
      pending = Promise.reject(error);
    }
    pending.then(
      (value) => {
        done += 1;
        job.resolve(value);
      },
      (error) => {
        failed += 1;
        job.reject(error);
      },
    ).finally(() => {
      active -= 1;
      if (inflight.get(job.key) !== undefined) inflight.delete(job.key);
      pump();
    });
  };

  const pump = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    while (queue.length > 0 && active < maxActive) {
      const wait = lastStartAt + minGapMs - now();
      if (wait > 0) {
        timer = setTimeout(() => {
          timer = null;
          pump();
        }, wait);
        if (typeof timer?.unref === 'function') timer.unref();
        return;
      }
      const job = queue.shift();
      if (job === undefined) return;
      start(job);
    }
  };

  return {
    /**
     * 排队执行。
     * @param {string} key - 去重键（`词+指纹`）。
     * @param {() => Promise<any>} task - 真正干活的函数。
     * @returns {Promise<any>} 任务结果。
     */
    run(key, task) {
      const dedupeKey = typeof key === 'string' ? key : '';
      if (dedupeKey !== '' && inflight.has(dedupeKey)) return inflight.get(dedupeKey);
      const promise = new Promise((resolve, reject) => {
        queue.push({ key: dedupeKey, task, resolve, reject });
        pump();
      });
      if (dedupeKey !== '') inflight.set(dedupeKey, promise);
      return promise;
    },
    /**
     * 统计。
     * @returns {{active:number,peakActive:number,queued:number,done:number,failed:number,maxActive:number}} 快照。
     */
    stats() {
      return { active, peakActive, queued: queue.length, done, failed, maxActive };
    },
  };
}
