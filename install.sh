#!/usr/bin/env bash
# 星球物理模拟器 —— 全栈一体化服务一键安装（Linux / macOS）
# 一台机器同时托管网页 + 跑权威物理 + 联机：装完浏览器直接打开 http://服务器IP:8321 即玩
# 无需再单独托管网页，每个连接一个独立宇宙，互不影响
# 用法: curl -fsSL https://raw.githubusercontent.com/WTangent-Org/stars-sandbox/main/install.sh | bash
set -e

REPO="https://github.com/WTangent-Org/stars-sandbox.git"
DIR="${NBODY_DIR:-stars-sandbox}"
PORT="${PORT:-8321}"

echo "==> 检查依赖"
if ! command -v git >/dev/null 2>&1; then echo "缺少 git，请先安装 git"; exit 1; fi

if ! command -v node >/dev/null 2>&1; then
  echo "==> 未检测到 Node.js，尝试安装 Node 20"
  if command -v apt-get >/dev/null 2>&1; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs
  elif command -v dnf >/dev/null 2>&1; then
    sudo dnf install -y nodejs
  elif command -v brew >/dev/null 2>&1; then
    brew install node@20 && brew link --overwrite node@20
  else
    echo "无法自动安装 Node.js，请手动安装 Node 20+ 后重试"; exit 1
  fi
fi

echo "==> 拉取代码"
if [ -d "$DIR/.git" ]; then git -C "$DIR" pull --ff-only; else git clone --depth 1 "$REPO" "$DIR"; fi
cd "$DIR"

echo "==> 安装依赖并构建（前端 + 服务端）"
npm install
npm run build

ABS_DIR="$(pwd)"

# ———— 注册为系统服务（开机自启 + 崩溃自愈）————
if command -v systemctl >/dev/null 2>&1 && [ "$(id -u)" = "0" -o -n "$SUDO_USER" ]; then
  echo "==> 注册 systemd 服务 stars-sandbox"
  SUDO=""; [ "$(id -u)" != "0" ] && SUDO="sudo"
  $SUDO tee /etc/systemd/system/stars-sandbox.service >/dev/null <<EOF
[Unit]
Description=Stars Sandbox full-stack service (web + authoritative physics + multiplayer)
After=network.target

[Service]
Type=simple
WorkingDirectory=$ABS_DIR
Environment=PORT=$PORT
ExecStart=$(command -v node) dist/boot.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
  $SUDO systemctl daemon-reload
  $SUDO systemctl enable --now stars-sandbox
  echo "    已注册并启动：systemctl status stars-sandbox 查看状态"
elif command -v pm2 >/dev/null 2>&1; then
  pm2 delete stars-sandbox >/dev/null 2>&1 || true
  PORT=$PORT pm2 start dist/boot.js --name stars-sandbox
else
  nohup env PORT=$PORT node dist/boot.js > nbody.log 2>&1 &
  echo $! > nbody.pid
  echo "已后台启动（PID $(cat nbody.pid)，日志 nbody.log）"
fi

IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "127.0.0.1")
echo ""
echo "==> 完成！星球模拟器全栈一体化服务运行中（网页托管 + 权威物理 + 联机）"
echo "    浏览器直接打开 http://${IP}:${PORT} 即玩，无需再单独托管网页"
