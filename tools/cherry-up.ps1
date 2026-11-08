# 一键把词林装进 Cherry Studio：起服务、配模型、注入界面，全自动
#
# 用法（仓库根目录）：
#   .\tools\cherry-up.ps1               一键：该起的都起来，该配的自动配，界面直接打开
#   .\tools\cherry-up.ps1 -Restart      强制重启 Cherry（带调试端口）
#   .\tools\cherry-up.ps1 -Reset        清掉已有配置，重新自动探测
#
# 做了什么：
#   1. 清掉 ELECTRON_RUN_AS_NODE（不清的话 Cherry 会被当成 Node 起，直接退出码 9）
#   2. 确保配置服务在跑（端口被占就复用，不抢）
#   3. 没有任何配置时，自动探测本机模型（Ollama / LM Studio）并写进配置
#   4. 确保 Cherry 带调试端口
#   5. 把界面注入进去，没有配置时顺手把设置面板打开

param(
  [int]$DebugPort = 9222,
  [int]$SetupPort = 7332,
  [string]$CherryExe = 'D:\Apps\CherryStudio\Cherry Studio.exe',
  [string]$UserDataDir = 'D:\Apps\CherryStudioData',
  [string]$InstallDir = 'D:\Apps\CherryStudioData\Data\McpServers\knowledge-nest',
  [switch]$Restart,
  [switch]$Reset
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$logDir = 'D:\dsh-tmp'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Write-Step([string]$text) { Write-Host "  $text" }
function Write-Ok([string]$text) { Write-Host "  $text" -ForegroundColor Green }
function Write-Warn2([string]$text) { Write-Host "  $text" -ForegroundColor Yellow }

# 0. 这个变量会让 Electron 应用变成 Node 解释器，任何窗口参数都会报 bad option
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue

Write-Host ''
Write-Host '词林 · 一键安装' -ForegroundColor Cyan
Write-Host ''

# 1. 配置服务
Write-Step '配置服务…'
$setupAlive = $false
try {
  $probe = Invoke-WebRequest -Uri "http://127.0.0.1:$SetupPort/state" -TimeoutSec 3 -UseBasicParsing -ErrorAction Stop
  if ($probe.StatusCode -eq 200) { $setupAlive = $true }
} catch { $setupAlive = $false }

if ($setupAlive) {
  Write-Ok "已经在跑（端口 $SetupPort），直接复用"
} else {
  $pkgDir = Join-Path $root 'packages\mcp-server'
  # 数据目录必须和 MCP 读的是同一份，否则面板里配完客户端看不到
  $homeDir = Join-Path $InstallDir 'data'
  if (-not (Test-Path (Split-Path $homeDir -Parent))) { $homeDir = 'D:\knest-data' }
  New-Item -ItemType Directory -Force -Path $homeDir | Out-Null
  # 用 cmd start 起服务，彻底脱离当前进程树：否则脚本会一直等这个子进程，窗口不返回
  $svcLine = 'node tools\setup.mjs --port=' + $SetupPort + ' --home="' + $homeDir + '" --no-open > "' + $logDir + '\knest-setup-out.log" 2> "' + $logDir + '\knest-setup-err.log"'
  Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', 'start', '/b', '/min', 'cmd.exe', '/c', $svcLine `
    -WorkingDirectory $pkgDir -WindowStyle Hidden | Out-Null
  $deadline = (Get-Date).AddSeconds(20)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 600
    try {
      $null = Invoke-WebRequest -Uri "http://127.0.0.1:$SetupPort/state" -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop
      $setupAlive = $true
      break
    } catch { }
  }
  if ($setupAlive) { Write-Ok "已起在 $SetupPort" } else { throw "配置服务起不来，看 $logDir\knest-setup-err.log" }
}

# 2. 自动探测本机模型
Write-Step '探测本机模型…'
$state = Invoke-RestMethod -Uri "http://127.0.0.1:$SetupPort/state" -TimeoutSec 5 -Headers @{ origin = 'null' }
$configured = -not [string]::IsNullOrWhiteSpace($state.saved.baseUrl)

if ($Reset -and $configured) {
  Remove-Item (Join-Path $state.home 'config.json') -Force -ErrorAction SilentlyContinue
  $configured = $false
  Write-Warn2 '已清掉旧配置'
}

if ($configured) {
  Write-Ok "已有配置：$($state.saved.baseUrl) / $($state.saved.model)"
} else {
  $found = $null
  $candidates = @(
    @{ id = 'ollama'; url = 'http://127.0.0.1:11434/v1'; name = 'Ollama' },
    @{ id = 'lmstudio'; url = 'http://127.0.0.1:1234/v1'; name = 'LM Studio' },
    @{ id = 'vllm'; url = 'http://127.0.0.1:8000/v1'; name = 'vLLM' }
  )
  foreach ($candidate in $candidates) {
    try {
      $models = Invoke-RestMethod -Uri "$($candidate.url)/models" -TimeoutSec 3 -ErrorAction Stop
      $list = @($models.data | ForEach-Object { $_.id })
      if ($list.Count -gt 0) {
        $found = @{ id = $candidate.id; name = $candidate.name; url = $candidate.url; model = $list[0]; all = $list }
        break
      }
    } catch { }
  }

  if ($null -ne $found) {
    $body = @{ preset = $found.id; baseUrl = $found.url; model = $found.model; apiKey = '' } | ConvertTo-Json -Compress
    $saved = Invoke-RestMethod -Uri "http://127.0.0.1:$SetupPort/save" -Method Post -Body $body -ContentType 'application/json' -TimeoutSec 10 -Headers @{ origin = 'null' }
    if ($saved.ok -eq $true) {
      Write-Ok "自动配好：$($found.name) · $($found.model)（免费，不出网）"
    } else {
      Write-Warn2 "自动配置失败：$($saved.message)"
    }
  } else {
    Write-Warn2 '本机没探测到运行中的模型服务'
    Write-Step '装一个最省事：ollama pull qwen2.5:7b'
    Write-Step '或者稍后在设置面板里填 DeepSeek 的 key'
  }
}

# 3. Cherry 的调试端口
Write-Step 'Cherry Studio…'
$debugOpen = $false
try {
  $null = Invoke-RestMethod -Uri "http://127.0.0.1:$DebugPort/json/list" -TimeoutSec 3 -ErrorAction Stop
  $debugOpen = $true
} catch { $debugOpen = $false }

if ($debugOpen -and -not $Restart) {
  Write-Ok "已在调试端口 $DebugPort 上"
} else {
  Get-Process | Where-Object { $_.ProcessName -like '*herry*' } | ForEach-Object { try { $_.Kill() } catch {} }
  Start-Sleep -Seconds 3
  if (-not (Test-Path $CherryExe)) { throw "找不到 $CherryExe" }
  New-Item -ItemType Directory -Force -Path $UserDataDir | Out-Null
  Start-Process -FilePath $CherryExe -ArgumentList "--user-data-dir=$UserDataDir", "--remote-debugging-port=$DebugPort" | Out-Null

  $deadline = (Get-Date).AddSeconds(60)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 2
    try {
      $null = Invoke-RestMethod -Uri "http://127.0.0.1:$DebugPort/json/list" -TimeoutSec 3 -ErrorAction Stop
      $debugOpen = $true
      break
    } catch { }
  }
  if (-not $debugOpen) { throw 'Cherry 起来了但调试端口没开，确认它没被安全软件拦' }
  Write-Ok '已带调试端口启动'
}

# 4. 注入
Write-Step '注入界面…'
$payload = @'
const fs = await import('node:fs');
const bundle = fs.readFileSync(process.argv[2], 'utf8');
const port = process.argv[3];
const setupUrl = process.argv[4];
const setupPort = process.argv[5];
const autoOpen = process.argv[6] === 'open';
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
try {
  await call('Runtime.evaluate', { expression: 'window.__knestStandalone && window.__knestStandalone.dispose()', returnByValue: true });
} catch {}
const res = await call('Runtime.evaluate', {
  expression: bundle + `\n;window.__knestMount({ endpoint: '${setupUrl}', appName: 'Cherry Studio', setupPort: ${setupPort} }); 'mounted'`,
  returnByValue: true,
});
if (res.exceptionDetails) { console.log('FAIL ' + JSON.stringify(res.exceptionDetails).slice(0, 300)); ws.close(); process.exit(1); }
if (autoOpen) {
  await new Promise((r) => setTimeout(r, 900));
  await call('Runtime.evaluate', { expression: 'window.__knestStandalone && window.__knestStandalone.settings.open(); "opened"', returnByValue: true });
}
console.log('OK');
ws.close();
'@
$payloadPath = Join-Path $logDir 'knest-inject-payload.mjs'
Set-Content -Path $payloadPath -Value $payload -Encoding UTF8

$bundlePath = Join-Path $root 'client-standalone.js'
$openFlag = if ($configured) { 'keep' } else { 'open' }
$result = & node $payloadPath $bundlePath $DebugPort "http://127.0.0.1:$SetupPort" $SetupPort $openFlag
if ($result -notcontains 'OK') { throw "注入失败：$result" }
Write-Ok '已注入'

# 5. 收尾
Write-Host ''
if ($configured) {
  Write-Host '好了。回到 Cherry 窗口，右键拖过一段字就能用。' -ForegroundColor Green
  Write-Host '想换模型：点右下角齿轮。' -ForegroundColor DarkGray
} else {
  Write-Host '界面已经挂上，设置面板也打开了。' -ForegroundColor Green
  Write-Host '填一把 key 或选本机模型即可；填完立刻生效，不用重启客户端。' -ForegroundColor DarkGray
}
Write-Host ''

exit 0
