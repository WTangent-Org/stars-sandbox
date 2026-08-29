/**
 * 输入层：键盘快捷键、指针手势（抓取/拖拽/生成预览/捏合缩放/滚轮/拾取）、
 * 触屏虚拟摇杆（固定/随手两模式的向量数学合一）。
 */
import { useCallback, useEffect, useState } from 'react'
import { circularOrbitVelocity } from '../../sim/orbit'
import { kindForMass, radiusFor } from '../../sim/engine'
import type { SpawnSettings, ToolMode } from '../../sim/types'
import type { Rt } from '../rt'

const V_SCALE = 0.022 // 拖拽距离 → 初速度

interface Params {
  rt: Rt
  rerender: () => void
  togglePause: () => void
  /** 联机有主房里非房主的全局操作会被服务器拒绝；这里只管本地路径 */
  localSim: Rt['localSim']
  /** 状态单一来源在 Home：交互层只读写 */
  mode: ToolMode
  setMode: (m: ToolMode) => void
  spawnCfg: SpawnSettings
  selectedId: number | null
  setSelectedId: (id: number | null) => void
  follow: boolean
  setFollow: (v: boolean) => void
}

export function useInput(p: Params) {
  const { rt } = p
  const { net, localSim, future } = rt
  const [joystick, setJoystick] = useState({ active: false, x: 0, y: 0 })
  const [joyAnchor, setJoyAnchor] = useState<{ x: number; y: number } | null>(null)

  // 同步到共享运行时（rAF 循环与各 hooks 读 ref，不参与渲染）
  rt.modeRef.current = p.mode
  rt.spawnCfgRef.current = p.spawnCfg
  rt.selectedRef.current = p.selectedId
  rt.followRef.current = p.follow

  const toWorld = useCallback((px: number, py: number) => {
    const cam = rt.camRef.current
    return {
      x: (px - window.innerWidth / 2) / cam.zoom + cam.x,
      y: (py - window.innerHeight / 2) / cam.zoom + cam.y,
    }
  }, [rt])

  // —— 键盘快捷键 ——
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      rt.keysRef.current.add(e.code)
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault()
      if (e.code === 'Space') {
        e.preventDefault()
        p.togglePause()
      } else if (e.key === 't' || e.key === 'T') {
        // 轨迹是纯本地渲染层行为：本地与镜像两个配置都写，保持同步
        localSim.config.trails = !localSim.config.trails
        net.mirror.config.trails = localSim.config.trails
        p.rerender()
      } else if (e.key === 'Escape') {
        p.setSelectedId(null)
        p.setFollow(false)
        rt.spawnPreviewRef.current = null
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && rt.selectedRef.current != null) {
        if (rt.onlineRef.current) {
          net.send({ type: 'remove', id: rt.selectedRef.current })
        } else {
          localSim.removeBody(rt.selectedRef.current)
          future.invalidate()
        }
        p.setSelectedId(null)
      }
    }
    const onKeyUp = (e: KeyboardEvent) => rt.keysRef.current.delete(e.code)
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [net, localSim, future, rt, p])

  // —— 指针交互 ——
  const onPointerDown = (e: React.PointerEvent) => {
    const sim = rt.activeSimRef.current
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return
    // 随手模式：触屏落在摇杆侧半屏 → 该触点即摇杆中心，优先于平移/拾取
    if (e.pointerType === 'touch' && rt.prefsRef.current.joyMode === 'float' && rt.pointersRef.current.size === 0) {
      const hasShip = sim.bodies.some((b) => b.kind === 'ship' && b.alive)
      const side = rt.prefsRef.current.joySide
      const inZone = side === 'left' ? e.clientX < window.innerWidth * 0.42 : e.clientX > window.innerWidth * 0.58
      if (hasShip && inZone && e.clientY > window.innerHeight * 0.25) {
        rt.pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
        rt.joyAnchorRef.current = { x: e.clientX, y: e.clientY }
        setJoyAnchor(rt.joyAnchorRef.current)
        rt.joystickRef.current = { active: true, x: 0, y: 0 }
        setJoystick({ active: true, x: 0, y: 0 })
        ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
        return
      }
    }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    rt.pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    // 第二根手指落下：取消单指操作，进入捏合缩放
    if (rt.pointersRef.current.size === 2) {
      rt.spawnPreviewRef.current = null
      const g = rt.grabRef.current
      if (g) {
        rt.grabRef.current = null
        const gb = sim.bodies.find((x) => x.id === g.id)
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
        }
      }
      rt.dragRef.current.active = false
      const pts = [...rt.pointersRef.current.values()]
      const mx = (pts[0].x + pts[1].x) / 2
      const my = (pts[0].y + pts[1].y) / 2
      const w = toWorld(mx, my)
      rt.pinchRef.current = {
        d0: Math.max(Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y), 1),
        zoom0: rt.camRef.current.zoom,
        wx: w.x,
        wy: w.y,
      }
      return
    }
    if (rt.modeRef.current === 'spawn' && e.button === 0) {
      const w = toWorld(e.clientX, e.clientY)
      rt.spawnPreviewRef.current = { active: true, sx: w.x, sy: w.y, cx: w.x, cy: w.y }
    } else if (e.button === 0) {
      // 观察模式：优先尝试抓取天体，落空则平移视野（触屏拾取半径更大）
      const w = toWorld(e.clientX, e.clientY)
      const pickR = (e.pointerType === 'touch' ? 28 : 16) / rt.camRef.current.zoom
      const hit = sim.pick(w.x, w.y, pickR)
      if (hit) {
        rt.grabRef.current = {
          id: hit.id,
          lastX: w.x,
          lastY: w.y,
          lastT: performance.now(),
          vx: 0,
          vy: 0,
          origVx: hit.vx,
          origVy: hit.vy,
          moved: false,
          armed: true,
          sx: e.clientX,
          sy: e.clientY,
          origX: hit.x,
          origY: hit.y,
        }
        p.setSelectedId(hit.id)
      } else {
        rt.dragRef.current = { active: true, sx: e.clientX, sy: e.clientY, moved: false }
      }
    } else {
      rt.dragRef.current = { active: true, sx: e.clientX, sy: e.clientY, moved: false }
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const sim = rt.activeSimRef.current
    if (rt.pointersRef.current.has(e.pointerId)) rt.pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    // 随手模式摇杆：相对锚点计算偏置（半径 40px 满推）
    if (rt.joystickRef.current.active && rt.joyAnchorRef.current && rt.prefsRef.current.joyMode === 'float') {
      const a = rt.joyAnchorRef.current
      const nx = (e.clientX - a.x) / 40
      const ny = (e.clientY - a.y) / 40
      const m = Math.min(1, Math.hypot(nx, ny))
      const ang = Math.atan2(ny, nx)
      rt.joystickRef.current = { active: true, x: Math.cos(ang) * m, y: Math.sin(ang) * m }
      setJoystick({ ...rt.joystickRef.current })
      return
    }
    // 双指捏合：以双指中点锚定的世界坐标为中心缩放
    if (rt.pinchRef.current && rt.pointersRef.current.size >= 2) {
      const pts = [...rt.pointersRef.current.values()]
      const mx = (pts[0].x + pts[1].x) / 2
      const my = (pts[0].y + pts[1].y) / 2
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
      const cam = rt.camRef.current
      const nz = Math.min(20000, Math.max(0.02, rt.pinchRef.current.zoom0 * (d / rt.pinchRef.current.d0)))
      cam.zoom = nz
      cam.x = rt.pinchRef.current.wx - (mx - window.innerWidth / 2) / nz
      cam.y = rt.pinchRef.current.wy - (my - window.innerHeight / 2) / nz
      return
    }
    if (rt.spawnPreviewRef.current?.active) {
      const w = toWorld(e.clientX, e.clientY)
      rt.spawnPreviewRef.current.cx = w.x
      rt.spawnPreviewRef.current.cy = w.y
      return
    }
    const grab = rt.grabRef.current
    if (grab) {
      const body = sim.bodies.find((b) => b.id === grab.id)
      if (!body) {
        rt.grabRef.current = null
        return
      }
      // 未越过拖动阈值：仅视为选中，天体保持原轨道运行
      if (grab.armed) {
        if (Math.hypot(e.clientX - grab.sx, e.clientY - grab.sy) < (e.pointerType === 'touch' ? 12 : 6)) return
        grab.armed = false
        if (rt.onlineRef.current) {
          net.send({ type: 'grab', id: grab.id })
          body.held = true // 镜像天体挂起：对账跳过 held，抓取手感不被网络帧抢走
        } else {
          body.held = true
          future.invalidate() // 拖拽开始，旧未来作废
        }
      }
      const w = toWorld(e.clientX, e.clientY)
      const now = performance.now()
      const dtReal = Math.max((now - grab.lastT) / 1000, 1e-3)
      // 指针速度（世界单位/真实秒）→ 模拟速度需除以时间倍率，平滑滤波防抖
      const ivx = (w.x - grab.lastX) / dtReal / sim.config.timeScale
      const ivy = (w.y - grab.lastY) / dtReal / sim.config.timeScale
      grab.vx += (ivx - grab.vx) * 0.45
      grab.vy += (ivy - grab.vy) * 0.45
      grab.lastX = w.x
      grab.lastY = w.y
      grab.lastT = now
      const dx = w.x - body.x
      const dy = w.y - body.y
      if (Math.abs(dx) + Math.abs(dy) > 0.5 / rt.camRef.current.zoom) grab.moved = true
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
      }
      return
    }
    const d = rt.dragRef.current
    if (!d.active) return
    const dx = e.clientX - d.sx
    const dy = e.clientY - d.sy
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true
    rt.camRef.current.x -= dx / rt.camRef.current.zoom
    rt.camRef.current.y -= dy / rt.camRef.current.zoom
    d.sx = e.clientX
    d.sy = e.clientY
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const sim = rt.activeSimRef.current
    rt.pointersRef.current.delete(e.pointerId)
    // 随手模式摇杆松手
    if (rt.joyAnchorRef.current) {
      rt.joyAnchorRef.current = null
      setJoyAnchor(null)
      rt.joystickRef.current = { active: false, x: 0, y: 0 }
      setJoystick({ active: false, x: 0, y: 0 })
      return
    }
    if (rt.pinchRef.current) {
      if (rt.pointersRef.current.size < 2) rt.pinchRef.current = null
      // 捏合期间不触发任何单指逻辑
      rt.grabRef.current = null
      rt.dragRef.current.active = false
      rt.spawnPreviewRef.current = null
      return
    }
    const sp = rt.spawnPreviewRef.current
    if (sp?.active) {
      rt.spawnPreviewRef.current = null
      const w = toWorld(e.clientX, e.clientY)
      const cfg = rt.spawnCfgRef.current
      // 飞船部署：先算自动圆轨道初速度；联机时服务器负责退役旧船/发新船
      if (cfg.kind === 'ship') {
        const host = sim.dominantMassive(sp.sx, sp.sy)
        let svx = 0
        let svy = 0
        if (host && Math.hypot(sp.sx - host.x, sp.sy - host.y) > host.radius * 2) {
          ;({ vx: svx, vy: svy } = circularOrbitVelocity(sim.config.G, host, sp.sx, sp.sy))
        }
        if (rt.onlineRef.current) {
          net.send({ type: 'spawn', kind: 'ship', x: sp.sx, y: sp.sy, vx: svx, vy: svy, mass: 0.001 })
          p.setSelectedId(null)
        } else {
          // 全场唯一：先退役旧飞船
          for (const s of sim.bodies.filter((b) => b.kind === 'ship')) sim.removeBody(s.id)
          const shipBody = sim.addBody({ kind: 'ship', x: sp.sx, y: sp.sy, vx: svx, vy: svy, mass: 0.001 })
          future.invalidate()
          sim.addEffect(sp.sx, sp.sy, shipBody.radius * 3 + 4, '#34d399', 'spawn')
          p.setSelectedId(shipBody.id)
        }
        p.setMode('pan') // 部署完即回观察模式，直接开飞
        return
      }
      let vx = (w.x - sp.sx) * V_SCALE
      let vy = (w.y - sp.sy) * V_SCALE
      // 拖拽位移（屏幕像素）：拉了明显一段虚线就用拖拽速度——拖拽意图优先于自动圆轨道
      const dragPx = Math.hypot(w.x - sp.sx, w.y - sp.sy) * rt.camRef.current.zoom
      const dragged = dragPx > 12
      if (cfg.autoOrbit && !dragged) {
        const host = sim.dominantMassive(sp.sx, sp.sy)
        if (host && Math.hypot(sp.sx - host.x, sp.sy - host.y) > host.radius * 2) {
          ;({ vx, vy } = circularOrbitVelocity(sim.config.G, host, sp.sx, sp.sy))
        }
        // 无主星（空白宇宙）且无拖拽：静止放置
      }
      // 真实比例场景：生成物带视觉放大倍率，保持与场景内天体同一比例；
      // 放大倍率随实际半径衰减——大质量天体本身可见，再放大只会辉光淹屏
      const useBoost = rt.unitsRef.current != null
      const kind = kindForMass(cfg.mass) // 类型由质量唯一决定（滑杆状态只是 UI 缓存）
      const visBoost = useBoost ? Math.max(1, Math.min(15, 24 / Math.max(1, radiusFor(kind, cfg.mass)))) : undefined
      if (rt.onlineRef.current) {
        net.send({ type: 'spawn', kind, x: sp.sx, y: sp.sy, vx, vy, mass: cfg.mass, visBoost })
        return
      }
      const body = sim.addBody({ kind, x: sp.sx, y: sp.sy, vx, vy, mass: cfg.mass, visBoost })
      future.invalidate() // 新天体加入，分叉重算
      sim.addEffect(sp.sx, sp.sy, body.radius * 3 + 4, '#22d3ee', 'spawn')
      p.setSelectedId(body.id)
      return
    }
    const grab = rt.grabRef.current
    if (grab) {
      rt.grabRef.current = null
      const body = sim.bodies.find((b) => b.id === grab.id)
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
      if (body) {
        body.held = false
        if (grab.armed) {
          // 纯点击选中：天体从未被抓起，不做任何改动
          return
        }
        if (grab.moved) {
          // 甩出：继承指针速度（限幅防止弹飞）
          const cap = 80
          const mag = Math.hypot(grab.vx, grab.vy)
          const k = mag > cap ? cap / mag : 1
          body.vx = grab.vx * k
          body.vy = grab.vy * k
          future.invalidate() // 松手赋速，分叉重算
        } else {
          // 拖出去又放回原地：还原位置与速度
          body.x = grab.origX
          body.y = grab.origY
          body.vx = grab.origVx
          body.vy = grab.origVy
          future.invalidate()
        }
      }
      return
    }
    const d = rt.dragRef.current
    if (!d.active) return
    d.active = false
    if (!d.moved) {
      // 点击拾取
      const w = toWorld(e.clientX, e.clientY)
      const hit = sim.pick(w.x, w.y, 14 / rt.camRef.current.zoom)
      p.setSelectedId(hit ? hit.id : null)
      if (!hit) p.setFollow(false)
    }
  }

  const onWheel = (e: React.WheelEvent) => {
    const cam = rt.camRef.current
    const factor = Math.pow(1.0015, -e.deltaY)
    const nz = Math.min(20000, Math.max(0.02, cam.zoom * factor))
    const w = toWorld(e.clientX, e.clientY)
    cam.zoom = nz
    // 缩放锚定在光标处
    cam.x = w.x - (e.clientX - window.innerWidth / 2) / nz
    cam.y = w.y - (e.clientY - window.innerHeight / 2) / nz
  }

  return { setJoystick, joystick, joyAnchor, onPointerDown, onPointerMove, onPointerUp, onWheel }
}
