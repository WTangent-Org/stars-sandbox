/**
 * MC 式双层界面流程：主菜单（screen）↔ 游戏，游戏内菜单覆盖层（menuOpen）。
 */
import { useCallback, useState } from 'react'
import { getAutosave, getSave } from '../../sim/saveStore'
import type { PresetId, UnitProfile } from '../../sim/types'
import type { Rt } from '../rt'
import { applyWorld } from '../applyWorld'

interface Params {
  rt: Rt
  rerender: () => void
  saveAutosave: () => void
  showSaveMsg: (m: string) => void
  setUnits: (u: UnitProfile | undefined) => void
  setCurrentPreset: (id: PresetId) => void
  setSelectedId: (id: number | null) => void
  setFollow: (v: boolean) => void
}

export function useMenuFlow(p: Params) {
  const { rt } = p
  const { userTouchedRef } = rt
  // MC 式双层界面：menu = 主菜单（世界列表），game = 游戏；menuOpen = 游戏内菜单覆盖层
  const [screen, setScreen] = useState<'menu' | 'game'>('menu')
  const [menuOpen, setMenuOpen] = useState(false)

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

  /** 载入并进入一个世界：'autosave' = 自动存档，否则为手动存档 id */
  const loadWorld = useCallback(
    async (src: 'autosave' | string) => {
      userTouchedRef.current = true
      try {
        const rec = src === 'autosave' ? await getAutosave() : await getSave(src)
        if (!rec) {
          p.showSaveMsg(src === 'autosave' ? '还没有自动存档，先玩一会儿吧' : '存档不存在')
          return
        }
        applyWorld(rt, rec.state, p)
        void p.saveAutosave()
        setScreen('game')
        p.rerender()
      } catch (e) {
        p.showSaveMsg(`载入失败：${e instanceof Error ? e.message : String(e)}`)
      }
    },
    [rt, p],
  )

  return { screen, setScreen, menuOpen, setMenuOpen, exitToMenu, loadWorld }
}
