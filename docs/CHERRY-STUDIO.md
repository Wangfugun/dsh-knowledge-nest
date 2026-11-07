# 在 Cherry Studio 里用词林

Cherry Studio 官方只开放自定义 CSS，没有注入脚本的入口，所以「圈词、绿字、画布、批注」这四件事**不能用它的插件体系实现**。

但它是 Electron 应用（官方仓库的 `package.json` 里就是 Electron 45，主窗口 `contextIsolation: true`、`sandbox: false`、`webSecurity: false`）。这意味着我们有一条官方没写、但确实可用的路：**用调试端口接管渲染进程，把我们自己的界面注进去**。

这条路的三个特点：

- **不改它的安装目录**，不打包、不签名，关掉客户端即恢复原样；
- 注入的代码跑在页面自己的上下文里，圈选、高亮、画布、批注**与 DSH 版完全一致**，用的是同一套模块；
- 缺点：它是调试通道，客户端重启后要重新注入一次。

---

## 一，先起解释服务

词林的解释请求需要一个后端。桌面插件版靠 DSH 的宿主路由，独立版靠这个小服务：

```bash
node tools/serve-standalone.mjs
```

默认监听 `http://127.0.0.1:7331`。钥匙来源和插件一致（环境变量 → 配置文件 → `~/.dsh/.credentials.yaml`）。

**想零成本**，就用本机模型：

```bash
KNEST_PROVIDER=ollama OPENAI_MODEL=qwen2.5:7b node tools/serve-standalone.mjs
```

Windows PowerShell 里写成：

```powershell
$env:KNEST_PROVIDER = 'ollama'
$env:OPENAI_MODEL = 'qwen2.5:7b'
node tools/serve-standalone.mjs
```

起好之后先验一条：

```bash
curl http://127.0.0.1:7331/
```

应返回 `{"ok":true,"status":{...}}`。

---

## 二，带调试端口启动 Cherry Studio

先正常退出 Cherry Studio（托盘里也要退），然后用命令行启动：

```powershell
& "$env:LOCALAPPDATA\Programs\cherry-studio\Cherry Studio.exe" --remote-debugging-port=9222
```

路径以你机器上的实际安装位置为准。它不会弹黑框，界面正常打开。

验一下端口是否开着：

```bash
curl http://127.0.0.1:9222/json/list
```

能看到一串页面信息（带 `webSocketDebuggerUrl`）就说明可以注入了。

---

## 三，注入

```bash
node tools/cdp-inject.mjs --port 9222
```

它会列出所有页面，默认注入第一个。想指定别的窗口：

```bash
node tools/cdp-inject.mjs --port 9222 --index 1
```

成功时会返回 `mounted`，页面右下角会闪一条提示。此时**完全退出 Cherry Studio** 再打开，注入就没了——它只活在当前进程里。

---

## 四，用起来

和在 DSH 里一样：

- 在对话正文上**按住右键拖过一段字**，松手弹菜单；
- 点「解释这段文本」，卡片出现在画布上，浮在对话之上；
- 卡片里的词可以继续点开，父子之间连线，最多 4 层；
- 拖标题栏移动卡片，`Alt` 拖平移，`Ctrl` 滚轮缩放；
- 菜单里「批注这段」把句子标红划掉，上方气泡写「改为：」；
- 菜单「更多」里有「清空批注」。

因为我们的选择器是**全文档**的，不依赖 Cherry Studio 的具体 DOM 结构，所以不需要为它写一套专门的选择器——这是这套代码当初没把选择逻辑绑死在 DSH 上的回报。

---

## 五，撤掉

三种方式，任选：

```bash
node tools/cdp-inject.mjs --port 9222 --dispose   # 当场卸载，页面恢复原样
```

或者直接退出 Cherry Studio；或者重启它但不带调试端口。

---

## 六，已知限制

- **重启即失效**：注入只存在于当前进程，重开客户端要重新跑一次注入。
- **调试端口对本机所有程序开放**：任何本机程序都能接管这个窗口。只在个人机器上用，别在公司统一管理的设备上开。
- **官方可能关掉这条路**：如果某个版本给 Electron 传了 `--remote-debugging-port=0` 或者用了自定义协议，注入会失败。失败表现是 `/json/list` 返回空或者连不上，那时只能退回「改包」或者「独立网页」。
- **主题跟着页面走**：我们读宿主的 `--dsw-*` 令牌，Cherry 没有这套变量，会自动退回我们自带的深色/浅色板。想让它跟着 Cherry 的主题变，得在注入时补一句把 `data-knest-theme` 设成 `light`。

---

## 七，这条路和「改包」的区别

| | 调试端口注入 | 改 app.asar |
| --- | --- | --- |
| 动安装目录 | 不动 | 动，且要重打包 |
| 升级后 | 参数还在就还能用 | 每次升级都要重做 |
| 分发 | 给脚本即可 | 要把改过的包发出去 |
| 风险 | 端口开着时本机可接管 | 签名与完整性校验 |

个人用选前者；想做成「给同事装一个」的产品，两条都不合适，那时应该走浏览器扩展或独立网页。
