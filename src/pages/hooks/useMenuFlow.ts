/**
 * MC 式双层界面流程：主菜单（screen）↔ 游戏，游戏内菜单覆盖层（menuOpen）。
 */
import { useCallback, useState } from 'react'
import { loadPreset, PRESETS } from '../../sim/presets'
import { getAutosave, getSave } from '../../sim/saveStore'
import { Simulation } from '../../sim/engine'
import type { PresetId, UnitProfile, WorldState } from '../../sim/types'
import type { AutosaveInfo } from '../../sections/MainMenu'
import type { Rt } from '../rt'

interface Params {
  rt: Rt
  rerender: () => void
  saveAutosave: () => void
  showSaveMsg: (m: string) => void
  setUnits: (u: UnitProfile | undefined) => void
  setCurrentPreset: (id: PresetId) => void
  setSelectedId: (id: number | null) => void
  setFollow: (v: boolean) => void
  setAutosaveInfo: (info: AutosaveInfo | null) => void
}

export function useMenuFlow(p: Params) {
  const { rt } = p
  const { localSim, future, camRef, baseTimeScaleRef, userTouchedRef } = rt
  // MC 式双层界面：menu = 主菜单（世界列表），game = 游戏；menuOpen = 游戏内菜单覆盖层
  const [screen, setScreen] = useState<'menu' | 'game'>('menu')
  const [menuOpen, setMenuOpen] = useState(false)
  const [autosaveInfo, setAutosaveInfoLocal] = useState<AutosaveInfo | null>(null)

  const setAutosaveInfo = useCallback(
    (info: AutosaveInfo | null) => {
      setAutosaveInfoLocal(info)
      p.setAutosaveInfo(info)
    },
    [p],
  )

  /** 开始一个本地世界（载入预设场景） */
  const startLocalWorld = useCallback(
    (id: PresetId) => {
      userTouchedRef.current = true
      const { zoom, units: u } = loadPreset(localSim, id)
      camRef.current = { x: 0, y: 0, zoom }
      baseTimeScaleRef.current = localSim.config.timeScale
      rt.unitsRef.current = u
      p.setUnits(u)
      p.setCurrentPreset(id)
      p.setSelectedId(null)
      p.setFollow(false)
      future.fork(localSim)
      p.saveAutosave()
      setScreen('game')
      p.rerender()
    },
    [localSim, future, rt, p],
  )

  /** 游戏菜单：保存并退出到主菜单 */
  const exitToMenu = useCallback(async () => {
    try {
      p.saveAutosave()
    } catch {
      /* 保存失败也照样退出 */
    }
    setMenuOpen(false)
    setScreen('menu')
    p.rerender()
  }, [p])

  /** 恢复一份世界状态（相机优先用存档值；预设合法时恢复单位换算） */
  const restoreState = useCallback(
    (state: WorldState) => {
      localSim.restoreWorld(state)
      baseTimeScaleRef.current = state.config.timeScale
      const pid = state.preset
      if (pid && PRESETS.some((pr) => pr.id === pid)) {
        const probe = new Simulation()
        const { zoom, units: u } = loadPreset(probe, pid as PresetId)
        camRef.current = state.camera ?? { x: 0, y: 0, zoom }
        rt.unitsRef.current = u
        p.setUnits(u)
        p.setCurrentPreset(pid as PresetId)
      } else {
        camRef.current = state.camera ?? { x: 0, y: 0, zoom: 1 }
        rt.unitsRef.current = undefined
        p.setUnits(undefined)
        p.setCurrentPreset('empty')
      }
      p.setSelectedId(null)
      p.setFollow(false)
      future.invalidate()
    },
    [localSim, future, rt, p],
  )

  /** 载入自动存档（列表首行「自动存档」） */
  const loadAutosave = useCallback(
    async () => {
      userTouchedRef.current = true
      try {
        const rec = await getAutosave()
        if (!rec) {
          p.showSaveMsg('还没有自动存档，先玩一会儿吧')
          return
        }
        restoreState(rec.state)
        p.saveAutosave()
        setScreen('game')
        p.rerender()
      } catch (e) {
        p.showSaveMsg(`载入失败：${e instanceof Error ? e.message : String(e)}`)
      }
    },
    [rt, p, restoreState],
  )

  /** 主菜单：载入本地世界 */
  const loadSaveFromMenu = useCallback(
    async (id: string) => {
      userTouchedRef.current = true
      try {
        const rec = await getSave(id)
        if (!rec) {
          p.showSaveMsg('存档不存在')
          return
        }
        restoreState(rec.state)
        p.saveAutosave()
        setScreen('game')
        p.rerender()
      } catch (e) {
        p.showSaveMsg(`载入失败：${e instanceof Error ? e.message : String(e)}`)
      }
    },
    [localSim, rt, p, restoreState],
  )

  return { screen, setScreen, menuOpen, setMenuOpen, autosaveInfo, setAutosaveInfo, startLocalWorld, exitToMenu, loadSaveFromMenu, loadAutosave }
}
