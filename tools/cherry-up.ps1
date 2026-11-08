# 一键：把词林挂到 Cherry Studio
#
# 用法（仓库根目录）：
#   .\tools\cherry-up.ps1
#   .\tools\cherry-up.ps1 -Restart     # 强制重启 Cherry（带调试端口）
#
# 它做四件事：清掉 ELECTRON_RUN_AS_NODE、确保解释服务在跑、确保 Cherry 带调试端口、
# 把 client-standalone.js 注入进去。关掉 Cherry 即恢复原样。

param(
  [int]$DebugPort = 9222,
  [int]$ExplainPort = 7331,
  [string]$CherryExe = 'D:\Apps\CherryStudio\Cherry Studio.exe',
  [string]$UserDataDir = 'D:\Apps\CherryStudioData',
  [switch]$Restart
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent

# 0. 这个变量会让 Electron 应用变成 Node 解释器，任何窗口参数都会报 bad option
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue

function Test-Port([int]$port) {
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$port/" -TimeoutSec 3 -UseBasicParsing -ErrorAction Stop
    return $r.StatusCode -ge 200
  } catch { return $false }
}

# 1. 解释服务
if (-not (Test-Port $ExplainPort)) {
  Write-Host "起解释服务（端口 $ExplainPort）…"
  Start-Process -FilePath 'node' -ArgumentList 'tools/serve-standalone.mjs' -WorkingDirectory $root -WindowStyle Hidden `
    -RedirectStandardOutput 'D:\dsh-tmp\explain-out.log' -RedirectStandardError 'D:\dsh-tmp\explain-err.log'
  Start-Sleep -Seconds 4
  if (-not (Test-Port $ExplainPort)) { throw "解释服务起不来，看 D:\dsh-tmp\explain-err.log" }
}
Write-Host "解释服务 OK   http://127.0.0.1:$ExplainPort"

# 2. Cherry 是否带着调试端口在跑
$debugOpen = $false
try {
  $null = Invoke-RestMethod -Uri "http://127.0.0.1:$DebugPort/json/list" -TimeoutSec 3 -ErrorAction Stop
  $debugOpen = $true
} catch { $debugOpen = $false }

if ($debugOpen -and -not $Restart) {
  Write-Host "Cherry 已经在调试端口 $DebugPort 上，直接注入"
} else {
  Write-Host '重启 Cherry（带调试端口）…'
  Get-Process | Where-Object { $_.ProcessName -like '*herry*' } | ForEach-Object { try { $_.Kill() } catch {} }
  Start-Sleep -Seconds 3
  if (-not (Test-Path $CherryExe)) { throw "找不到 $CherryExe" }
  New-Item -ItemType Directory -Force -Path $UserDataDir | Out-Null
  Start-Process -FilePath $CherryExe -ArgumentList "--user-data-dir=$UserDataDir", "--remote-debugging-port=$DebugPort" | Out-Null

  $deadline = (Get-Date).AddSeconds(45)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 2
    try {
      $null = Invoke-RestMethod -Uri "http://127.0.0.1:$DebugPort/json/list" -TimeoutSec 3 -ErrorAction Stop
      $debugOpen = $true
      break
    } catch { }
  }
  if (-not $debugOpen) { throw 'Cherry 起来了但调试端口没开，确认它没被安全软件拦' }
}

# 3. 注入
Write-Host '注入词林…'
$payload = @'
const fs = await import('node:fs');
const bundle = fs.readFileSync(process.argv[2], 'utf8');
const port = process.argv[3];
const explain = process.argv[4];
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = list.find((x) => x.type === 'page' && (x.title || '').includes('Cherry Studio') && !(x.title || '').includes('Tab'))
  || list.find((x) => x.type === 'page');
if (!page) { console.log('NO_PAGE'); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
let seq = 0;
const call = (method, params) => new Promise((done, fail) => {
  const id = ++seq;
  const onMsg = (e) => { const m = JSON.parse(e.data); if (m.id !== id) return; ws.removeEventListener('message', onMsg); m.error ? fail(new Error(JSON.stringify(m.error))) : done(m.result); };
  ws.addEventListener('message', onMsg);
  ws.send(JSON.stringify({ id, method, params }));
});
const res = await call('Runtime.evaluate', {
  expression: bundle + `\n;window.__knestMount({ endpoint: '${explain}', appName: 'Cherry Studio' }); 'mounted'`,
  returnByValue: true,
});
console.log(res.exceptionDetails ? 'FAIL ' + JSON.stringify(res.exceptionDetails).slice(0, 300) : 'OK ' + res.result?.value);
ws.close();
'@
$payloadPath = 'D:\dsh-tmp\knest-inject-payload.mjs'
Set-Content -Path $payloadPath -Value $payload -Encoding UTF8

$bundlePath = Join-Path $root 'client-standalone.js'
& node $payloadPath $bundlePath $DebugPort "http://127.0.0.1:$ExplainPort"

Write-Host ''
Write-Host '完成。回到 Cherry 窗口，在对话正文上按住右键拖过一段字试试。' -ForegroundColor Green
Write-Host '撤掉：node tools/cdp-inject.mjs --dispose，或者直接关掉 Cherry。'
