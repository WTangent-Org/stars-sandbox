# -*- coding: utf-8 -*-
import io, re

p = 'src/pages/hooks/useRuntime.ts'
src = io.open(p, encoding='utf-8').read()

src = src.replace("const { net, localSim, future } = rt", "const { localSim, future } = rt")
src = src.replace("""  const findMyShip = useCallback((): Body | undefined => {
    const s = rt.activeSimRef.current
    if (rt.onlineRef.current && net.you) {
      return (
        s.bodies.find((b) => b.kind === 'ship' && b.alive && net.owners.get(b.id) === net.you!.id) ??
        s.bodies.find((b) => b.kind === 'ship' && b.alive)
      )
    }
    return s.bodies.find((b) => b.kind === 'ship' && b.alive)
  }, [net, rt])""", """  const findMyShip = useCallback((): Body | undefined => {
    return rt.localSim.bodies.find((b) => b.kind === 'ship' && b.alive)
  }, [rt])""")
src = src.replace("""    return () => {
      cancelled = true
      net.disconnect()
    }""", """    return () => {
      cancelled = true
    }""")
src = src.replace("""      const on = rt.onlineRef.current
      const sim = rt.activeSimRef.current
      // 每帧把实测 FPS""", """      const sim = rt.localSim
      // 每帧把实测 FPS""")
src = src.replace("""      // —— 物理推进：在线 = 镜像补算（权威帧纠偏）；离线 = 预演缓冲驱动 ——
      if (on) {
        net.tick(dt, rt.camRef.current.zoom)
        // 推力/方向变化 → 发给服务器（镜像本地也写上，尾焰立即响应）
        const dxn = m > 0 ? tx / m : 0
        const dyn = m > 0 ? ty / m : 0
        const dirChanged = dxn !== rt.lastThrustDirRef.current.x || dyn !== rt.lastThrustDirRef.current.y
        if (thrustChanged || (newThrust > 0 && dirChanged)) {
          rt.lastThrustDirRef.current = { x: dxn, y: dyn }
          net.send({ type: 'thrust', throttle: newThrust, x: dxn, y: dyn })
        }
      } else if (!sim.config.paused) {
        if (!future.active) future.fork(sim)
        future.tick(sim)
        if (!future.consume(sim)) sim.advance(dt, rt.camRef.current.zoom) // 缓冲未建好（刚分叉）时直跑
      } else {
        future.invalidate() // 暂停时无未来可言，释放影子
      }""", """      // —— 物理推进：预演缓冲驱动（暂停时释放影子） ——
      if (!sim.config.paused) {
        if (!future.active) future.fork(sim)
        future.tick(sim)
        if (!future.consume(sim)) sim.advance(dt, rt.camRef.current.zoom) // 缓冲未建好（刚分叉）时直跑
      } else {
        future.invalidate()
      }""")
src = src.replace("        if (thrustChanged && !on) future.invalidate() // 离线：推力变化 → 预演缓冲分叉",
                  "        if (thrustChanged) future.invalidate() // 推力变化 → 预演缓冲分叉")
src = src.replace("""      const on = rt.onlineRef.current
      const sim = rt.activeSimRef.current
      const stars""", """      const sim = rt.localSim
      const stars""")
src = src.replace("""        simTime: on ? net.simTime : sim.simTime,
        merges: on ? net.merges : sim.merges,
        totalMass: on ? net.totalMass : sim.totalMass,""", """        simTime: sim.simTime,
        merges: sim.merges,
        totalMass: sim.totalMass,""")
src = src.replace("  }, [net, future, findMyShip, rt, rerender, setUnits, setCurrentPreset, setAutosaveInfo])",
                  "  }, [future, findMyShip, rt, rerender, setUnits, setCurrentPreset, setAutosaveInfo])")

io.open(p, 'w', encoding='utf-8', newline='\n').write(src)
print('runtime ok')

# ============ useInput.ts ============
p2 = 'src/pages/hooks/useInput.ts'
s2 = io.open(p2, encoding='utf-8').read()

s2 = s2.replace("const { net, localSim, future, togglePause, rerender, mode, spawnCfg, selectedId, follow, setSelectedId, setFollow } = p",
                "const { localSim, future, togglePause, rerender, mode, spawnCfg, selectedId, follow, setSelectedId, setFollow } = p")
s2 = s2.replace("  net: Rt['net']\n", "")
s2 = s2.replace("""        const gb = sim.bodies.find((x) => x.id === g.id)
        if (rt.onlineRef.current) {
          // 取消抓取：放回/还原速度；镜像天体解除 held（对账恢复接管）
          if (gb) gb.held = false
          if (!g.armed) net.send({ type: 'release', id: g.id, vx: g.origVx, vy: g.origVy })
        } else if (gb && !g.armed) {
          gb.held = false
          gb.x = g.origX
          gb.y = g.origY
          gb.vx = g.origVx
          gb.vy = g.origVy
        }""", """        const gb = sim.bodies.find((x) => x.id === g.id)
        if (gb && !g.armed) {
          gb.held = false
          gb.x = g.origX
          gb.y = g.origY
          gb.vx = g.origVx
          gb.vy = g.origVy
        }""")
s2 = s2.replace("""        grab.armed = false
        if (rt.onlineRef.current) {
          net.send({ type: 'grab', id: grab.id })
          body.held = true // 镜像天体挂起：对账跳过 held，抓取手感不被网络帧抢走
        } else {
          body.held = true
          future.invalidate() // 拖拽开始，旧未来作废
        }""", """        grab.armed = false
        body.held = true
        future.invalidate() // 拖拽开始，旧未来作废""")
s2 = s2.replace("""      if (Math.abs(dx) + Math.abs(dy) > 0.5 / rt.camRef.current.zoom) grab.moved = true
      if (rt.onlineRef.current) {
        // 联机：拖拽位置发服务器；镜像同步摆过去，避免等待网络帧的空窗
        net.send({ type: 'drag', id: grab.id, x: w.x, y: w.y })
        body.x = w.x
        body.y = w.y
      } else {
        body.x = w.x
        body.y = w.y
        body.vx = 0
        body.vy = 0
      }""", """      if (Math.abs(dx) + Math.abs(dy) > 0.5 / rt.camRef.current.zoom) grab.moved = true
      body.x = w.x
      body.y = w.y
      body.vx = 0
      body.vy = 0""")
s2 = s2.replace("""        if (rt.onlineRef.current) {
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
s2 = s2.replace("""      const useBoost = rt.unitsRef.current != null
      const kind = kindForMass(cfg.mass) // 类型由质量唯一决定（滑杆状态只是 UI 缓存）
      const visBoost = useBoost ? Math.max(1, Math.min(15, 24 / Math.max(1, radiusFor(kind, cfg.mass)))) : undefined
      if (rt.onlineRef.current) {
        net.send({ type: 'spawn', kind, x: sp.sx, y: sp.sy, vx, vy, mass: cfg.mass, visBoost })
        return
      }
      const body = sim.addBody({ kind, x: sp.sx, y: sp.sy, vx, vy, mass: cfg.mass, visBoost })""", """      const useBoost = rt.unitsRef.current != null
      const kind = kindForMass(cfg.mass) // 类型由质量唯一决定（滑杆状态只是 UI 缓存）
      const visBoost = useBoost ? Math.max(1, Math.min(15, 24 / Math.max(1, radiusFor(kind, cfg.mass)))) : undefined
      const body = sim.addBody({ kind, x: sp.sx, y: sp.sy, vx, vy, mass: cfg.mass, visBoost })""")
s2 = s2.replace("""      const body = sim.bodies.find((b) => b.id === grab.id)
      if (rt.onlineRef.current) {
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

io.open(p2, 'w', encoding='utf-8', newline='\n').write(s2)
print('input ok')
