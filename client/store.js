/**
 * 极简订阅 store：视图、浮层各读一份，谁变谁重画。
 *
 * 不用 React 状态：浮层是**宿主文档上的原生 DOM**（不能挂在插件视图的 React 树里，
 * 因为用户在聊天标签页选词时那个视图根本没挂载）。
 */

/**
 * 造 store。
 * @param {object} initial - 初始状态。
 * @returns {{get:Function, set:Function, subscribe:Function, patch:Function}} 句柄。
 */
export function createStore(initial) {
  let state = initial !== null && typeof initial === 'object' ? initial : {};
  const listeners = new Set();

  const emit = () => {
    for (const listener of Array.from(listeners)) {
      try {
        listener(state);
      } catch {
        /* 单个订阅者出错不影响别人 */
      }
    }
  };

  return {
    /**
     * 读当前状态。
     * @returns {object} 状态（只读约定）。
     */
    get() {
      return state;
    },
    /**
     * 合并一层新状态并广播。
     * @param {object} patch - 局部状态。
     * @returns {object} 新状态。
     */
    patch(patch) {
      if (patch === null || typeof patch !== 'object') return state;
      state = { ...state, ...patch };
      emit();
      return state;
    },
    /**
     * 整体替换（少数需要清空历史的场景）。
     * @param {object} next - 新状态。
     * @returns {object} 新状态。
     */
    set(next) {
      state = next !== null && typeof next === 'object' ? next : {};
      emit();
      return state;
    },
    /**
     * 订阅。
     * @param {(state:object)=>void} listener - 回调。
     * @returns {Function} 退订。
     */
    subscribe(listener) {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
