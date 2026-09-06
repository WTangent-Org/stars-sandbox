# -*- coding: utf-8 -*-
import io, re

def load(p):
    return io.open(p, encoding='utf-8').read()

def save(p, s):
    io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
    print('patched', p)

# ============ useInput.ts：删净 online/net 分支 ============
p = 'src/pages/hooks/useInput.ts'
s = load(p)
s = s.replace(", prefsRef, onlineRef } = rt", ", prefsRef } = rt")
s = s.replace("""    const sim = rt.activeSimRef.current
""", """    const sim = localSim
""")
s = s.replace("""      } else if (e.key === 't' || e.key === 'T') {
        // 轨迹是纯本地渲染层行为：本地与镜像两个配置都写，保持同步
        localSim.config.trails = !localSim.config.trails
        net.mirror.config.trails = localSim.config.trails
        rerender()""", """      } else if (e.key === 't' || e.key === 'T') {
        // 轨迹是纯本地渲染层行为
        localSim.config.trails = !localSim.config.trails
        rerender()""")
s = s.replace("""      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedRef.current != null) {
        if (onlineRef.current) {
          net.send({ type: 'remove', id: selectedRef.current })
        } else {
          localSim.removeBody(selectedRef.current)
          future.invalidate()
        }
        setSelectedId(null)
      }""", """      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedRef.current != null) {
        localSim.removeBody(selectedRef.current)
        future.invalidate()
        setSelectedId(null)
      }""")
s = s.replace("  }, [net, localSim, future, rt, togglePause, rerender, setSelectedId, setFollow])",
              "  }, [localSim, future, rt, togglePause, rerender, setSelectedId, setFollow])")
# onlineRef 残留的所有分支
s = s.replace("""        if (onlineRef.current) {
          // 取消抓取：放回/还原速度；镜像天体解除 held（对账恢复接管）
          if (gb) gb.held = false
          if (!g.armed) net.send({ type: 'release', id: g.id, vx: g.origVx, vy: g.origVy })
        } else if (gb && !g.armed) {""", """        if (gb && !g.armed) {""")
s = s.replace("""        grab.armed = false
        if (onlineRef.current) {
          net.send({ type: 'grab', id: grab.id })
          body.held = true // 镜像天体挂起：对账跳过 held，抓取手感不被网络帧抢走
        } else {
          body.held = true
          future.invalidate() // 拖拽开始，旧未来作废
        }""", """        grab.armed = false
        body.held = true
        future.invalidate() // 拖拽开始，旧未来作废""")
s = s.replace("""      if (Math.abs(dx) + Math.abs(dy) > 0.5 / camRef.current.zoom) grab.moved = true
      if (onlineRef.current) {
        // 联机：拖拽位置发服务器；镜像同步摆过去，避免等待网络帧的空窗
        net.send({ type: 'drag', id: grab.id, x: w.x, y: w.y })
        body.x = w.x
        body.y = w.y
      } else {
        body.x = w.x
        body.y = w.y
        body.vx = 0
        body.vy = 0
      }""", """      if (Math.abs(dx) + Math.abs(dy) > 0.5 / camRef.current.zoom) grab.moved = true
      body.x = w.x
      body.y = w.y
      body.vx = 0
      body.vy = 0""")
s = s.replace("""        if (onlineRef.current) {
          net.send({ type: 'spawn', kind: 'ship', x: sp.sx, y: sp.sy, vx: svx, vy: svy, mass: 0.001 })
          setSelectedId(null)
        } else {
          // 全场唯一：先退役旧飞船
          for (const s of sim.bodies.filter((b) => b.kind === 'ship')) sim.removeBody(s.id)
          const shipBody = sim.addBody({ kind: 'ship', x: sp.sx, y: sp.sy, vx: svx, vy: svy, mass: 0.001 })
          future.invalidate()
          sim.addEffect(sp.sx, sp.sy, shipBody.radius * 3 + 4, '#34d399', 'spawn')
          setSelectedId(shipBody.id)
        }""", """        // 全场唯一：先退役旧飞船
        for (const s of sim.bodies.filter((b) => b.kind === 'ship')) sim.removeBody(s.id)
        const shipBody = sim.addBody({ kind: 'ship', x: sp.sx, y: sp.sy, vx: svx, vy: svy, mass: 0.001 })
        future.invalidate()
        sim.addEffect(sp.sx, sp.sy, shipBody.radius * 3 + 4, '#34d399', 'spawn')
        setSelectedId(shipBody.id)""")
s = s.replace("""      const useBoost = unitsRef.current != null
      const kind = kindForMass(cfg.mass) // 类型由质量唯一决定（滑杆状态只是 UI 缓存）
      const visBoost = useBoost ? Math.max(1, Math.min(15, 24 / Math.max(1, radiusFor(kind, cfg.mass)))) : undefined
      if (onlineRef.current) {
        net.send({ type: 'spawn', kind, x: sp.sx, y: sp.sy, vx, vy, mass: cfg.mass, visBoost })
        return
      }
      const body = sim.addBody({ kind, x: sp.sx, y: sp.sy, vx, vy, mass: cfg.mass, visBoost })""", """      const useBoost = unitsRef.current != null
      const kind = kindForMass(cfg.mass) // 类型由质量唯一决定（滑杆状态只是 UI 缓存）
      const visBoost = useBoost ? Math.max(1, Math.min(15, 24 / Math.max(1, radiusFor(kind, cfg.mass)))) : undefined
      const body = sim.addBody({ kind, x: sp.sx, y: sp.sy, vx, vy, mass: cfg.mass, visBoost })""")
s = s.replace("""      const body = sim.bodies.find((b) => b.id === grab.id)
      if (onlineRef.current) {
        if (body) body.held = false // 松手：对账恢复接管该天体
        if (!grab.armed) {
          // 甩出（或放回）：把最终速度交服务器
          if (grab.moved) {
            const cap = 80
            const mag = Math.hypot(grab.vx, grab.vy)
            const k = mag > cap ? cap / mag : 1
            net.send({ type: 'release', id: grab.id, vx: grab.vx * k, vy: grab.vy * k })
          } else {
            net.send({ type: 'release', id: grab.id, vx: grab.origVx, vy: grab.origVy })
            net.send({ type: 'drag', id: grab.id, x: grab.origX, y: grab.origY })
            net.send({ type: 'release', id: grab.id, vx: grab.origVx, vy: grab.origVy })
          }
        }
        return
      }
      if (body) {""", """      const body = sim.bodies.find((b) => b.id === grab.id)
      if (body) {""")
save(p, s)

# ============ useWorldOps.ts：删 net 与房主门禁 ============
p = 'src/pages/hooks/useWorldOps.ts'
s = load(p)
s = s.replace("const { net, localSim, future } = rt", "const { localSim, future } = rt")
s = s.replace("""      // 滑杆调整的是基准流速，时间倍率在此基础上叠加
      if (timeScale != null) {
        rt.baseTimeScaleRef.current = timeScale
        if (rt.onlineRef.current) {
          net.send({ type: 'config', patch: { timeScale: timeScale * rt.warpRef.current } })
        } else {
          localSim.config.timeScale = timeScale * rt.warpRef.current
          future.invalidate() // 流速变了，按旧流速推的缓冲未来作废
        }
      }""", """      // 滑杆调整的是基准流速，时间倍率在此基础上叠加
      if (timeScale != null) {
        rt.baseTimeScaleRef.current = timeScale
        localSim.config.timeScale = timeScale * rt.warpRef.current
        future.invalidate() // 流速变了，按旧流速推的缓冲未来作废
      }""")
s = s.replace("""    [net, localSim, future, rt, p],
  )

  const applyWarp""", """    [localSim, future, rt, p],
  )

  const applyWarp""")
s = s.replace("""      rt.warpRef.current = w
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
  )""", """      rt.warpRef.current = w
      p.setWarp(w)
      localSim.config.timeScale = rt.baseTimeScaleRef.current * w
      future.invalidate()
      p.rerender()
    },
    [localSim, future, rt, p],
  )""")
s = s.replace("""      rt.userTouchedRef.current = true
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
      const { zoom, units: u } = loadPreset(localSim, id)""", """      rt.userTouchedRef.current = true
      const { zoom, units: u } = loadPreset(localSim, id)""")
s = s.replace("""      future.fork(localSim)
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
    if (localSim.rewind() != null) {""", """      future.fork(localSim)
      p.rerender()
    },
    [localSim, future, rt, p],
  )

  const doRewind = useCallback(() => {
    if (localSim.rewind() != null) {""")
s = s.replace("""      future.invalidate() // 回退后未来全部作废，从新状态重算
      p.rerender()
    }
  }, [net, localSim, future, rt, p])""", """      future.invalidate() // 回退后未来全部作废，从新状态重算
      p.rerender()
    }
  }, [localSim, future, rt, p])""")
s = s.replace("""  const onClear = useCallback(() => {
    if (rt.onlineRef.current) {
      if (net.hostId != null && !net.isHost) {
        p.showSaveMsg('联机房间中清空由房主执行')
        return
      }
      net.send({ type: 'clear' })
    } else {
      localSim.reset()
      future.invalidate()
      saveAutosave()
    }""", """  const onClear = useCallback(() => {
    localSim.reset()
    future.invalidate()""")
s = s.replace("""    unitsRef.current = undefined
    p.setUnits(undefined)
    p.setCurrentPreset('empty')
    p.setSelectedId(null)
    p.setFollow(false)
  }, [net, localSim, future, rt, p, saveAutosave])""", """    rt.unitsRef.current = undefined
    p.setUnits(undefined)
    p.setCurrentPreset('empty')
    p.setSelectedId(null)
    p.setFollow(false)
  }, [localSim, future, rt, p])""")
open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('patched', p)

# useSaves：去掉 net 参数与联机分支
p = 'src/pages/hooks/useSaves.ts'
s = load(p)
s = s.replace("import type { NetSim } from '../../sim/net'\n", "")
s = s.replace("""interface Params {
  rt: Rt
  localSim: Simulation
  net: NetSim
  setAutosaveInfo: (info: AutosaveInfo | null) => void
}""", """interface Params {
  rt: Rt
  localSim: Simulation
  setAutosaveInfo: (info: AutosaveInfo | null) => void
}""")
s = s.replace("""      const state = rt.onlineRef.current ? await p.net.requestState() : p.localSim.serialize(rt.currentPresetRef.current)
      if (!rt.onlineRef.current) state.camera = { ...rt.camRef.current }""", """      const state = p.localSim.serialize(rt.currentPresetRef.current)
      state.camera = { ...rt.camRef.current }""")
open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('patched', p)
