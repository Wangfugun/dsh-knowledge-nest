/**
 * 统一的错误形状。
 *
 * 浏览器侧只按 `code` 决定文案（"没配钥匙""太挤了""模型没给东西"），
 * `message` 只用于日志和排错。**不要把上游原文整段透给前端**——里面可能带请求体。
 */
export class NestError extends Error {
  /**
   * @param {string} code - 机器可读错误码。
   * @param {string} message - 人话说明（可进日志）。
   * @param {{status?:number, detail?:string, retryable?:boolean}} [extra] - 附加信息。
   */
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'NestError';
    this.code = code;
    this.status = Number.isFinite(extra.status) ? extra.status : 0;
    this.detail = typeof extra.detail === 'string' ? extra.detail.slice(0, 400) : '';
    this.retryable = extra.retryable === true;
  }

  /**
   * 给前端的纯数据。
   * @returns {{code:string,message:string,retryable:boolean}} 错误体。
   */
  toJSON() {
    return { code: this.code, message: this.message, retryable: this.retryable };
  }
}

/**
 * 把任意异常收敛成 NestError（路由层兜底用）。
 * @param {unknown} error - 任意异常。
 * @returns {NestError} 归一化错误。
 */
export function asNestError(error) {
  if (error instanceof NestError) return error;
  const message = error !== null && error !== undefined && typeof error.message === 'string'
    ? error.message
    : String(error);
  if (/abort|timeout/iu.test(message)) return new NestError('timeout', '模型响应超时', { retryable: true });
  return new NestError('internal', message, { retryable: true });
}
