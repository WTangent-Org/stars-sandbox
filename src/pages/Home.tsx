/**
 * 页面组合层：把运行时 hooks 拼起来 + 全部 JSX。
 * 状态归属：useSaves（存档/提示）、useInput（交互/选中/模式/摇杆）、
 * useWorldOps（世界级操作）、useRuntime（HUD 统计/遥测）、useNetRoom（联机）、
 * useMenuFlow（主菜单/游戏菜单流程）。共享可变引用在 rt（rt.ts）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { NetStatus } from '../sim/net'
import { Simulation } from '../sim/engine'
import { loadPreset, PRESETS } from '../sim/presets'
import type { PresetId, ToolMode, UnitProfile } from '../sim/types'
import Dock from '../sections/Dock'
import GameMenu from '../sections/GameMenu'
import MainMenu, { type AutosaveInfo } from '../sections/MainMenu'
import SelectedCard from '../sections/SelectedCard'
import ShipTelemetry from '../sections/ShipTelemetry'
import StatsBar from '../sections/StatsBar'
import { loadPrefs, savePrefs, type Prefs } from '../sim/prefs'
import { putAutosave } from '../sim/saveStore'
import { fmtSimTime } from '../sim/format'
import { createRt } from './rt'
import { useNetRoom } from './hooks/useNetRoom'
import { useSaves } from './hooks/useSaves'
import { useWorldOps } from './hooks/useWorldOps'
import { useInput } from './hooks/useInput'
import { useRuntime } from './hooks/useRuntime'
import { useMenuFlow } from './hooks/useMenuFlow'

export default function Home() {
  const [rt] = useState(createRt)
  const { net, localSim, future } = rt

  // —— 偏好设置（摇杆模式/位置、预演时长、房号、性能档），localStorage 持久化 ——
  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs())
  rt.prefsRef.current = prefs
  const onPrefs = useCallback((patch: Partial<Prefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch }
      savePrefs(next)
      return next
    })
  }, [])

  const [, setTick] = useState(0)
  const rerender = useCallback(() => setTick((t) => t + 1), [])
  const [, setLobbyTick] = useState(0)
  const bumpLobby = useCallback(() => setLobbyTick((t) => t + 1), [])
  const [netStatus, setNetStatus] = useState<NetStatus>(net.status)
  const [units, setUnits] = useState<UnitProfile | undefined>(undefined)
  const [currentPreset, setCurrentPreset] = useState<PresetId>('real')
  rt.currentPresetRef.current = currentPreset

  // —— 单模式：在线 = 已连上服务器；激活模拟 = 在线用镜像、离线用本地 ——
  const online = netStatus === 'connected'
  rt.onlineRef.current = online
  const sim = online ? net.mirror : localSim
  rt.activeSimRef.current = sim

  // —— 存档库（含自动保存与提示语） ——
  const [autosaveInfo, setAutosaveInfo] = useState<AutosaveInfo | null>(null)
  const savesApi = useSaves({ rt, localSim, net, setAutosaveInfo })
  const { saves, saveMsg, showSaveMsg, saveAutosave, onSaveCurrent, onDeleteSave, onExportSave, onImportSave } = savesApi

  // —— 选中状态（单一来源在 Home；交互/菜单/联机 hooks 都可能复位它） ——
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [follow, setFollow] = useState(false)
  const [mode, setMode] = useState<ToolMode>('pan')

  // —— 主菜单 / 游戏菜单流程 ——
  const menu = useMenuFlow({ rt, rerender, saveAutosave, showSaveMsg, onPrefs, setUnits, setCurrentPreset, setSelectedId, setFollow, setAutosaveInfo })
  const { screen, setScreen, menuOpen, setMenuOpen, startLocalWorld, joinMultiplayer, exitToMenu, loadSaveFromMenu } = menu

  // —— 联机房间接线 ——
  const { joinRoomId, hostNewRoom, roomList, refreshRooms } = useNetRoom({ rt, netStatus, selectedId, setNetStatus, bumpLobby, showSaveMsg, rerender, setUnits, setCurrentPreset, setSelectedId, setFollow })
  
  // —— 世界级操作 ——
  const [warp, setWarp] = useState(1)
  const worldOps = useWorldOps({ rt, rerender, onPrefs, setUnits, setCurrentPreset, setSelectedId, setFollow, setWarp, setMode, showSaveMsg })
  const { spawnCfg, onConfig, applyWarp, applyPreset, doRewind, onClear, onSpawnSettings, deployShip } = worldOps

  /** 一键从联机切回单机：宇宙存本地 + 恢复进本地模拟，无缝继续（不用回主菜单） */
  const backToSingle = useCallback(async () => {
    try {
      const st = await net.requestState()
      st.camera = { ...rt.camRef.current }
      await putAutosave(st)
      setAutosaveInfo({ savedAt: Date.now(), bodies: st.bodies.length, preset: st.preset })
      localSim.restoreWorld(st)
      rt.baseTimeScaleRef.current = st.config.timeScale
      const pid = st.preset
      if (pid && PRESETS.some((pr) => pr.id === pid)) {
        const probe = new Simulation()
        const { zoom, units: u } = loadPreset(probe, pid as PresetId)
        rt.camRef.current = st.camera ?? { x: 0, y: 0, zoom }
        rt.unitsRef.current = u
        setUnits(u)
        setCurrentPreset(pid as PresetId)
      }
    } catch {
      /* 保存失败也照样回单机 */
    }
    if (net.isHost) net.closeRoom()
    else {
      rt.netDesiredRef.current = false
      net.disconnect()
    }
    setSelectedId(null)
    setFollow(false)
    rt.future.invalidate()
    rerender()
  }, [net, localSim, rt, setUnits, setCurrentPreset, setSelectedId, setFollow, setAutosaveInfo, rerender])

  // —— 暂停切换（空格与底部按钮共用；有主房里是房主特权） ——
  const togglePause = useCallback(() => {
    if (rt.onlineRef.current) {
      if (net.hostId != null && !net.isHost) {
        showSaveMsg('联机房间中暂停由房主控制')
        return
      }
      // 联机：暂停状态在服务器上，本地乐观翻转
      const next = !net.paused
      net.paused = next
      net.send({ type: 'pause', paused: next })
    } else {
      localSim.config.paused = !localSim.config.paused
    }
    rerender()
  }, [net, localSim, rerender, showSaveMsg, rt])

  // —— 输入层（键盘 + 指针手势 + 摇杆；状态单一来源在本组件） ——
  const { setJoystick, joystick, joyAnchor, onPointerDown, onPointerMove, onPointerUp, onWheel } = useInput({
    rt,
    rerender,
    togglePause,
    localSim,
    net,
    future,
    mode,
    setMode,
    spawnCfg,
    selectedId,
    setSelectedId,
    follow,
    setFollow,
  })


  // —— 运行时（启动恢复 + rAF 主循环 + 遥测） ——
  const { stats, selOrbit, shipTel } = useRuntime({ rt, rerender, setUnits, setCurrentPreset, setAutosaveInfo })

  // —— 性能档变化：落到本地与镜像两个模拟（渲染端行为，不进服务器） ——
  useEffect(() => {
    localSim.config.perfTier = prefs.perfTier
    net.mirror.config.perfTier = prefs.perfTier
  }, [prefs.perfTier, localSim, net])



  // 统一交互状态：useInput 持有，这里取用（保持单一来源）
  const selId = selectedId
  const isTouch = useMemo(() => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches, [])
  // stats 每 400ms 刷新一次：天体对象是原地突变的，靠它驱动 selected 重取
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const selected = useMemo(() => sim.bodies.find((b) => b.id === selId) ?? null, [sim, selId, stats])

  const hintText =
    mode === 'spawn'
      ? spawnCfg.kind === 'ship'
        ? '点击画布部署飞船（自动进入环绕轨道）· ESC 取消'
        : '点击放置（自动圆轨道开启时获得环绕速度）· 按住拖拽拉虚线定初速度 · ESC 取消'
      : '拖动天体移动 / 甩出 · 拖动空白平移 · 滚轮缩放 · 空格暂停'

  const paused = online ? net.paused : localSim.config.paused
  return (
    <div className="scanlines relative h-full w-full overflow-hidden bg-[#050810]">
      <canvas
        ref={rt.canvasRef}
        className={`absolute inset-0 touch-none ${mode === 'spawn' ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
      />

      {/* 左上：HUD（收起面板的把手长在停靠栏标题行里） */}
      {screen === 'game' && (
        <>
          <div className="pointer-events-none absolute left-3 top-3 z-10 origin-top-left scale-[0.72] sm:left-5 sm:top-5 sm:scale-100">
            <StatsBar stats={stats} running={!paused} units={units} />
          </div>

          {/* 右上：☰ 菜单（联机/性能状态在 Dock 系统页与菜单内） */}
          <div className="absolute right-3 top-3 z-10 sm:right-5 sm:top-5">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="glass pointer-events-auto rounded-md px-3 py-1.5 font-mono text-[10px] tracking-[0.2em] text-[#5b6b8c] transition-colors hover:text-[#dbe4f3]"
            >
              {menuOpen ? '关闭 ×' : '☰ 菜单'}
            </button>
          </div>

          {/* 左侧：停靠栏（世界/创造/系统）——挂在 HUD 下方 */}
          <div className="absolute left-3 top-[56px] z-10 sm:left-5">
            <Dock
              config={sim.config}
              onConfig={onConfig}
              mode={mode}
              onMode={setMode}
              spawn={spawnCfg}
              onSpawn={onSpawnSettings}
              currentPreset={currentPreset}
              onPreset={applyPreset}
              onResetScene={() => applyPreset(currentPreset)}
              onClear={onClear}
              hasShip={sim.bodies.some((b) => b.kind === 'ship' && b.alive)}
              onDeployShip={deployShip}
              prefs={prefs}
              onPrefs={onPrefs}
              net={{
                status: netStatus,
                online,
                room: net.room,
                players: net.players,
                youId: net.you?.id,
                hostName: net.hostId != null ? net.players.find((pl) => pl.id === net.hostId)?.name ?? null : null,
                isHost: net.isHost,
              }}
              onCloseRoom={() => net.closeRoom()}
              onBackToSingle={() => void backToSingle()}
              saves={saves}
              saveMsg={saveMsg}
              onSaveCurrent={() => void onSaveCurrent()}
              onLoadSave={(id) => void loadSaveFromMenu(id)}
              onDeleteSave={(id) => void onDeleteSave(id)}
              onExportSave={(id) => void onExportSave(id)}
              onImportSave={() => void onImportSave()}
              lastRoom={prefs.roomCode || undefined}
              roomList={roomList}
              onJoinRoom={joinRoomId}
              onNewRoom={hostNewRoom}
              onRefreshRooms={refreshRooms}
            />
          </div>

          {/* 底部居中：时间控制条（回退 / 暂停 / 倍率 / T+ 读数） */}
          <div className="glass pointer-events-auto absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-md px-2 py-1">
            <button
              onClick={doRewind}
              disabled={!online && localSim.snapshotCount === 0}
              title="回退到上一个时间点（约每1.5秒一帧快照）"
              className="rounded px-2 py-1 font-mono text-[10px] text-[#5b6b8c] transition-colors hover:text-[#dbe4f3] disabled:opacity-30"
            >
              ⏪ 回退
            </button>
            <div className="h-3.5 w-px bg-[#1a2540]" />
            <button
              onClick={togglePause}
              title="空格键"
              className={`rounded px-2 py-1 font-mono text-[10px] transition-colors ${
                paused ? 'text-[#fbbf24] hover:text-[#fde68a]' : 'text-[#5b6b8c] hover:text-[#dbe4f3]'
              }`}
            >
              {paused ? '▶ 继续' : '❚❚ 暂停'}
            </button>
            <div className="h-3.5 w-px bg-[#1a2540]" />
            <button
              onClick={() => applyWarp(warp === 1 ? 10 : warp === 10 ? 100 : warp === 100 ? 1000 : 1)}
              title="时间倍率：点击循环 ×1 → ×10 → ×100 → ×1000"
              className="rounded px-2 py-1 font-mono text-[10px] text-[#22d3ee] transition-all hover:bg-[#22d3ee]/10"
            >
              ×{warp}
            </button>
            <div className="h-3.5 w-px bg-[#1a2540]" />
            <span className="px-2 font-mono text-[10px] text-[#5b6b8c]" title="模拟时间">
              T+ <span className="text-[#dbe4f3]">{fmtSimTime(stats.simTime, units)}</span>
            </span>
          </div>

          {/* 底部：操作提示（时间条上方） */}
          <div className="pointer-events-none absolute bottom-16 left-1/2 z-10 hidden -translate-x-1/2 sm:block">
            <div className="glass rounded-md px-5 py-1.5 font-mono text-[10.5px] tracking-wider text-[#5b6b8c]">{hintText}</div>
          </div>

          {/* 联机投票横幅 */}
          {online && net.vote && (
            <div className="glass mg-fadeup pointer-events-auto absolute left-1/2 top-14 z-30 w-[min(340px,86vw)] -translate-x-1/2 rounded-lg p-3">
              <div className="flex items-center justify-between">
                <div className="text-[12px] text-[#dbe4f3]">
                  {net.vote.initiator} 发起：
                  {{ pause: net.vote.paused === false ? '恢复运行' : '暂停', rewind: '回退时间', clear: '清空宇宙', preset: `切换预设` }[net.vote.action]}
                  {net.vote.action === 'preset' && net.vote.preset ? `「${net.vote.preset}」` : ''}
                </div>
                <div className="font-mono text-[10px] text-[#5b6b8c]">{net.vote.ttl}s</div>
              </div>
              <div className="mt-1.5 h-1 overflow-hidden rounded bg-[#1a2540]">
                <div
                  className="h-full bg-[#34d399] transition-all"
                  style={{ width: `${Math.min(100, (net.vote.yes / Math.max(net.vote.total, 1)) * 100)}%` }}
                />
              </div>
              <div className="mt-1 font-mono text-[9px] text-[#5b6b8c]">
                同意 {net.vote.yes} / 反对 {net.vote.no} / 共 {net.vote.total} 人 · 过半同意即执行
              </div>
              <div className="mt-2 flex gap-1.5">
                <button
                  onClick={() => net.castVote(true)}
                  className="flex-1 rounded border border-[#34d399]/40 bg-[#34d399]/10 px-2 py-1 text-[11px] text-[#34d399] hover:bg-[#34d399]/20"
                >
                  同意
                </button>
                <button
                  onClick={() => net.castVote(false)}
                  className="flex-1 rounded border border-[#f87171]/40 bg-[#f87171]/10 px-2 py-1 text-[11px] text-[#f87171] hover:bg-[#f87171]/20"
                >
                  反对
                </button>
              </div>
            </div>
          )}

          {/* 触屏虚拟摇杆（有飞船且触屏设备时显示） */}
          {isTouch &&
            sim.bodies.some((b) => b.kind === 'ship' && b.alive) &&
            (prefs.joyMode === 'fixed' || joyAnchor) && (
              <div
                className="glass pointer-events-auto absolute z-20 h-28 w-28 touch-none rounded-full"
                style={
                  prefs.joyMode === 'float' && joyAnchor
                    ? { left: joyAnchor.x - 56, top: joyAnchor.y - 56, opacity: 0.85 }
                    : prefs.joySide === 'left'
                      ? { bottom: 80, left: 16 }
                      : { bottom: 80, right: 16 }
                }
                onPointerDown={(e) => {
                  if (prefs.joyMode === 'float') return // 浮动的按下已由画布热区处理
                  ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
                  const rect = e.currentTarget.getBoundingClientRect()
                  const nx = ((e.clientX - rect.left) / rect.width - 0.5) * 2
                  const ny = ((e.clientY - rect.top) / rect.height - 0.5) * 2
                  const m = Math.min(1, Math.hypot(nx, ny))
                  const a = Math.atan2(ny, nx)
                  rt.joystickRef.current = { active: true, x: Math.cos(a) * m, y: Math.sin(a) * m }
                  setJoystick({ ...rt.joystickRef.current })
                }}
                onPointerMove={(e) => {
                  if (!rt.joystickRef.current.active || prefs.joyMode === 'float') return
                  const rect = e.currentTarget.getBoundingClientRect()
                  const nx = ((e.clientX - rect.left) / rect.width - 0.5) * 2
                  const ny = ((e.clientY - rect.top) / rect.height - 0.5) * 2
                  const m = Math.min(1, Math.hypot(nx, ny))
                  const a = Math.atan2(ny, nx)
                  rt.joystickRef.current = { active: true, x: Math.cos(a) * m, y: Math.sin(a) * m }
                  setJoystick({ ...rt.joystickRef.current })
                }}
                onPointerUp={() => {
                  rt.joystickRef.current = { active: false, x: 0, y: 0 }
                  setJoystick({ active: false, x: 0, y: 0 })
                }}
                onPointerCancel={() => {
                  rt.joystickRef.current = { active: false, x: 0, y: 0 }
                  setJoystick({ active: false, x: 0, y: 0 })
                }}
              >
                <div className="absolute inset-0 rounded-full border border-[#22d3ee]/25" />
                <div className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#22d3ee]/40" />
                <div
                  className="absolute h-9 w-9 rounded-full border border-[#22d3ee]/50 bg-[#22d3ee]/20 shadow-[0_0_14px_rgba(34,211,238,0.35)]"
                  style={{ left: `calc(50% + ${joystick.x * 36}px)`, top: `calc(50% + ${joystick.y * 36}px)`, transform: 'translate(-50%,-50%)' }}
                />
                <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap font-mono text-[9px] tracking-[0.2em] text-[#5b6b8c]">
                  推进器摇杆
                </div>
              </div>
            )}

          {/* 左下：飞船控制台遥测；触屏固定摇杆在左侧时抬高避开 */}
          {shipTel && (
            <div
              className={`absolute z-10 ${
                isTouch && prefs.joyMode === 'fixed' && prefs.joySide === 'left' ? 'bottom-56 left-3' : 'bottom-4 left-3 sm:left-5'
              }`}
            >
              <ShipTelemetry tel={shipTel} units={units} isTouch={isTouch} />
            </div>
          )}

          {/* 右下：选中天体信息卡 */}
          {selected && (
            <div className="absolute bottom-4 right-3 z-10 sm:bottom-6 sm:right-5">
              <SelectedCard
                selected={selected}
                orbit={selOrbit}
                units={units}
                follow={follow}
                onToggleFollow={() => setFollow(!follow)}
                onDelete={() => {
                  if (rt.onlineRef.current) {
                    net.send({ type: 'remove', id: selected.id })
                  } else {
                    localSim.removeBody(selected.id)
                    rt.future.invalidate()
                  }
                  setSelectedId(null)
                }}
                net={online ? net : null}
              />
            </div>
          )}
        </>
      )}

      {/* 游戏内菜单按钮展开的覆盖层（Esc 不劫持，专按钮入口） */}
      {screen === 'game' && menuOpen && (
        <GameMenu
          online={online}
          isHost={net.isHost}
          room={net.room}
          saveMsg={saveMsg}
          onResume={() => setMenuOpen(false)}
          onExitToMenu={() => void exitToMenu()}
        />
      )}

      {/* MC 风格主菜单：世界（存档）是一级入口 */}
      {screen === 'menu' && (
        <MainMenu
          autosave={autosaveInfo}
          saves={saves}
          lastRoom={prefs.roomCode || undefined}
          onNewRoom={() => {
            hostNewRoom()
            setScreen('game')
          }}
          onContinue={() => setScreen('game')}
          onNewWorld={startLocalWorld}
          onLoadSave={(id) => void loadSaveFromMenu(id)}
          onDeleteSave={(id) => void onDeleteSave(id)}
          onExportSave={(id) => void onExportSave(id)}
          onImportSave={() => void onImportSave()}
          onJoinMultiplayer={joinMultiplayer}
        />
      )}

      {/* 存档/开房等操作的浮动提示 */}
      {screen === 'game' && !menuOpen && saveMsg && (
        <div className="pointer-events-none absolute bottom-16 left-1/2 z-30 -translate-x-1/2">
          <div className="glass mg-fadeup rounded-md px-4 py-1.5 font-mono text-[11px] text-[#34d399]">{saveMsg}</div>
        </div>
      )}
    </div>
  )
}

