# 星球物理模拟器 · N-body Gravity Sandbox

星系级 2D N 体物理沙盒：真实引力模拟 + 伪广义相对论黑洞（ISCO / 视界捕获 / 时间膨胀）+ 物理碰撞（并合 / 反弹 / 碎裂 / 洛希撕碎）+ 恒星生命周期 + 飞船操控。

**世界（存档）是一级入口（类似 MC）**：打开网页先进入**主菜单**——「继续游戏」恢复上次的宇宙（每 30 秒自动保存，含相机视野，存浏览器 IndexedDB）、「新的世界」从预设开始、「本地世界」管理存档槽位（进入 / 导出 / 导入 .json / 删除）、「多人游戏」连接服务器（公共大厅或房号私房）。游戏内右上「☰ 菜单」：保存当前宇宙、**对局域网开放**（把当前宇宙装进新房间、生成房号邀请朋友，MC 语义）、保存并退出到主菜单。

## 架构说明

**单服务器模式**：没有本地/远程切换——跑网页的服务器同时跑权威物理（默认 **30Hz 物理 / 12Hz 二进制帧推流**，见 `server/index.ts`）。客户端通过同源 WebSocket（`/ws`）连接，浏览器负责渲染与输入。

**客户端补算**：客户端内置一份镜像 Simulation（engine 的 mirror 模式——只算引力 / 推进 / ISCO / 轨迹，碰撞与生命周期由服务器裁决），在权威帧之间本地积分到 60fps，权威帧到达时对账纠偏——服务器只需低频推流，画面仍有 60fps 的真实物理平滑度（见 `src/sim/net.ts`）。按性能档位启用：**均衡档及以上**启用补算；**低 / 省电档**退回线性插值，客户端几乎不出力。抓取中的天体与自己的飞船由本地即时控制，对账只做软纠正。

**断线降级**：联机中连接断开时自动降级为离线单机模式（本地完整物理，可继续玩）；显式连接过的会话内每 15 秒自动重试，也可在「联机」页一键重连。进入房间时客户端自动采用房间的预设（相机缩放 / 单位换算与房间内其他玩家一致）。

**房主模式（MC 语义）**：「对局域网开放 / 载入存档开房」的人是**房主**——暂停、回退、清空、切预设、时间流速由房主直接执行，客人无权操作（自己的星球与飞船归客人管）；**房主退出或关闭房间，房间即解散**，宇宙由房主带回本地自动存档。公共大厅是无主房间，全局操作仍走全员投票，过半执行。

## 快速开始

```bash
npm install
```

**纯前端开发**（不调试联机功能）：

```bash
npm run dev        # vite 起在 3000 端口
```

注意：dev 模式下客户端连同源 `/ws` 会连到 vite（3000 端口），vite 不转发 WebSocket，所以联机连不上、会自动进入离线单机模式——这对纯前端开发正好够用。

**调试联机 / 完整体验**（推荐）：

```bash
npm run build && npm start    # 构建前端 + 服务端，8321 单端口同时托管网页与 /ws
```

浏览器访问 `http://localhost:8321` 即可。

也可以开发时前后端热改：另开一个终端 `npm run server`（tsx 起 WS 服务器在 8321），但 vite（3000）不会把 `/ws` 转发过去，因此这条路径下联机仍然不可用——要联机请用上面的 build && start 方式。

## 部署

**一键脚本**（装的是全栈一体化服务：网页 + 权威物理 + 联机，单端口 8321）：

Linux / macOS：

```bash
curl -fsSL https://raw.githubusercontent.com/WTangent-Org/stars-sandbox/main/install.sh | bash
```

Windows（PowerShell 管理员）：

```powershell
irm https://raw.githubusercontent.com/WTangent-Org/stars-sandbox/main/install.ps1 | iex
```

脚本会自动：装 Node 20（如缺失）→ 拉代码 → `npm install` → `npm run build` → 启动服务，默认端口 **8321**（`PORT=9000` 环境变量可改）。Linux 上会自动注册 **systemd 服务**（开机自启、崩溃自愈，`systemctl status stars-sandbox` 查看）；Windows 脚本只完成安装，启动命令见脚本输出。装完后防火墙 / 云安全组放行 TCP 8321，把 `http://服务器IP:8321` 发给朋友即可。

**手动部署**：

```bash
git clone --depth 1 https://github.com/WTangent-Org/stars-sandbox.git
cd stars-sandbox
npm install
npm run build        # 前端 dist/ + 服务端 dist-server/server.js + dist/boot.js
npm start            # = node dist-server/server.js，8321 单端口托管网页 + WS
```

单目录交付（Kimi 发布平台约定入口）：`node dist/boot.js`（内部转发到 `dist/server/server.js`）。

**Docker**：

```bash
docker build -t stars-sandbox .
docker run -d -p 8321:8321 stars-sandbox
```

镜像为多阶段构建的全栈一体化镜像，启动 `dist/boot.js`，单端口 8321。

## 存档与局域网开放

- **本地存档**：存在浏览器 IndexedDB 里，左侧停靠栏「存档」页管理（保存 / 读取 / 删除），可导出为 `.json` 文件带走、也能导入回来。
- **开放到局域网**：把当前宇宙一键装进一个新房间——生成房号后发给朋友，对方在同一服务器网页上填房号即加入你的世界（类似 MC 的「对局域网开放」）。

## 联机规则

- **身份**：进房自动分配随机呼号（如「参宿-5151」）和颜色，无需注册
- **飞船**：每人一艘，进房自动发放，离开收回；只能推自己的船
- **星球权限**：谁放归谁；点选星球可给其他玩家授权——看（默认）/ 动（可拖拽抛掷）/ 管（可删除、可再授权）
- **全局操作**：暂停 / 回退 / 清空 / 切预设需投票，过半同意执行（单人房间直接生效）

## 玩法

- 左键拖空白平移 / 滚轮缩放 / 点击天体选中（任意天体都有轨道根数：近远拱点、偏心率、周期、逃逸速度；近黑洞还有时间膨胀）
- 拖动天体可以甩开它；Delete 删除；空格暂停；⏪ 回退
- 创建天体模式：点一下自动获得环绕轨道速度；飞船 WASD 操控，Shift 全推力
- 预设：真实太阳系 / 双星 / 三星混沌 / 旋涡星系 / 星系碰撞

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `8321` | HTTP + WebSocket 端口 |
| `PHYS_HZ` | `30` | 服务器权威物理频率（Hz） |
| `STREAM_HZ` | `12` | 二进制帧推流频率（Hz），客户端在帧间补算到 60fps |
| `MAX_PER_ROOM` | `16` | 单房间人数上限 |

另有 `DIST_DIR`（默认 `dist`）指定静态托管目录。

## 技术

纯 TypeScript 物理引擎（KDK 蛙跳辛积分、Paczyński–Wiita 赝势、自适应子步），React 19 + Canvas 渲染，Node + ws 服务器（30Hz 权威物理 + 12Hz 二进制帧推流），客户端镜像补算到 60fps，房间制多宇宙 + 权限 / 投票 / 存档协议，Vite 构建，Tailwind 深色 HUD 界面。
