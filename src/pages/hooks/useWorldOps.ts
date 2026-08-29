/**
 * 世界级操作：性能档/流速/时间倍率/预设切换/回退/清空/飞船部署。
 * 全局操作（暂停/回退/清空/切预设/流速）在联机有主房里是房主特权（MC 语义）。
 */
import { useCallback, useState } from 'react'
import { Simulation } from '../../sim/engine'
import { loadPreset } from '../../sim/presets'
import type { PresetId, SimConfig, SpawnSettings, UnitProfile } from '../../sim/types'
import type { ToolMode } from '../../sim/types'
import type { Rt } from '../rt'

interface Params {
  rt: Rt
  rerender: () => void
  onPrefs: (patch: { perfTier?: SimConfig['perfTier'] }) => void
  setUnits: (u: UnitProfile | undefined) => void
  setCurrentPreset: (id: PresetId) => void
  setSelectedId: (id: number | null) => void
  setFollow: (v: boolean) => void
  setWarp: (w: number) => void
  setMode: (m: ToolMode) => void
  showSaveMsg: (m: string) => void
}

export function useWorldOps(p: Params) {
  const { rt } = p
  const { net, localSim, future } = rt
  const [spawnCfg, setSpawnCfg] = useState<SpawnSettings>(rt.spawnCfgRef.current)

  /** 采用预设的呈现（相机/单位/流速/取消选中）；local=false 时只做探针不落本地模拟 */
  const adoptPresetPresentation = useCallback(
    (id: PresetId, cam?: { x: number; y: number; zoom: number }) => {
      const probe = new Simulation()
      const { zoom, units: u } = loadPreset(probe, id)
      rt.camRef.current = cam ?? { x: 0, y: 0, zoom }
      rt.baseTimeScaleRef.current = probe.config.timeScale
      rt.unitsRef.current = u
      p.setUnits(u)
      p.setCurrentPreset(id)
      p.setSelectedId(null)
      p.setFollow(false)
    },
    [rt, p],
  )

  const onConfig = useCallback(
    (patch: Partial<SimConfig>) => {
      const { perfTier, timeScale, ...rest } = patch
      // 性能档是渲染端行为：记入 prefs，由 effect 落到本地与镜像两个模拟
      if (perfTier != null) p.onPrefs({ perfTier })
      // 轨迹开关是纯本地渲染行为：两个模拟都写，不发服务器
      if (rest.trails != null) {
        localSim.config.trails = rest.trails
        net.mirror.config.trails = rest.trails
      }
      if (rest.trailsForever != null) {
        localSim.config.trailsForever = rest.trailsForever
        net.mirror.config.trailsForever = rest.trailsForever
      }
      // 滑杆调整的是基准流速，时间倍率在此基础上叠加
      if (timeScale != null) {
        rt.baseTimeScaleRef.current = timeScale
        if (rt.onlineRef.current) {
          net.send({ type: 'config', patch: { timeScale: timeScale * rt.warpRef.current } })
        } else {
          localSim.config.timeScale = timeScale * rt.warpRef.current
          future.invalidate() // 流速变了，按旧流速推的缓冲未来作废
        }
      }
      p.rerender()
    },
    [net, localSim, future, rt, p],
  )

  const applyWarp = useCallback(
    (w: number) => {
      rt.warpRef.current = w
      p.setWarp(w)
      if (rt.onlineRef.current) {
        net.send({ type: 'config', patch: { timeScale: rt.baseTimeScaleRef.current * w } })
      } else {
        localSim.config.timeScale = rt.baseTimeScaleRef.current * w
        future.invalidate()
      }
      p.rerender()
    },
    [net, localSim, future, rt, p],
  )

  const applyPreset = useCallback(
    (id: PresetId) => {
      rt.userTouchedRef.current = true
      if (rt.onlineRef.current) {
        if (net.hostId != null && !net.isHost) {
          p.showSaveMsg('联机房间中仅房主可切换预设')
          return
        }
        // 联机：预设切换发给服务器；呈现用一次性探针本地算出（与服务器端同一套预设表）
        net.send({ type: 'preset', id })
        adoptPresetPresentation(id)
        p.rerender()
        return
      }
      const { zoom, units: u } = loadPreset(localSim, id)
      rt.camRef.current = { x: 0, y: 0, zoom }
      rt.baseTimeScaleRef.current = localSim.config.timeScale
      rt.unitsRef.current = u
      p.setUnits(u)
      p.setCurrentPreset(id)
      p.setSelectedId(null)
      p.setFollow(false)
      future.fork(localSim)
      p.rerender()
    },
    [net, localSim, future, rt, p, adoptPresetPresentation],
  )

  const doRewind = useCallback(() => {
    if (rt.onlineRef.current) {
      if (net.hostId != null && !net.isHost) {
        p.showSaveMsg('联机房间中回退由房主执行')
        return
      }
      net.send({ type: 'rewind' })
      return
    }
    if (localSim.rewind() != null) {
      p.setSelectedId(null)
      p.setFollow(false)
      future.invalidate() // 回退后未来全部作废，从新状态重算
      p.rerender()
    }
  }, [net, localSim, future, rt, p])

  const onClear = useCallback(() => {
    if (rt.onlineRef.current) {
      if (net.hostId != null && !net.isHost) {
        p.showSaveMsg('联机房间中清空由房主执行')
        return
      }
      net.send({ type: 'clear' })
    } else {
      localSim.reset()
      future.invalidate()
      p.setUnits(undefined)
      rt.unitsRef.current = undefined
    }
    rt.unitsRef.current = undefined
    p.setUnits(undefined)
    p.setCurrentPreset('empty')
    p.setSelectedId(null)
    p.setFollow(false)
  }, [net, localSim, future, rt, p])

  const onSpawnSettings = useCallback(
    (patch: Partial<SpawnSettings>) => setSpawnCfg((s) => ({ ...s, ...patch })),
    [],
  )

  // 部署飞船：进入放置模式（飞船不参与质量滑杆，全场唯一）
  const deployShip = useCallback(() => {
    setSpawnCfg((s) => ({ ...s, kind: 'ship' }))
    p.setMode('spawn')
  }, [p])

  return { spawnCfg, setSpawnCfg, onConfig, applyWarp, applyPreset, doRewind, onClear, onSpawnSettings, deployShip }
}
