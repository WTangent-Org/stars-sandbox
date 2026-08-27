# 星球物理模拟器 —— WS 物理服务端一键安装（Windows）
# 只装服务端：物理在这台机器上跑，网页端用已发布的页面（设置里填本机地址即可连上）
# 用法（PowerShell）: irm https://raw.githubusercontent.com/WTangent-Org/nbody-sandbox/main/install.ps1 | iex
$ErrorActionPreference = 'Stop'

$Repo = 'https://github.com/WTangent-Org/nbody-sandbox.git'
$Dir  = if ($env:NBODY_DIR) { $env:NBODY_DIR } else { 'nbody-sandbox' }
$Port = if ($env:PORT) { $env:PORT } else { 8321 }

Write-Host '==> 检查依赖'
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Host '缺少 git，请先安装: https://git-scm.com/download/win'; exit 1
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host '==> 未检测到 Node.js，尝试用 winget 安装 Node 20'
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
    # 刷新 PATH
    $env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')
  } else {
    Write-Host '无法自动安装 Node.js，请手动安装 Node 20+ 后重试: https://nodejs.org'; exit 1
  }
}

Write-Host '==> 拉取代码'
if (Test-Path "$Dir/.git") { git -C $Dir pull --ff-only } else { git clone --depth 1 $Repo $Dir }
Set-Location $Dir

Write-Host '==> 安装依赖并构建服务端'
npm install
npm run build:server

Write-Host "==> 启动 WS 物理服务端（端口 $Port）"
$env:PORT = $Port
Start-Process -WindowStyle Hidden node -ArgumentList 'dist-server/server.js' -WorkingDirectory (Get-Location)

Write-Host ''
Write-Host "==> 完成！物理服务端运行中：本机:$Port"
Write-Host "    玩家打开网页 → 设置 → 运行位置选「远程」→ 服务器地址填 <你的IP>:$Port"
