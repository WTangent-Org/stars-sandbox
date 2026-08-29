/**
 * 本地存档库：槽位 CRUD / 导入导出 / 30 秒自动保存（含相机视野）。
 * 联机时自动保存不覆盖本地槽位（权威在房间）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Simulation } from '../../sim/engine'
import type { NetSim } from '../../sim/net'
import { exportSaveFile, importSaveFile } from '../../sim/saveFile'
import { deleteSave, getSave, listSaves, putAutosave, putSave, type SaveMeta } from '../../sim/saveStore'
import type { AutosaveInfo } from '../../sections/MainMenu'
import type { Rt } from '../rt'

interface Params {
  rt: Rt
  localSim: Simulation
  net: NetSim
  setAutosaveInfo: (info: AutosaveInfo | null) => void
}

export function useSaves(p: Params) {
  const { rt } = p
  const [saves, setSaves] = useState<SaveMeta[]>([])
  const [saveMsg, setSaveMsg] = useState('')
  const saveMsgTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /** 存档提示：5 秒后自动清空 */
  const showSaveMsg = useCallback((m: string) => {
    setSaveMsg(m)
    if (saveMsgTimerRef.current) clearTimeout(saveMsgTimerRef.current)
    saveMsgTimerRef.current = setTimeout(() => setSaveMsg(''), 5000)
  }, [])

  const refreshSaves = useCallback(async () => {
    try {
      setSaves(await listSaves())
    } catch {
      /* IndexedDB 不可用（隐私模式等）时静默 */
    }
  }, [])

  /** 自动存档：把当前离线宇宙（含相机）写进 IndexedDB 单一槽位，启动时恢复 */
  const saveAutosave = useCallback(() => {
    if (rt.onlineRef.current) return // 联机时权威在房间，不覆盖本地自动存档
    try {
      const state = p.localSim.serialize(rt.currentPresetRef.current)
      state.camera = { ...rt.camRef.current }
      void putAutosave(state)
    } catch {
      /* IndexedDB 不可用时静默 */
    }
  }, [rt, p.localSim])

  useEffect(() => {
    const t = setInterval(saveAutosave, 30000)
    const onHide = () => saveAutosave()
    const onVis = () => {
      if (document.visibilityState === 'hidden') saveAutosave()
    }
    window.addEventListener('pagehide', onHide)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      clearInterval(t)
      window.removeEventListener('pagehide', onHide)
      document.removeEventListener('visibilitychange', onVis)
      saveAutosave()
    }
  }, [saveAutosave])

  // —— 挂载时拉一次存档列表 ——
  useEffect(() => {
    void refreshSaves()
  }, [refreshSaves])

  const onSaveCurrent = async () => {
    try {
      const state = rt.onlineRef.current ? await p.net.requestState() : p.localSim.serialize(rt.currentPresetRef.current)
      if (!rt.onlineRef.current) state.camera = { ...rt.camRef.current }
      await putSave(`宇宙 ${new Date().toLocaleString('zh-CN')}`, state)
      await refreshSaves()
      showSaveMsg('已保存')
    } catch (e) {
      showSaveMsg(`保存失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const onDeleteSave = async (id: string) => {
    try {
      await deleteSave(id)
      await refreshSaves()
    } catch (e) {
      showSaveMsg(`删除失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const onExportSave = async (id: string) => {
    try {
      const rec = await getSave(id)
      if (rec) exportSaveFile(rec.name, rec.state)
    } catch (e) {
      showSaveMsg(`导出失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const onImportSave = async () => {
    try {
      const r = await importSaveFile()
      if (!r) return
      await putSave(r.name, r.state)
      await refreshSaves()
      showSaveMsg(`已导入「${r.name}」`)
    } catch (e) {
      showSaveMsg(`导入失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return { saves, saveMsg, showSaveMsg, refreshSaves, saveAutosave, onSaveCurrent, onDeleteSave, onExportSave, onImportSave }
}
