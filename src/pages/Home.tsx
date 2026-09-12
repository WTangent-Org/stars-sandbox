import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PresetId, ToolMode, UnitProfile } from '../sim/types'
import Dock from '../sections/Dock'
import GameMenu from '../sections/GameMenu'
import Joystick from '../sections/Joystick'
import MainMenu from '../sections/MainMenu'
import SelectedCard from '../sections/SelectedCard'
import ShipTelemetry from '../sections/ShipTelemetry'
import StatsBar from '../sections/StatsBar'
import { loadPrefs, savePrefs, type Prefs } from '../sim/prefs'
import { fmtSimTime } from '../sim/format'
import { createRt } from './rt'
import { useSaves } from './hooks/useSaves'
import { useWorldOps } from './hooks/useWorldOps'
import { useInput } from './hooks/useInput'
import { useRuntime } from './hooks/useRuntime'
import { useMenuFlow } from './hooks/useMenuFlow'

export default function Home() {
  const [rt] = useState(createRt)
  const { localSim, future } = rt
  const isTouch = useMemo(() => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches, [])

  // —— 偏好设置（摇杆模式/位置、预演时长、性能档），localStorage 持久化 ——
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
  const [units, setUnits] = useState<UnitProfile | undefined>(undefined)
  const [currentPreset, setCurrentPreset] = useState<PresetId>('real')
  rt.currentPresetRef.current = currentPreset
  const sim = localSim

  // —— 存档库（含自动保存与提示语） ——
  const { saves, autosaveMeta, saveMsg, showSaveMsg, saveAutosave, onSaveCurrent, onDeleteSave, onExportSave, onImportSave } =
    useSaves({ rt, localSim })

  // —— 选中状态（单一来源在 Home；交互/菜单 hooks 都可能复位它） ——
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [follow, setFollow] = useState(false)
  const [mode, setMode] = useState<ToolMode>('pan')
  rt.modeRef.current = mode

  // —— 主菜单 / 游戏菜单流程 ——
  const menu = useMenuFlow({ rt, rerender, saveAutosave, showSaveMsg, setUnits, setCurrentPreset, setSelectedId, setFollow })
  const { screen, setScreen, menuOpen, setMenuOpen, exitToMenu, loadWorld } = menu

  // —— 世界级操作 ——
  const [warp, setWarp] = useState(1)
  const worldOps = useWorldOps({ rt, rerender, onPrefs, setUnits, setCurrentPreset, setSelectedId, setFollow, setWarp, setMode, showSaveMsg })
  const { spawnCfg, onConfig, applyWarp, applyPreset, doRewind, onClear, onSpawnSettings, deployShip } = worldOps

  /** 主菜单「新的世界」：切预设进游戏（applyPreset 负责场景，这里只管流程） */
  const startNewWorld = useCallback(
    (id: PresetId) => {
      applyPreset(id)
      void saveAutosave()
      setScreen('game')
    },
    [applyPreset, saveAutosave, setScreen],
  )

  // —— 暂停切换（空格与底部按钮共用） ——
  const togglePause = useCallback(() => {
    localSim.config.paused = !localSim.config.paused
    rerender()
  }, [localSim, rerender])

  // —— 输入层（键盘 + 指针手势 + 摇杆） ——
  const { setJoystick, joystick, joyAnchor, onPointerDown, onPointerMove, onPointerUp, onWheel } = useInput({
    rt,
    rerender,
    togglePause,
    localSim,
    future,
    mode,
    setMode,
    spawnCfg,
    selectedId,
    setSelectedId,
    follow,
    setFollow,
  })
  rt.spawnCfgRef.current = spawnCfg
  rt.selectedRef.current = selectedId
  rt.followRef.current = follow

  // —— 运行时（启动恢复 + rAF 主循环 + 遥测） ——
  const { stats, selOrbit, shipTel } = useRuntime({ rt, rerender, setUnits, setCurrentPreset, setSelectedId, setFollow })

  // —— 性能档变化：落到本地模拟 ——
  useEffect(() => {
    localSim.config.perfTier = prefs.perfTier
  }, [prefs.perfTier, localSim])

  // stats 每 400ms 刷新一次：天体对象是原地突变的，靠它驱动 selected 重取
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const selected = useMemo(() => sim.bodies.find((b) => b.id === selectedId) ?? null, [sim, selectedId, stats])

  const hintText =
    mode === 'spawn'
      ? spawnCfg.kind === 'ship'
        ? '点击画布部署飞船（自动进入环绕轨道）· ESC 取消'
        : '点击放置（自动圆轨道开启时获得环绕速度）· 按住拖拽拉虚线定初速度 · ESC 取消'
      : '拖动天体移动 / 甩出 · 拖动空白平移 · 滚轮缩放 · 空格暂停'

  const paused = localSim.config.paused

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

      {screen === 'game' && (
        <>
          {/* 左上：精简 HUD */}
          <div className="pointer-events-none absolute left-3 top-3 z-10 origin-top-left scale-[0.72] sm:left-5 sm:top-5 sm:scale-100">
            <StatsBar stats={stats} running={!paused} units={units} />
          </div>

          {/* 右上：☰ 菜单 */}
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
              saves={saves}
              saveMsg={saveMsg}
              onSaveCurrent={() => void onSaveCurrent()}
              autosaveMeta={autosaveMeta}
              onLoadAutosave={() => void loadWorld('autosave')}
              onLoadSave={(id) => void loadWorld(id)}
              onDeleteSave={(id) => void onDeleteSave(id)}
              onExportSave={(id) => void onExportSave(id)}
              onImportSave={() => void onImportSave()}
            />
          </div>

          {/* 底部居中：时间控制条 */}
          <div className="glass pointer-events-auto absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-md px-2 py-1">
            <button
              onClick={doRewind}
              disabled={localSim.snapshotCount === 0}
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

          {/* 底部：操作提示 */}
          <div className="pointer-events-none absolute bottom-16 left-1/2 z-10 hidden -translate-x-1/2 sm:block">
            <div className="glass rounded-md px-5 py-1.5 font-mono text-[10.5px] tracking-wider text-[#5b6b8c]">{hintText}</div>
          </div>

          {/* 触屏虚拟摇杆 */}
          {isTouch && sim.bodies.some((b) => b.kind === 'ship' && b.alive) && (prefs.joyMode === 'fixed' || joyAnchor) && (
            <Joystick rt={rt} prefs={prefs} joy={joystick} setJoy={setJoystick} anchor={joyAnchor} />
          )}

          {/* 左下：飞船控制台遥测 */}
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
                  localSim.removeBody(selected.id)
                  future.invalidate()
                  setSelectedId(null)
                }}
              />
            </div>
          )}
        </>
      )}

      {/* 游戏内菜单 */}
      {screen === 'game' && menuOpen && (
        <GameMenu saveMsg={saveMsg} onResume={() => setMenuOpen(false)} onExitToMenu={() => void exitToMenu()} />
      )}

      {/* 主菜单：存档列表是一级入口（自动存档为绿色首行） */}
      {screen === 'menu' && (
        <MainMenu
          autosave={autosaveMeta}
          onLoadAutosave={() => void loadWorld('autosave')}
          saves={saves}
          onNewWorld={startNewWorld}
          onLoadSave={(id) => void loadWorld(id)}
          onDeleteSave={(id) => void onDeleteSave(id)}
          onExportSave={(id) => void onExportSave(id)}
          onImportSave={() => void onImportSave()}
        />
      )}

      {/* 存档等操作的浮动提示 */}
      {screen === 'game' && !menuOpen && saveMsg && (
        <div className="pointer-events-none absolute bottom-16 left-1/2 z-30 -translate-x-1/2">
          <div className="glass mg-fadeup rounded-md px-4 py-1.5 font-mono text-[11px] text-[#34d399]">{saveMsg}</div>
        </div>
      )}
    </div>
  )
}
