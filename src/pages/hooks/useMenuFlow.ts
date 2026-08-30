/**
 * MC 式双层界面流程：主菜单（screen）↔ 游戏，游戏内菜单覆盖层（menuOpen），
 * 以及四个主菜单流程：继续游戏由 Home 直接 setScreen；新世界/本地世界/多人在此。
 */
import { useCallback, useState } from 'react'
import { Simulation } from '../../sim/engine'
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
  onPrefs: (patch: { roomCode: string }) => void
  setUnits: (u: UnitProfile | undefined) => void
  setCurrentPreset: (id: PresetId) => void
  setSelectedId: (id: number | null) => void
  setFollow: (v: boolean) => void
  setAutosaveInfo: (info: AutosaveInfo | null) => void
}

export function useMenuFlow(p: Params) {
  const { rt } = p
  const { net, localSim, future, camRef, unitsRef, baseTimeScaleRef, userTouchedRef, netDesiredRef } = rt
  // MC 式双层界面：menu = 主菜单（世界列表/多人），game = 游戏；menuOpen = 游戏内菜单覆盖层
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

  /** 开始一个本地世界（若在联机则先断开：本地世界与房间无关） */
  const startLocalWorld = useCallback(
    (id: PresetId) => {
      userTouchedRef.current = true
      netDesiredRef.current = false
      net.disconnect()
      const { zoom, units: u } = loadPreset(localSim, id)
      camRef.current = { x: 0, y: 0, zoom }
      baseTimeScaleRef.current = localSim.config.timeScale
      unitsRef.current = u
      p.setUnits(u)
      p.setCurrentPreset(id)
      p.setSelectedId(null)
      p.setFollow(false)
      future.fork(localSim)
      p.saveAutosave()
      setScreen('game')
      p.rerender()
    },
    [net, localSim, future, rt, p],
  )

  /** 从主菜单进入多人游戏：连接服务器（房号留空 = 公共大厅），进游戏后由房间呈现 */
  const joinMultiplayer = useCallback(
    (roomCode: string) => {
      p.onPrefs({ roomCode })
      net.pendingRoom = roomCode
      netDesiredRef.current = true
      net.connect()
      setScreen('game')
    },
    [net, rt, p],
  )

  /** 游戏菜单：保存并退出到主菜单。联机时把房间宇宙回收进自己的自动存档（MC：世界跟着人走） */
  const exitToMenu = useCallback(async () => {
    try {
      if (rt.onlineRef.current) {
        const state = await net.requestState()
        state.camera = { ...camRef.current }
        await putAutosave(state)
        setAutosaveInfo({ savedAt: Date.now(), bodies: state.bodies.length, preset: state.preset })
      } else {
        p.saveAutosave()
      }
    } catch {
      /* 保存失败也照样退出 */
    }
    if (rt.onlineRef.current) {
      if (net.isHost) {
        net.closeRoom() // 房主：房随人走，客人收到 roomClosed
      } else {
        netDesiredRef.current = false
        net.disconnect()
      }
    }
    setMenuOpen(false)
    setScreen('menu')
    p.rerender()
  }, [net, rt, p, setAutosaveInfo])

  /** 主菜单：载入本地世界（强制离线进入；联机中先断开） */
  const loadSaveFromMenu = useCallback(
    async (id: string) => {
      userTouchedRef.current = true
      try {
        const rec = await getSave(id)
        if (!rec) {
          p.showSaveMsg('存档不存在')
          return
        }
        if (rt.onlineRef.current) {
          netDesiredRef.current = false
          net.disconnect()
        }
        localSim.restoreWorld(rec.state)
        baseTimeScaleRef.current = rec.state.config.timeScale
        const pid = rec.state.preset
        if (pid && PRESETS.some((pr) => pr.id === pid)) {
          const probe = new Simulation()
          const { zoom, units: u } = loadPreset(probe, pid as PresetId)
          camRef.current = rec.state.camera ?? { x: 0, y: 0, zoom }
          unitsRef.current = u
          p.setUnits(u)
          p.setCurrentPreset(pid as PresetId)
        } else {
          camRef.current = rec.state.camera ?? { x: 0, y: 0, zoom: 1 }
          unitsRef.current = undefined
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
    [net, localSim, future, rt, p],
  )

  return { screen, setScreen, menuOpen, setMenuOpen, autosaveInfo, setAutosaveInfo, startLocalWorld, joinMultiplayer, exitToMenu, loadSaveFromMenu }
}
