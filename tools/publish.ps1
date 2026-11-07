# 一键发布到 GitHub
#
# 用法（在仓库根目录）：
#   $env:GITHUB_TOKEN = "ghp_xxx"
#   .\tools\publish.ps1 -User 你的GitHub用户名
#
# 它会做四件事：配远程、打标签、推送 main、推送标签。
# 令牌只从环境变量读，不会写进 .git/config，也不会打印出来。

param(
  [Parameter(Mandatory = $true)][string]$User,
  [string]$Repo = 'dsh-knowledge-nest',
  [string]$Tag = 'v2.0.0'
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($env:GITHUB_TOKEN)) {
  Write-Error '缺少 GITHUB_TOKEN。先执行：$env:GITHUB_TOKEN = "ghp_xxx"'
}

# 1. 包名与仓库地址对齐
$pkgPath = Join-Path $PWD 'package.json'
$pkg = Get-Content $pkgPath -Raw -Encoding UTF8
$pkg = $pkg -replace 'YOUR_NAME', $User
Set-Content -Path $pkgPath -Value $pkg -Encoding UTF8 -NoNewline

# 2. 身份与远程
git config user.name  $User
git config user.email "$User@users.noreply.github.com"
$remote = "https://github.com/$User/$Repo.git"
git remote remove origin 2>$null | Out-Null
git remote add origin $remote

# 3. 提交未落盘改动
git add -A
$dirty = git status --porcelain
if (-not [string]::IsNullOrWhiteSpace($dirty)) {
  git commit -m "发布前整理" | Out-Null
}

# 4. 标签
git tag -d $Tag 2>$null | Out-Null
git tag -a $Tag -m "词林 $Tag"

# 5. 推送（令牌只用于这一次请求头，不进配置）
$basic = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("$User`:$($env:GITHUB_TOKEN)"))
git -c http.extraheader="Authorization: Basic $basic" push -u origin HEAD:main
git -c http.extraheader="Authorization: Basic $basic" push origin $Tag

Write-Host ''
Write-Host "已推送：$remote" -ForegroundColor Green
Write-Host "仓库首页：https://github.com/$User/$Repo" -ForegroundColor Green
