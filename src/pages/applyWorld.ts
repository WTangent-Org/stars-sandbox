/**
 * 把一份世界状态落进运行时：restoreWorld + 相机/单位/预设/基准流速恢复 + 选中复位。
 * 启动恢复与「载入存档」两条路径共用，保证行为一致。
 */
import { Simulation } from '../sim/engine'
import { loadPreset, PRESETS } from '../sim/presets'
import type { PresetId, UnitProfile, WorldState } from '../sim/types'
import type { Rt } from './rt'

/** 载入世界时需要一并复位的 UI 状态（单一来源在 Home） */
export interface WorldUi {
  setUnits: (u: UnitProfile | undefined) => void
  setCurrentPreset: (id: PresetId) => void
  setSelectedId: (id: number | null) => void
  setFollow: (v: boolean) => void
}

export function applyWorld(rt: Rt, state: WorldState, ui: WorldUi) {
  rt.localSim.restoreWorld(state)
  rt.future.invalidate()
  rt.selectedRef.current = null
  ui.setSelectedId(null)
  ui.setFollow(false)
  const pid = state.preset
  if (pid && PRESETS.some((pr) => pr.id === pid)) {
    // 合法预设：用探针恢复单位换算，相机用存档里的。
    // 基准流速归一化到预设默认值——存档里的 timeScale 是「基准×当时倍率」
    // 的合成值，直接当基准会让 1× 永远跑在旧倍率上
    const probe = new Simulation()
    const { zoom, units: u } = loadPreset(probe, pid as PresetId)
    rt.camRef.current = state.camera ?? { x: 0, y: 0, zoom }
    rt.unitsRef.current = u
    ui.setUnits(u)
    ui.setCurrentPreset(pid as PresetId)
    rt.baseTimeScaleRef.current = probe.config.timeScale
    rt.localSim.config.timeScale = probe.config.timeScale * rt.warpRef.current
  } else {
    rt.camRef.current = state.camera ?? { x: 0, y: 0, zoom: 1 }
    rt.unitsRef.current = undefined
    ui.setUnits(undefined)
    ui.setCurrentPreset('empty')
    rt.baseTimeScaleRef.current = state.config.timeScale
  }
}
