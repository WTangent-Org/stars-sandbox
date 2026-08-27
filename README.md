# 星球物理模拟器 · N-body Gravity Sandbox

星系级 2D N 体物理沙盒：真实引力模拟 + 伪广义相对论黑洞（ISCO / 视界捕获 / 时间膨胀）+ 物理碰撞（并合 / 反弹 / 碎裂 / 洛希撕碎）+ 恒星生命周期。

**双模式运行**：物理可以在玩家自己的浏览器里跑（本地），也可以丢给一台服务器跑（远程，WebSocket 推流，浏览器只负责渲染）——把重活交给性能更好的机器，多人还能共享同一个宇宙。

## WS 物理服务端一键安装

> 只装「跑物理的服务器」。网页端用已发布的页面（Kimi 发布或任意静态托管），玩家在设置里填服务器地址就连上；本机直接玩选「本地」即可，什么都不用装。

**Linux / macOS：**

```bash
curl -fsSL https://raw.githubusercontent.com/WTangent-Org/nbody-sandbox/main/install.sh | bash
```

**Windows（PowerShell 管理员）：**

```powershell
irm https://raw.githubusercontent.com/WTangent-Org/nbody-sandbox/main/install.ps1 | iex
```

脚本会自动：装 Node 20（如缺失）→ 拉代码 → `npm install` → `npm run build:server` → 后台启动 `dist-server/server.js`，默认端口 **8321**（`PORT=9000` 环境变量可改）。

装完之后：

1. 防火墙/云安全组放行 TCP 8321
2. 玩家打开网页 → 底部 ⚙ 设置 → 运行位置 → **远程** → 服务器地址填 `服务器IP:8321`
3. 所有连到同一台服务器的玩家共享同一个宇宙

## 手动部署（备选）

```bash
git clone --depth 1 https://github.com/WTangent-Org/nbody-sandbox.git
cd nbody-sandbox
npm install
npm run build:server          # 只构建 WS 服务端
node dist-server/server.js    # 默认 8321 端口，PORT 环境变量可改
```

如需同时托管网页端（单端口交付）：`npm run build && node dist/boot.js`（构建前端 dist/ 并由服务端静态托管）。

## 玩法

- 左键拖空白平移 / 滚轮缩放 / 点击天体选中（任意天体都有轨道根数：近远拱点、偏心率、周期、逃逸速度；近黑洞还有时间膨胀）
- 拖动天体可以甩开它；Delete 删除；空格暂停；⏪ 回退
- 创建天体模式：点一下自动获得环绕轨道速度；飞船全场唯一，WASD 操控，Shift 全推力
- 预设：真实太阳系 / 双星 / 三星混沌 / 旋涡星系 / 星系碰撞

## 技术

纯 TypeScript 物理引擎（KDK 蛙跳辛积分、Paczyński–Wiita 赝势、自适应子步），React + Canvas 渲染，Node WebSocket 服务器 60Hz 物理 + 20Hz 二进制帧推流。
