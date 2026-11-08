# 安装 Cherry Studio 到 D 盘（C 盘空间不够时用）
#
# 用法（在仓库根目录）：
#   .\tools\install-cherry.ps1
#   .\tools\install-cherry.ps1 -Installer D:\tmp\cherry-setup.exe
#
# 它会：校验 sha256、把临时目录指到 D 盘、静默安装到 D:\Apps\CherryStudio、最后打印结果。
# 校验不过就不装，避免装一个下坏的包。

param(
  [string]$Installer = 'D:\dsh-tmp\cherry-setup.exe',
  [string]$Target = 'D:\Apps\CherryStudio',
  [string]$Sha256 = 'f0c56cb51f711fe3983c802acbef52f75fb3ec22820637f4760bd4d218ab82bf',
  [int64]$Size = 302796976
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $Installer)) {
  throw "找不到安装包：$Installer"
}

$file = Get-Item $Installer
Write-Host ("包大小 {0:N0} 字节" -f $file.Length)
if ($file.Length -ne $Size) {
  throw "大小不符：期望 $Size，实际 $($file.Length)。可能没下完，重跑下载或删掉重下。"
}

Write-Host '正在校验 sha256…'
$hash = (Get-FileHash -Path $Installer -Algorithm SHA256).Hash.ToLower()
if ($hash -ne $Sha256.ToLower()) {
  throw "sha256 不符：`n  期望 $Sha256`n  实际 $hash"
}
Write-Host '校验通过。'

New-Item -ItemType Directory -Force -Path 'D:\dsh-tmp', (Split-Path $Target -Parent) | Out-Null

# 临时目录指到 D 盘：NSIS 安装器会先解压到 %TEMP%，C 盘满就是死在这里
$env:TMP = 'D:\dsh-tmp'
$env:TEMP = 'D:\dsh-tmp'

Write-Host "静默安装到 $Target …"
$proc = Start-Process -FilePath $Installer -ArgumentList '/S', "/D=$Target" -Wait -PassThru
Write-Host ("安装器退出码 {0}" -f $proc.ExitCode)

$exe = Get-ChildItem $Target -Recurse -Filter '*.exe' -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -match 'Cherry' } | Select-Object -First 1

if ($null -eq $exe) {
  throw "安装完成但没找到可执行文件，去 $Target 里看看。"
}

Write-Host ''
Write-Host ("已安装：{0}" -f $exe.FullName) -ForegroundColor Green
Write-Host '带调试端口启动（给词林注入用）：'
Write-Host ("  & `"{0}`" --remote-debugging-port=9222" -f $exe.FullName)
