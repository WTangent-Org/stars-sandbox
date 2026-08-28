# 星球物理模拟器 —— 全栈一体化服务一键安装（Windows）
# 一台机器同时托管网页 + 跑权威物理 + 联机：装完浏览器直接打开 http://服务器IP:8321 即玩
# 无需再单独托管网页，每个连接一个独立宇宙，互不影响
# 用法（PowerShell）: irm https://raw.githubusercontent.com/WTangent-Org/stars-sandbox/main/install.ps1 | iex
$ErrorActionPreference = 'Stop'

$Repo = 'https://github.com/WTangent-Org/stars-sandbox.git'
$Dir  = if ($env:NBODY_DIR) { $env:NBODY_DIR } else { 'stars-sandbox' }
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

Write-Host '==> 安装依赖并构建（前端 + 服务端）'
npm install
npm run build

Write-Host ''
Write-Host '==> 完成！星球模拟器全栈一体化服务（网页托管 + 权威物理 + 联机），启动：'
Write-Host "    cd $Dir"
Write-Host "    `$env:PORT=$Port; node dist/boot.js"
Write-Host ''
Write-Host "    浏览器直接打开 http://<你的IP>:$Port 即玩，无需再单独托管网页"
