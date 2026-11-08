# 词林守护：Cherry 一启动就自动挂上界面，MCP 开关关掉就自动撤掉
#
# 用法：
#   .\tools\knest-daemon.ps1                前台运行（调试用，Ctrl+C 停）
#   .\tools\knest-daemon.ps1 -Install       装成开机自启
#   .\tools\knest-daemon.ps1 -Uninstall     卸掉自启
#
# 每 3 秒一轮，做三件事：
#   1. Cherry 没开就等；开了但没调试端口也等
#   2. 读数据库里 knowledge-nest 的 is_active：
#        1  → 页面上没有词林就注入
#        0  → 页面上有词林就撤掉
#        读不到 → 保持现状，不乱动
#   3. 顺便保证配置服务在跑（面板和解释都靠它）

param(
  [int]$DebugPort = 9222,
  [int]$SetupPort = 7332,
  [string]$CherryDataDir = 'D:\Apps\CherryStudioData',
  [string]$InstallDir = 'D:\Apps\CherryStudioData\Data\McpServers\knowledge-nest',
  [switch]$Install,
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$logDir = 'D:\dsh-tmp'
$logFile = Join-Path $logDir 'knest-daemon.log'
$startupDir = [Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startupDir '词林守护.lnk'

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Write-Log([string]$text) {
  $line = '[{0}] {1}' -f (Get-Date -Format 'HH:mm:ss'), $text
  Write-Host $line
  try { Add-Content -Path $logFile -Value $line -Encoding UTF8 } catch { }
}

# ---------- 安装 / 卸载自启 ----------
if ($Install) {
  $ws = New-Object -ComObject WScript.Shell
  $lnk = $ws.CreateShortcut($shortcutPath)
  $lnk.TargetPath = 'powershell.exe'
  $lnk.Arguments = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $PSCommandPath + '"'
  $lnk.WorkingDirectory = $root
  $lnk.WindowStyle = 7
  $lnk.Description = '词林守护：Cherry 启动后自动注入界面'
  $lnk.Save()
  Write-Host "已装成开机自启：$shortcutPath" -ForegroundColor Green
  Start-Process -FilePath 'powershell.exe' -ArgumentList '-NoProfile', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', $PSCommandPath -WindowStyle Hidden
  exit 0
}

if ($Uninstall) {
  if (Test-Path $shortcutPath) { Remove-Item $shortcutPath -Force; Write-Host "已移除自启：$shortcutPath" -ForegroundColor Green }
  else { Write-Host '没有找到自启项' }
  exit 0
}

# ---------- 常驻 ----------
Write-Log '词林守护启动'

$bundlePath = Join-Path $root 'client-standalone.js'
$payloadPath = Join-Path $logDir 'knest-daemon-inject.mjs'
$dbPath = Join-Path $CherryDataDir 'Data\cherrystudio.sqlite'
$activeScript = Join-Path $InstallDir 'tools\mcp-active.mjs'
if (-not (Test-Path $activeScript)) { $activeScript = Join-Path $root 'packages\mcp-server\tools\mcp-active.mjs' }

$payload = @'
import { readFileSync } from 'node:fs';
const [port, setupPort, bundlePath, mode] = process.argv.slice(2);
const dispose = mode === 'dispose';
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const pages = list.filter((x) => x.type === 'page' && (x.url || '').includes('renderer'));
if (pages.length === 0) { console.log('NO_PAGE'); process.exit(0); }
const bundle = dispose ? '' : readFileSync(bundlePath, 'utf8');
let changed = 0;
for (const page of pages) {
  let ws;
  try {
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r, j) => {
      ws.addEventListener('open', r, { once: true });
      ws.addEventListener('error', () => j(new Error('ws')), { once: true });
    });
  } catch { continue; }
  let seq = 0;
  const call = (method, params) => new Promise((resolve, reject) => {
    const id = ++seq;
    const onMsg = (e) => {
      const m = JSON.parse(e.data);
      if (m.id !== id) return;
      ws.removeEventListener('message', onMsg);
      m.error ? reject(new Error('cdp')) : resolve(m.result);
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
  try {
    const alive = await call('Runtime.evaluate', { expression: 'Boolean(window.__knestStandalone)', returnByValue: true });
    const mounted = alive?.result?.value === true;
    if (dispose) {
      if (mounted) {
        await call('Runtime.evaluate', { expression: 'window.__knestStandalone.dispose(); "gone"', returnByValue: true });
        changed += 1;
      }
      continue;
    }
    if (mounted) continue;
    const res = await call('Runtime.evaluate', {
      expression: bundle + `\n;window.__knestMount({ endpoint: 'http://127.0.0.1:${setupPort}', appName: 'Cherry Studio', setupPort: ${setupPort} }); 'mounted'`,
      returnByValue: true,
    });
    if (res?.exceptionDetails === undefined) changed += 1;
  } catch { /* 页面可能正在加载 */ }
  finally { try { ws.close(); } catch {} }
}
console.log(dispose ? (changed > 0 ? `REMOVED ${changed}` : 'ALREADY_GONE') : (changed > 0 ? `INJECTED ${changed}` : 'ALREADY'));
'@
Set-Content -Path $payloadPath -Value $payload -Encoding UTF8

$lastState = ''
$lastActive = '?'
while ($true) {
  try {
    $null = Invoke-RestMethod -Uri "http://127.0.0.1:$DebugPort/json/list" -TimeoutSec 2 -ErrorAction Stop

    $setupOk = $false
    try {
      $probe = Invoke-WebRequest -Uri "http://127.0.0.1:$SetupPort/state" -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop
      $setupOk = $probe.StatusCode -eq 200
    } catch { $setupOk = $false }

    $active = ''
    try {
      $raw = & node $activeScript --db $dbPath 2>&1
      $active = ($raw | Out-String).Trim()
    } catch { $active = '' }
    if ($active -ne '1' -and $active -ne '0') { $active = '' }

    if ($active -ne $lastActive) {
      $label = '读取失败，按启用处理'
      if ($active -eq '1') { $label = '启用' }
      if ($active -eq '0') { $label = '关闭' }
      Write-Log ('MCP 开关: ' + $label)
      $lastActive = $active
    }

    if ($active -eq '0') {
      $out = & node $payloadPath $DebugPort $SetupPort $bundlePath dispose 2>&1
      $text = ($out | Out-String).Trim()
      if ($text -like 'REMOVED*') {
        Write-Log ('MCP 已关闭，界面已撤掉（' + $text + '）')
      }
      Start-Sleep -Seconds 3
      continue
    }

    if (-not $setupOk) {
      $dataDir = Join-Path $InstallDir 'data'
      if (-not (Test-Path (Split-Path $dataDir -Parent))) { $dataDir = 'D:\knest-data' }
      New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
      $svc = Get-ChildItem $InstallDir -Filter 'setup.mjs' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($svc) { $pkgDir = Split-Path (Split-Path $svc.FullName -Parent) -Parent } else { $pkgDir = Join-Path $root 'packages\mcp-server' }
      $svcLine = 'node tools\setup.mjs --port=' + $SetupPort + ' --home="' + $dataDir + '" --no-open'
      Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', 'start', '/b', '/min', 'cmd.exe', '/c', $svcLine -WorkingDirectory $pkgDir -WindowStyle Hidden | Out-Null
      Write-Log '配置服务已拉起'
    }

    $out = & node $payloadPath $DebugPort $SetupPort $bundlePath 2>&1
    $text = ($out | Out-String).Trim()
    if ($text -like 'INJECTED*') { Write-Log ('已注入（' + $text + '）') }
  } catch {
    if ($lastState -ne 'PORT_DOWN') {
      Write-Log 'Cherry 没在跑（或没开调试端口），等它就绪'
      $lastState = 'PORT_DOWN'
      $lastActive = '?'
    }
  }

  Start-Sleep -Seconds 3
}
