/**
 * 模拟运行时：启动恢复（以存档为基础）+ rAF 主循环（飞船输入 → 物理分发 → 渲染）
 * + 400ms 遥测（HUD 统计 / 轨道根数 / 飞船控制台）。
 */
import { useCallback, useEffect, useState } from 'react'
import { Simulation } from '../../sim/engine'
import { loadPreset, PRESETS } from '../../sim/presets'
import { getAutosave } from '../../sim/saveStore'
import type { Body, PresetId } from '../../sim/types'
import { resolveOrbitHost, escapeSpeed } from '../../sim/orbit'
import { makeStarfield, draw } from '../../sim/renderer'
import type { SimStats, UnitProfile } from '../../sim/types'
import type { AutosaveInfo } from '../../sections/MainMenu'
import type { Rt } from '../rt'

/** 选中天体的轨道根数（相对当前引力主导者，任意天体都有，不只飞船） */
export interface SelOrbitInfo {
  host: string
  rp: number
  ra: number
  T: number
  ecc: number
  esc: number
  vr: number
  rNow: number
  /** 引力时间膨胀 dτ/dt（近黑洞时 <1；非黑洞宿主为 1） */
  dilation?: number
  /** 宿主为黑洞时：距离是几个视界半径；<6 即进入 ISCO 死亡区 */
  rsRatio?: number
}

/** 飞船控制台遥测：只管「船的状态与操控」，轨道根数归选中面板 */
export interface ShipTelInfo {
  throttle: number
  speed: number
  escRatio: number
  altitude: number
  host: string
  dilation?: number
}

interface Params {
  rt: Rt
  rerender: () => void
  setUnits: (u: UnitProfile | undefined) => void
  setCurrentPreset: (id: PresetId) => void
  setAutosaveInfo: (info: AutosaveInfo | null) => void
}

export function useRuntime(p: Params) {
  const { rt } = p
  const { net, localSim, future } = rt
  const [stats, setStats] = useState<SimStats>({ bodies: 0, stars: 0, fps: 60, simTime: 0, merges: 0, totalMass: 0 })
  const [selOrbit, setSelOrbit] = useState<SelOrbitInfo | null>(null)
  const [shipTel, setShipTel] = useState<ShipTelInfo | null>(null)

  /** 找「我的飞船」：联机时按 owners 归属找自己的船（找不到退化任意一艘）；离线取第一艘 */
  const findMyShip = useCallback((): Body | undefined => {
    const s = rt.activeSimRef.current
    if (rt.onlineRef.current && net.you) {
      return (
        s.bodies.find((b) => b.kind === 'ship' && b.alive && net.owners.get(b.id) === net.you!.id) ??
        s.bodies.find((b) => b.kind === 'ship' && b.alive)
      )
    }
    return s.bodies.find((b) => b.kind === 'ship' && b.alive)
  }, [net, rt])

  // —— 挂载：以存档为基础启动（恢复上次的宇宙），默认离线单机；联机需显式连接 ——
  useEffect(() => {
    let cancelled = false
    void (async () => {
      let restored = false
      try {
        const rec = await getAutosave()
        // 用户在恢复完成前已切预设/载入存档时，放弃恢复（避免旧存档覆盖新操作）
        if (rec && !cancelled && !rt.userTouchedRef.current) {
          localSim.restoreWorld(rec.state)
          restored = true
          p.setAutosaveInfo({ savedAt: rec.savedAt, bodies: rec.state.bodies.length, preset: rec.state.preset })
          const pid = rec.state.preset
          if (pid && PRESETS.some((pr) => pr.id === pid)) {
            // 合法预设：用探针恢复单位换算，相机用存档里的
            const probe = new Simulation()
            const { zoom, units: u } = loadPreset(probe, pid as PresetId)
            rt.camRef.current = rec.state.camera ?? { x: 0, y: 0, zoom }
            rt.unitsRef.current = u
            p.setUnits(u)
            rt.baseTimeScaleRef.current = rec.state.config.timeScale
            p.setCurrentPreset(pid as PresetId)
          } else {
            rt.camRef.current = rec.state.camera ?? { x: 0, y: 0, zoom: 1 }
            rt.unitsRef.current = undefined
            p.setUnits(undefined)
            rt.baseTimeScaleRef.current = rec.state.config.timeScale
            p.setCurrentPreset('empty')
          }
        }
      } catch {
        /* IndexedDB 不可用（隐私模式等）：走默认预设 */
      }
      if (!restored && !cancelled) {
        const { zoom, units: u } = loadPreset(localSim, 'real')
        rt.camRef.current = { x: 0, y: 0, zoom }
        rt.baseTimeScaleRef.current = localSim.config.timeScale
        rt.unitsRef.current = u
        p.setUnits(u)
        p.setCurrentPreset('real')
      }
      if (!cancelled) {
        future.fork(localSim)
        p.rerender()
      }
    })()
    return () => {
      cancelled = true
      net.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // —— 主循环 + 遥测 ——
  useEffect(() => {
    const canvas = rt.canvasRef.current!
    const ctx = canvas.getContext('2d')!
    let raf = 0
    let last = performance.now()
    let running = true

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.floor(window.innerWidth * dpr)
      canvas.height = Math.floor(window.innerHeight * dpr)
      canvas.style.width = `${window.innerWidth}px`
      canvas.style.height = `${window.innerHeight}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      rt.starfieldRef.current = makeStarfield(window.innerWidth, window.innerHeight)
    }
    resize()
    window.addEventListener('resize', resize)

    const loop = (now: number) => {
      if (!running) return
      const rawDt = (now - last) / 1000
      last = now
      const dt = Math.min(rawDt, 1 / 30)
      rt.fpsRef.current = rt.fpsRef.current * 0.92 + (1 / Math.max(rawDt, 1e-4)) * 0.08

      const on = rt.onlineRef.current
      const sim = rt.activeSimRef.current
      // 每帧把实测 FPS 喂给引擎的 auto 档位调节器（副作用收在循环里，render 体保持纯净）
      sim.resolvePerf(rt.fpsRef.current)
      future.leadTargetSec = rt.prefsRef.current.leadSeconds
      future.rateMax = sim.perf.prebufferRate

      // —— 飞船推进器输入（键盘 + 触屏摇杆），在积分前写入油门/方向 ——
      const ship = findMyShip()
      let tx = 0
      let ty = 0
      let m = 0
      let newThrust = 0
      let thrustChanged = false
      if (ship && !ship.held) {
        const keys = rt.keysRef.current
        const joy = rt.joystickRef.current
        let throttle = 0
        const vMag = Math.hypot(ship.vx, ship.vy)
        // W/↑ 顺行加速（沿速度方向），S/↓ 逆行减速，A/D 横向机动
        // 油门分档：正常 35%（微调），Shift 全推力；减速逆行比加速更温和
        const base = 0.35
        if (keys.has('KeyW') || keys.has('ArrowUp')) {
          if (vMag > 1e-4) {
            tx += ship.vx / vMag
            ty += ship.vy / vMag
          } else {
            ty -= 1
          }
          throttle = base
        }
        if (keys.has('KeyS') || keys.has('ArrowDown')) {
          if (vMag > 1e-4) {
            tx -= ship.vx / vMag
            ty -= ship.vy / vMag
          } else {
            ty += 1
          }
          throttle = base * 0.6
        }
        if (keys.has('KeyA') || keys.has('ArrowLeft')) {
          if (vMag > 1e-4) {
            tx += ship.vy / vMag
            ty -= ship.vx / vMag
          } else {
            tx -= 1
          }
          throttle = base
        }
        if (keys.has('KeyD') || keys.has('ArrowRight')) {
          if (vMag > 1e-4) {
            tx -= ship.vy / vMag
            ty += ship.vx / vMag
          } else {
            tx += 1
          }
          throttle = base
        }
        if (joy.active && Math.hypot(joy.x, joy.y) > 0.15) {
          tx = joy.x
          ty = joy.y
          // 摇杆油门线性映射，满推=50%（比键盘更柔和）
          throttle = Math.min(0.5, Math.hypot(joy.x, joy.y) * 0.5)
        }
        if (keys.has('ShiftLeft') || keys.has('ShiftRight')) throttle = Math.min(1, throttle * 3)
        m = Math.hypot(tx, ty)
        newThrust = m > 0 ? throttle : 0
        thrustChanged = newThrust !== rt.lastThrottleRef.current
        if (thrustChanged && !on) future.invalidate() // 离线：推力变化 → 预演缓冲分叉
        rt.lastThrottleRef.current = newThrust
        ship.thrust = newThrust
        if (m > 0) {
          ship.thrustX = tx / m
          ship.thrustY = ty / m
        }
      }

      // —— 物理推进：在线 = 镜像补算（权威帧纠偏）；离线 = 预演缓冲驱动 ——
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
      }

      // 追踪选中天体
      if (rt.followRef.current && rt.selectedRef.current != null) {
        const b = sim.bodies.find((x) => x.id === rt.selectedRef.current)
        if (b) {
          rt.camRef.current.x += (b.x - rt.camRef.current.x) * 0.12
          rt.camRef.current.y += (b.y - rt.camRef.current.y) * 0.12
        }
      }

      draw(
        ctx,
        sim,
        rt.camRef.current,
        window.innerWidth,
        window.innerHeight,
        rt.starfieldRef.current,
        rt.selectedRef.current,
        rt.spawnPreviewRef.current,
        rt.spawnCfgRef.current,
        now,
        future,
      )
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    const statTimer = setInterval(() => {
      const on = rt.onlineRef.current
      const sim = rt.activeSimRef.current
      const stars = sim.bodies.reduce((acc, b) => acc + (b.kind === 'star' || b.kind === 'blackhole' ? 1 : 0), 0)
      setStats({
        bodies: sim.bodies.length,
        stars,
        fps: Math.round(rt.fpsRef.current),
        simTime: on ? net.simTime : sim.simTime,
        merges: on ? net.merges : sim.merges,
        totalMass: on ? net.totalMass : sim.totalMass,
      })
      // 选中天体的轨道根数：相对引力主导者的二体解（任意天体，不只飞船）
      const sel = rt.selectedRef.current != null ? sim.bodies.find((x) => x.id === rt.selectedRef.current) : null
      if (sel) {
        const host = resolveOrbitHost(sim, sel.x, sel.y, sel.id)
        if (host) {
          const dx = sel.x - host.x
          const dy = sel.y - host.y
          const r = Math.hypot(dx, dy)
          const dvx = sel.vx - host.vx
          const dvy = sel.vy - host.vy
          const v2 = dvx * dvx + dvy * dvy
          const mu = sim.config.G * host.mass
          const eps = v2 / 2 - mu / r
          const h = dx * dvy - dy * dvx
          const ecc = Math.sqrt(Math.max(0, 1 + (2 * eps * h * h) / (mu * mu)))
          // 宿主是黑洞：附加引力时间膨胀 dτ/dt = √(1 − r_s/r) 与视界半径倍数
          const rel =
            host.kind === 'blackhole'
              ? { dilation: Math.sqrt(Math.max(0, 1 - host.radius / r)), rsRatio: r / host.radius }
              : {}
          const base = { host: host.name, esc: Math.sqrt((2 * mu) / r), vr: Math.sqrt(v2), rNow: r, ecc, ...rel }
          if (eps < 0 && ecc < 1) {
            const a = -mu / (2 * eps)
            setSelOrbit({ ...base, rp: a * (1 - ecc), ra: a * (1 + ecc), T: 2 * Math.PI * Math.sqrt((a * a * a) / mu) })
          } else {
            setSelOrbit({ ...base, rp: -1, ra: -1, T: -1 })
          }
        } else {
          setSelOrbit(null)
        }
      } else {
        setSelOrbit(null)
      }
      // 飞船控制台遥测
      const ship = findMyShip()
      if (ship) {
        const host = resolveOrbitHost(sim, ship.x, ship.y, ship.id)
        const spd = Math.hypot(ship.vx, ship.vy)
        if (host) {
          const r = Math.hypot(ship.x - host.x, ship.y - host.y)
          const esc = escapeSpeed(sim.config.G, host.mass, r)
          const rel = host.kind === 'blackhole' ? Math.sqrt(Math.max(0, 1 - host.radius / r)) : undefined
          setShipTel({ throttle: ship.thrust ?? 0, speed: spd, escRatio: spd / esc, altitude: r, host: host.name, dilation: rel })
        } else {
          setShipTel({ throttle: ship.thrust ?? 0, speed: spd, escRatio: 0, altitude: 0, host: '—' })
        }
      } else {
        setShipTel(null)
      }
    }, 400)

    return () => {
      running = false
      cancelAnimationFrame(raf)
      clearInterval(statTimer)
      window.removeEventListener('resize', resize)
    }
  }, [net, future, findMyShip, rt, p])

  return { stats, selOrbit, shipTel }
}
