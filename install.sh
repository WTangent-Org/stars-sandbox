#!/usr/bin/env bash
# 星球物理模拟器 —— WS 物理服务端一键安装（Linux / macOS）
# 只装服务端：物理在这台机器上跑，网页端用已发布的页面（设置里填本机地址即可连上）
# 用法: curl -fsSL https://raw.githubusercontent.com/WTangent-Org/nbody-sandbox/main/install.sh | bash
set -e

REPO="https://github.com/WTangent-Org/nbody-sandbox.git"
DIR="${NBODY_DIR:-nbody-sandbox}"
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

echo "==> 安装依赖并构建服务端"
npm install
npm run build:server

echo "==> 启动 WS 物理服务端（端口 $PORT）"
if command -v pm2 >/dev/null 2>&1; then
  pm2 delete nbody-sandbox >/dev/null 2>&1 || true
  PORT=$PORT pm2 start dist-server/server.js --name nbody-sandbox
else
  nohup env PORT=$PORT node dist-server/server.js > nbody.log 2>&1 &
  echo $! > nbody.pid
  echo "已后台启动（PID $(cat nbody.pid)，日志 nbody.log）"
fi

IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "127.0.0.1")
echo ""
echo "==> 完成！物理服务端运行中：${IP}:${PORT}"
echo "    玩家打开网页 → 设置 → 运行位置选「远程」→ 服务器地址填 ${IP}:${PORT}"
