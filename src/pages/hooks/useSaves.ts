/**
 * 本地存档库：自动存档 + 槽位 CRUD / 导入导出。全部存在浏览器 IndexedDB（本地，非 cookie）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Simulation } from '../../sim/engine'
import { exportSaveFile, importSaveFile } from '../../sim/saveFile'
import { deleteSave, getAutosave, getSave, listSaves, putAutosave, putSave, type SaveMeta } from '../../sim/saveStore'
import type { AutosaveInfo } from '../../sections/MainMenu'
import type { Rt } from '../rt'

/** 自动存档摘要（列表首行展示用） */
export interface AutosaveMeta {
  savedAt: number
  bodies: number
  preset?: string
}

interface Params {
  rt: Rt
  localSim: Simulation
  setAutosaveInfo: (info: AutosaveInfo | null) => void
}

export function useSaves(p: Params) {
  const { rt } = p
  const [saves, setSaves] = useState<SaveMeta[]>([])
  const [autosaveMeta, setAutosaveMeta] = useState<AutosaveMeta | null>(null)
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

  /** 同步自动存档摘要（世界页列表首行展示） */
  const refreshAutosave = useCallback(async () => {
    try {
      const rec = await getAutosave()
      setAutosaveMeta(rec ? { savedAt: rec.savedAt, bodies: rec.state.bodies.length, preset: rec.state.preset } : null)
    } catch {
      setAutosaveMeta(null)
    }
  }, [])

  /** 自动存档：把当前宇宙（含相机）写进 IndexedDB 单一槽位，启动时恢复 */
  const saveAutosave = useCallback(async () => {
    try {
      const state = p.localSim.serialize(rt.currentPresetRef.current)
      state.camera = { ...rt.camRef.current }
      await putAutosave(state)
      setAutosaveMeta({ savedAt: Date.now(), bodies: state.bodies.length, preset: state.preset })
    } catch {
      /* IndexedDB 不可用时静默 */
    }
  }, [rt, p.localSim])

  useEffect(() => {
    const t = setInterval(() => void saveAutosave(), 30000)
    const onHide = () => void saveAutosave()
    const onVis = () => {
      if (document.visibilityState === 'hidden') void saveAutosave()
    }
    window.addEventListener('pagehide', onHide)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      clearInterval(t)
      window.removeEventListener('pagehide', onHide)
      document.removeEventListener('visibilitychange', onVis)
      void saveAutosave()
    }
  }, [saveAutosave])

  // —— 挂载时拉一次存档列表与自动存档摘要 ——
  useEffect(() => {
    void refreshSaves()
    void refreshAutosave()
  }, [refreshSaves, refreshAutosave])

  const onSaveCurrent = async () => {
    try {
      const state = p.localSim.serialize(rt.currentPresetRef.current)
      state.camera = { ...rt.camRef.current }
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

  return {
    saves,
    autosaveMeta,
    refreshAutosave,
    saveMsg,
    showSaveMsg,
    refreshSaves,
    saveAutosave,
    onSaveCurrent,
    onDeleteSave,
    onExportSave,
    onImportSave,
  }
}
