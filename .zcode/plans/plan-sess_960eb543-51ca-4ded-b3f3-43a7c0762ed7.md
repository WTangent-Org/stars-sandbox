# 星球模拟器全面重构计划

已确认约束：旧存档与联机协议**均可破坏兼容**；**全面深度拆分**；**删除死代码与无用依赖**。

三份审计（前端 / 引擎+服务器 / 测试+配置）已完成的结论作为依据，分六个阶段执行，每阶段结束跑 tsc + 单测 + smoke 并单独 commit。

---

## 阶段 0：安全网 + 严重 bug 先修（重构前置，半天）

**测试基建**
- `package.json`：加 `"test"`（node --test，零新依赖）与 `"smoke"` 脚本
- 新增 `tests/engine.test.mjs`：kindForMass 质量段、并合后重新定级（卫星+卫星→行星、行星过线点燃）、生命周期三段演化、碰撞三结局（吸积/弹开溅屑/碎裂）、serialize/restoreWorld 往返
- `tsconfig.node.json` 加入 `server/**` 与 `scripts/**`——目前 `tsc -b` 完全不检查服务器代码

**审计确认的严重 bug（先修，否则重构中会误判为回归）**
1. net.ts 镜像天体 id 错误：帧创建的天体用本地 `nextId++` 而非服务器 id → 中途加入/并合后每帧删除重建（联机闪烁根源）。`addBody` 支持显式 id
2. server：`JSON.parse("null")` 一包崩服 + 无 `ws.on('error')` + 无 `maxPayload` → 补守卫（1MB 上限）
3. 数值零校验：spawn/config/drag 的 NaN、1e308、负质量直进模拟 → 校验层（有限数、mass/坐标范围、每玩家天体预算 + 生成限速）
4. `config` patch 绕过权限：`{paused:true}` 无投票暂停全房 → patch 白名单
5. **hostsave 可接管任意有人房间** → 只允许新房或空房
6. `clone()` 不复制 `perf` → 离线预演/观测档位不一致
7. renderer 质心标记被嵌在 `if (selectedId)` 里（上次移动代码的括号 bug）→ 移出
8. `predictCache` 永不淘汰 → LRU
9. 超新星/升级后天体 name/color/glow 不重发（manifest 只发新 id）→ 元数据脏集合
10. 服务器快照带轨迹（每房间几十 MB）→ 快照去轨迹
11. leaveRoom 不清 `held` 天体 → 冻结 Forever

## 阶段 1：sim 层共享模块抽取

- `sim/config.ts`：全部魔法数命名集中（碰撞阈值 vEsc×1.5/0.3/0.5/0.7、恢复系数、冷却、碎片上限、生命周期 absorbed 比例、ISCO、视界捕获、子步档）
- `sim/orbit.ts`：resolveOrbitHost / circularVelocity / escapeSpeed / barycenter（engine、Home、renderer 三处去重）
- `sim/format.ts`：fmtMass / fmtTime / fmtRealTime / fmtRealMass / fmtSimTime（StatsBar、Dock、Home 各自为政）
- `sim/trail.ts`：recordTrail + ageEffects 共享（engine / net / future 三份实现常数还不一致——net 里硬编码 70/320 无视性能档）
- `sim/lifecycle.ts`：starAppearance + STAR_SUBBANDS（800/4000/16000 目前在引擎和 Dock 文案里重复）+ starStageFor + starEvolutionRate + applyStarStage
- `types.ts`：收编 SelOrbitInfo/ShipTelInfo（现在在 Home 和组件里重复定义）；删 ResolvedPerf、future.ts 死导出；`SpawnSettings.kind` → `deployingShip: boolean`
- `presets.ts`：makeTracerGalaxy / circularOrbit 去重；非 real 预设不再假还 REAL_UNITS

## 阶段 2：前端解构（Home.tsx 1613 行 → <400）

- hooks（全部从 Home 拆出）：
  - `useSimulationRuntime`：rAF 主循环 + 物理分发 + 追踪相机 + resize
  - `useShipControls`：键盘/摇杆 → 推力（固定/随手摇杆两份向量数学合一）
  - `usePointerGestures`：抓取/拖拽/生成预览/捏合/滚轮/拾取
  - `useTelemetry`：400ms 统计 + 轨道根数 + 飞船遥测
  - `useSaveLibrary`：存档 CRUD / 自动保存 / 导入导出
  - `useNetRoom`：net 事件全部收进一个 useEffect（现在 5 个回调在 render 体里反复重赋值）+ 显式连接/重连
  - `useMenuFlow`：screen/menuOpen + 主菜单四个流程
- 渲染体 ref 影子（modeRef/spawnCfgRef/…8 个）收进 hook 内部单一来源
- `sections/primitives.tsx`：GlassButton / Row / ToggleRow / Seg / Overlay（MainMenu/GameMenu/Dock/SelectedCard 的复制粘贴按钮样式合一）
- `renderer.ts` 分层：drawTrails / drawBarycenter / drawBodies / drawEffects / drawSpawnPreview；渐变按颜色+半径桶缓存；`draw()` 11 个位置参数改对象

## 阶段 3：服务器健壮化 + 协议 v2（可破坏）

- 二进制帧加版本头；删死字段（Effect.kind 'spawn' 从未产生、StarStage 'neutron' 从未返回）
- 房间总数上限（32）+ 空闲房回收（10 分钟）；tickVote 仅变化时广播；votecall action 白名单（垃圾 action 现在会永久占坑）
- 离开者创建的天体归属回收（现在永远 dead owner 只读）
- hostsave 全字段校验（kind 白名单/有限数/id 唯一/去重）
- smoke 扩展：host 权限矩阵、null 包不崩、NaN spawn 拒绝、房间接管拒绝

## 阶段 4：死代码与依赖清理

- 删 `src/components/ui/` 52 个文件（零引用）+ `src/hooks/use-mobile.ts` + 空的 `src/types/`
- 删依赖：zod、date-fns、@hookform/resolvers、react-hook-form、recharts、embla-carousel-react、vaul、cmdk、sonner、next-themes、input-otp、react-day-picker、react-resizable-panels、仅被死 ui 引用的 @radix-ui/* 与 clsx/tailwind-merge（确认后删）
- 删 4 处配置里的死 `@/*` alias；处理 components.json（路径错误，直接删）
- package.json：删与 start 重复的 start:kimi；build:server 直出 `dist/server/`（去掉 dist-server 中转层）；eslint ignores 补
- README 同步重写（质量段/生命周期/主菜单/房主/TEST_PORT，修 npm start 说明）

## 阶段 5：最终验证

- `tsc -b`（覆盖服务器）+ `npm test`（引擎单测）+ `npm run smoke`（扩展版 16+ 项）+ `npm run build`
- 手动清单：主菜单四入口 → 空白宇宙碰撞三结局 → 存档往返 → 联机全流程（放恒星/投票/房主/解散）→ ×1000 生命周期

## 风险与预算

- 阶段 2 风险最高（行为回归），靠 smoke + 单测 + 手动清单兜底；每阶段独立 commit，出问题可回退
- 协议 v2 后旧客户端无法连接（已确认可接受）；旧 IndexedDB 存档忽略（已确认可接受）
