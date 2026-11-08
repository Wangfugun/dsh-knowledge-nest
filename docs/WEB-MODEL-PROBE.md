# DeepSeek / 豆包网页版接口实测记录

> 测试时间：2026-11-08
> 测试环境：本机 Edge（真实登录态），CDP 接管页面后发请求
> 目的：判断「借用网页版免费额度」这条路能不能走通

---

## 一、结论先说

**DeepSeek 网页版：接口存在、风控可绕，但有一道 PoW 挑战，成本高且脆弱。**

| 层 | 实测结果 |
|---|---|
| 域名 | `chat.deepseek.com` 可达，200 |
| 接口 | `POST /api/v0/chat/completion` 存在 |
| 裸调（无浏览器、无令牌） | **429 Request Blocked**，WAF 页面，不是普通限流 |
| 真实浏览器 + 无 Authorization | 仍然 **429** |
| 真实浏览器 + `Authorization: Bearer <userToken>` | **422**，进入业务逻辑，报「缺 chat_session_id」 |
| PoW 挑战 | `POST /api/v0/chat/create_pow_challenge` 返回 200，算法 `DeepSeekHashV1`，难度 **144000** |
| 页面防护栈 | `fp.min.js`（指纹）+ `smcp.min.js`（顶象风控 SDK）+ rspack 打包 |

**豆包：接口确实存在，但请求体是套娃格式，且需要额外上下文。**

| 项 | 实测结果 |
|---|---|
| 域名 | `www.doubao.com` 可达 |
| 接口 | `POST /samantha/chat/completion` 存在 |
| 裸调 | **400**（不是 403/429，说明没被风控挡，是请求体不对） |
| 首页 | 300 KB，含 `samantha` 字样，未见风控脚本 |

---

## 二、DeepSeek 的完整关卡

从「完全裸调」到「拿到回答」，要过三关：

### 第一关：WAF（已确认能过）

不带 `Authorization` 时，无论从 curl 还是从真实浏览器页面里发，都返回：

```
429  <!DOCTYPE html> ... <title>Error - Request Blocked</title>
```

带上 `localStorage.userToken`（64 字符）后，立刻变成 **422**——说明 WAF 放行，进到了业务层。

**这一关靠的是登录令牌，不难。**

### 第二关：请求体（已确认字段名）

422 的报错很直白：

```
Failed to deserialize the JSON body into the target type: missing field `chat_session_id`
```

字段名是 `chat_session_id`（下划线风格），不是常见的驼峰。

### 第三关：PoW（真正的门槛）

调用 `POST /api/v0/chat/create_pow_challenge`（带令牌）返回：

```json
{
  "code": 0,
  "data": {
    "biz_data": {
      "challenge": {
        "algorithm": "DeepSeekHashV1",
        "challenge": "7ddd9c61...b8a8",
        "salt": "0f472332181882bf9b64",
        "signature": "9d59c64b...bcef",
        "difficulty": 144000,
        "expire_at": 1794123515212,
        "expire_after": 300000,
        "target_path": "/api/v0/chat/completion"
      }
    }
  }
}
```

`difficulty: 144000` 意味着要算约十四万四千次哈希，找到一个满足条件的解，再把它塞进请求头（通常是 `x-ds-pow-response`）。

**算法 `DeepSeekHashV1` 不在 `main.js` 里。** 实测 main.js 有 1.6 MB，搜不到这个字符串，说明它在懒加载的 chunk 或 wasm 里。

---

## 三、为什么这道关不好过

1. **要先把算法挖出来**。得扒 rspack 的 chunk 映射，找到那个模块，可能还要还原它用的 sha3 变体。
2. **每次请求都要现算**。14.4 万次哈希，在 JS 里大概几百毫秒到几秒；词林是「圈一个词就发一次」，这个延迟会明显拖慢交互。
3. **站点一更新就废**。算法、难度、字段名任何一处变了，代码立刻失效，而且失效方式是静默出错。
4. **还有指纹层**。页面挂了顶象的 `smcp.min.js` 和 `fp.min.js`，就算 PoW 过了，指纹不匹配也可能被限。

---

## 四、豆包的情况

裸调 `POST https://www.doubao.com/samantha/chat/completion` 返回 **400**，不是 403 也不是 429——说明**没有把路堵死**，只是我们给的请求体不对。

已知它的消息格式是套娃的：

```json
{
  "messages": [
    { "content": "{\"text\":\"你好\"}", "content_type": 2001, "role": "user" }
  ],
  "conversation_id": "0",
  "local_conversation_id": "local",
  "local_message_id": "m1"
}
```

也就是 `content` 字段本身是一段 JSON 字符串。还缺什么（设备 ID、会话签名、`msToken` 之类）没测出来。

豆包这条路的**门槛比 DeepSeek 低**（没看到明显的风控脚本），但同样需要登录态，同样会因为改版失效。

---

## 五、我的判断

**不建议把「网页版免费额度」做成正式功能。** 理由是：

- 收益：省下一把 API key 的钱（DeepSeek 官方价格本来就低，一次解释约 800 token）
- 成本：逆向 PoW + 维护 + 每次请求多几百毫秒到几秒
- 风险：账号风控、随时失效、出问题时表现为「莫名其妙不工作」

**更划算的替代方案**（都不需要逆向）：

| 方案 | 成本 | 稳定性 | 速度 |
|---|---|---|---|
| 本机 Ollama（`qwen2.5:7b`） | 0 元，占一点显存 | 稳，不会失效 | 中等，7B 在消费级显卡上 1-3 秒 |
| DeepSeek 官方 API | 约 0.001 元/次 | 稳 | 快 |
| 硅基流动等第三方免费额度 | 0 元（有额度上限） | 较稳 | 快 |

词林已经在配置面板里支持前两种，第三个只要在「其他 OpenAI 兼容接口」里填地址与 key 就行。

---

## 六、如果坚持要做

记录一下施工顺序，将来真要做时不用重测：

1. 从 `fe-static.deepseek.com/chat/static/` 下抓全部 chunk，grep `DeepSeekHashV1`，定位模块
2. 还原算法：输入 `salt + challenge + answer`，输出满足 `hash < 2^256 / difficulty` 的 answer
3. 把 answer 按站点格式编码进 `x-ds-pow-response` 头
4. 用 CDP 在登录态页面里发请求（复用 cookie 与指纹）
5. 处理 SSE 流式响应，拼成完整文本
6. 加缓存：同一个词不重复请求

第 4 步必须在真实浏览器上下文里跑，因为指纹和 cookie 都在那儿——所以它天然依赖「浏览器开着且登录着」这个前提。

---

## 七、这次实测用到的方法（可复用）

```js
// 连上已登录的浏览器页面，在页面上下文里发请求
const list = await (await fetch('http://127.0.0.1:9333/json/list')).json();
const page = list.find((x) => x.type === 'page' && x.url.includes('deepseek'));
const ws = new WebSocket(page.webSocketDebuggerUrl);
// ... Runtime.evaluate 里 fetch，自动带上 cookie 与指纹
```

关键点：**在页面里 `fetch` 而不是从 Node 发**，这样 Origin、Cookie、指纹、TLS 指纹全都是真的，能准确区分「风控挡死」和「缺参数」。
