# -*- coding: utf-8 -*-
import io

# ============ useMenuFlow.ts 全量重写（去联机） ============
menu = """/**
 * MC 式双层界面流程：主菜单（screen）↔ 游戏，游戏内菜单覆盖层（menuOpen）。
 */
import { useCallback, useState } from 'react'
import { loadPreset, PRESETS } from '../../sim/presets'
import { getSave, putAutosave } from '../../sim/saveStore'
import type { PresetId, UnitProfile } from '../../sim/types'
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
  const { localSim, future, camRef, unitsRef, baseTimeScaleRef, userTouchedRef } = rt
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
      rt.userTouchedRef.current = true
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

  /** 主菜单：载入本地世界 */
  const loadSaveFromMenu = useCallback(
    async (id: string) => {
      rt.userTouchedRef.current = true
      try {
        const rec = await getSave(id)
        if (!rec) {
          p.showSaveMsg('存档不存在')
          return
        }
        localSim.restoreWorld(rec.state)
        baseTimeScaleRef.current = rec.state.config.timeScale
        const pid = rec.state.preset
        if (pid && PRESETS.some((pr) => pr.id === pid)) {
          const probe = new Simulation()
          const { zoom, units: u } = loadPreset(probe, pid as PresetId)
          camRef.current = rec.state.camera ?? { x: 0, y: 0, zoom }
          rt.unitsRef.current = u
          p.setUnits(u)
          p.setCurrentPreset(pid as PresetId)
        } else {
          camRef.current = rec.state.camera ?? { x: 0, y: 0, zoom: 1 }
          rt.unitsRef.current = undefined
          p.setUnits(undefined)
          p.setCurrentPreset('empty')
        }
        p.setSelectedId(null)
        p.setFollow(false)
        future.invalidate()
        p.saveAutosave()
        setScreen('game')
        p.rerender()
      } catch (e) {
        p.showSaveMsg(`载入失败：${e instanceof Error ? e.message : String(e)}`)
      }
    },
    [localSim, future, rt, p],
  )

  return { screen, setScreen, menuOpen, setMenuOpen, autosaveInfo, setAutosaveInfo, startLocalWorld, exitToMenu, loadSaveFromMenu }
}
"""
io.open('src/pages/hooks/useMenuFlow.ts', 'w', encoding='utf-8', newline='\n').write(menu)
print('menuFlow ok')

# ============ useSaves / useWorldOps 残留清理 ============
p = 'src/pages/hooks/useSaves.ts'
s = io.open(p, encoding='utf-8').read()
s = s.replace("    if (rt.onlineRef.current) return // 联机时权威在房间，不覆盖本地自动存档\n", "")
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)

p = 'src/pages/hooks/useWorldOps.ts'
s = io.open(p, encoding='utf-8').read()
# 删除未使用的 adoptPresetPresentation（预设呈现已并入 applyPreset 本地分支）
start = s.index('  /** 采用预设的呈现')
end = s.index('  const onConfig = useCallback(')
s = s[:start] + s[end:]
# onConfig/applyWarp 里残留的 net 发送
s = s.replace("""      if (timeScale != null) {
        rt.baseTimeScaleRef.current = timeScale
        if (rt.onlineRef.current) {
          net.send({ type: 'config', patch: { timeScale: timeScale * rt.warpRef.current } })
        } else {
          localSim.config.timeScale = timeScale * rt.warpRef.current
          future.invalidate() // 流速变了，按旧流速推的缓冲未来作废
        }
      }""", """      if (timeScale != null) {
        rt.baseTimeScaleRef.current = timeScale
        localSim.config.timeScale = timeScale * rt.warpRef.current
        future.invalidate() // 流速变了，按旧流速推的缓冲未来作废
      }""")
s = s.replace("""      rt.warpRef.current = w
      p.setWarp(w)
      if (rt.onlineRef.current) {
        net.send({ type: 'config', patch: { timeScale: rt.baseTimeScaleRef.current * w } })
      } else {
        localSim.config.timeScale = rt.baseTimeScaleRef.current * w
        future.invalidate()
      }
      p.rerender()""", """      rt.warpRef.current = w
      p.setWarp(w)
      localSim.config.timeScale = rt.baseTimeScaleRef.current * w
      future.invalidate()
      p.rerender()""")
s = s.replace("const { net, localSim, future } = rt", "const { localSim, future } = rt")
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('saves/worldOps ok')
