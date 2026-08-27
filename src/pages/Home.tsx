import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Simulation } from '../sim/engine'
import { FutureBuffer } from '../sim/future'
import { RemoteSim, type RemoteStatus } from '../sim/remote'
import { loadPreset } from '../sim/presets'
import { draw, makeStarfield, type SpawnPreview } from '../sim/renderer'
import type { Body, Camera, PresetId, SimConfig, SimStats, SpawnSettings, ToolMode, UnitProfile } from '../sim/types'
import ControlPanel from '../sections/ControlPanel'
import SettingsPanel from '../sections/SettingsPanel'
import StatsBar from '../sections/StatsBar'
import { loadPrefs, savePrefs, type Prefs } from '../sim/prefs'
import { PERF_TIERS } from '../sim/types'

const V_SCALE = 0.022 // 拖拽距离 → 初速度
const KIND_LABEL: Record<Body['kind'], string> = { star: '恒星', planet: '行星', moon: '卫星', asteroid: '小行星', blackhole: '黑洞', ship: '飞船' }

/**
 * 轨道宿主解析：找到引力主导者后，若它正处在紧密双星中（伴星质量不可忽略、
 * 双星间距远小于目标到它的距离），则改用双星质心（合成位置/速度/总质量）。
 * 这解决了双星系统里行星/恒星轨道根数乱跳的问题。
 */
function resolveOrbitHost(sim: Simulation, x: number, y: number, excludeId?: number) {
  const host = sim.dominantMassive(x, y, excludeId)
  if (!host) return null
  const dHost = Math.hypot(host.x - x, host.y - y)
  let partner: Body | null = null
  for (const p of sim.bodies) {
    if (p.id === host.id || p.id === excludeId) continue
    if (p.kind !== 'star' && p.kind !== 'blackhole') continue
    if (p.mass < host.mass * 0.08) continue
    const dSep = Math.hypot(p.x - host.x, p.y - host.y)
    // 紧密双星：间距明显小于目标距离 → 对目标而言二者是一个质心
    if (dSep < Math.max(dHost * 0.5, 1e-6) && (!partner || p.mass > partner.mass)) partner = p
  }
  if (!partner) return { x: host.x, y: host.y, vx: host.vx, vy: host.vy, mass: host.mass, radius: host.radius, name: host.name, kind: host.kind as Body['kind'] }
  const M = host.mass + partner.mass
  return {
    x: (host.x * host.mass + partner.x * partner.mass) / M,
    y: (host.y * host.mass + partner.y * partner.mass) / M,
    vx: (host.vx * host.mass + partner.vx * partner.mass) / M,
    vy: (host.vy * host.mass + partner.vy * partner.mass) / M,
    mass: M,
    radius: Math.max(host.radius, partner.radius),
    name: `${host.name}+${partner.name} 质心`,
    kind: 'star' as const,
  }
}

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const simRef = useRef<Simulation | null>(null)
  if (!simRef.current) simRef.current = new Simulation()
  const localSim = simRef.current
  // 远程客户端：傀儡模拟（渲染层直接读），物理在服务器上跑
  const remoteRef = useRef<RemoteSim | null>(null)
  if (!remoteRef.current) remoteRef.current = new RemoteSim()
  const remote = remoteRef.current
  const [remoteStatus, setRemoteStatus] = useState<RemoteStatus>('disconnected')
  remote.onStatus = setRemoteStatus
  // 运行位置：activeSimRef 每帧指向当前激活的模拟（本地 or 远程傀儡），渲染/交互无感切换
  const [runMode, setRunMode] = useState<'local' | 'remote'>(() => loadPrefs().runMode)
  const runModeRef = useRef(runMode)
  const activeSimRef = useRef<Simulation>(localSim)
  const sim = runMode === 'remote' ? remote.puppet : localSim
  const isRemote = runMode === 'remote'
  activeSimRef.current = sim
  runModeRef.current = runMode

  const camRef = useRef<Camera>({ x: 0, y: 0, zoom: 1 })
  const starfieldRef = useRef(makeStarfield(1600, 900))
  const spawnPreviewRef = useRef<SpawnPreview | null>(null)
  const dragRef = useRef<{ active: boolean; sx: number; sy: number; moved: boolean }>({ active: false, sx: 0, sy: 0, moved: false })
  // 抓取天体拖拽：记录原始速度（单击时还原）与平滑后的指针速度（甩出时用）
  const grabRef = useRef<{
    id: number
    lastX: number
    lastY: number
    lastT: number
    vx: number
    vy: number
    origVx: number
    origVy: number
    moved: boolean
    // 拖动阈值：按下后先记录屏幕/世界坐标，指针移动超过 6px 才真正抓起天体，
    // 避免「点击选中」时的轻微手抖把天体挪歪
    armed: boolean
    sx: number
    sy: number
    origX: number
    origY: number
  } | null>(null)
  const fpsRef = useRef(60)
  // 飞船操控：键盘按键集合 + 触屏虚拟摇杆
  const keysRef = useRef<Set<string>>(new Set())
  const joystickRef = useRef({ active: false, x: 0, y: 0 })
  const [joystick, setJoystick] = useState({ active: false, x: 0, y: 0 })
  // 偏好设置（摇杆模式/位置、预演时长），localStorage 持久化
  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs())
  const prefsRef = useRef(prefs)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // 浮动摇杆的锚点（世界屏幕坐标，随手模式下手指落点即摇杆中心）
  const joyAnchorRef = useRef<{ x: number; y: number } | null>(null)
  const [joyAnchor, setJoyAnchor] = useState<{ x: number; y: number } | null>(null)
  // 触屏多指跟踪：双指捏合缩放
  const pointersRef = useRef(new Map<number, { x: number; y: number }>())
  const pinchRef = useRef<{ d0: number; zoom0: number; wx: number; wy: number } | null>(null)
  const modeRef = useRef<ToolMode>('pan')
  const spawnCfgRef = useRef<SpawnSettings>({ kind: 'planet', mass: 0.5, autoOrbit: true })
  const selectedRef = useRef<number | null>(null)
  const followRef = useRef(false)
  // 未来预演缓冲：影子模拟以快于画面的速度推演，渲染帧消费缓冲；状态变更即分叉重算
  const futureRef = useRef<FutureBuffer | null>(null)
  if (!futureRef.current) futureRef.current = new FutureBuffer()
  const future = futureRef.current
  // 上一帧油门（检测推力变化 → 分叉）
  const lastThrottleRef = useRef(0)
  const lastThrustDirRef = useRef({ x: 0, y: 0 })

  const [, setTick] = useState(0)
  const rerender = useCallback(() => setTick((t) => t + 1), [])

  const [mode, setMode] = useState<ToolMode>('pan')
  const [warp, setWarp] = useState(1)
  const [, setSnapTick] = useState(0)
  /** 选中天体的轨道根数（相对当前引力主导者，任意天体都有，不只飞船） */
  const [selOrbit, setSelOrbit] = useState<{
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
  } | null>(null)
  /** 飞船控制台遥测：只管「船的状态与操控」，轨道根数归选中面板 */
  const [shipTel, setShipTel] = useState<{
    throttle: number
    speed: number
    escRatio: number
    altitude: number
    host: string
    dilation?: number
  } | null>(null)
  const isTouch = useMemo(() => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches, [])
  const [spawnCfg, setSpawnCfg] = useState<SpawnSettings>(spawnCfgRef.current)
  const [currentPreset, setCurrentPreset] = useState<PresetId>('solar')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [follow, setFollow] = useState(false)
  // 窄屏（手机/平板竖屏）默认收起控制面板，画布优先
  const [panelOpen, setPanelOpen] = useState(() => (typeof window === 'undefined' ? true : window.innerWidth >= 820))
  const [stats, setStats] = useState<SimStats>({ bodies: 0, stars: 0, fps: 60, simTime: 0, merges: 0, totalMass: 0 })
  const unitsRef = useRef<UnitProfile | undefined>(undefined)
  const [units, setUnits] = useState<UnitProfile | undefined>(undefined)

  modeRef.current = mode
  spawnCfgRef.current = spawnCfg
  selectedRef.current = selectedId
  followRef.current = follow
  prefsRef.current = prefs
  future.leadTargetSec = prefs.leadSeconds
  future.rateMax = sim.perf.prebufferRate
  // 每帧把实测 FPS 喂给引擎的 auto 档位调节器
  sim.resolvePerf(fpsRef.current)

  const onPrefs = useCallback((patch: Partial<Prefs>) => {
    setPrefs((p) => {
      const next = { ...p, ...patch }
      savePrefs(next)
      return next
    })
    // 运行位置切换走独立 state（决定激活哪个模拟）
    if (patch.runMode != null) setRunMode(patch.runMode)
  }, [])

  const applyPreset = useCallback(
    (id: PresetId) => {
      if (runModeRef.current === 'remote') {
        // 远程：预设切换发给服务器；zoom/单位换算用一次性探针本地算出（与服务器端同一套预设表）
        remote.send({ type: 'preset', id })
        const probe = new Simulation()
        const { zoom, units: u } = loadPreset(probe, id)
        camRef.current = { x: 0, y: 0, zoom }
        baseTimeScaleRef.current = probe.config.timeScale
        unitsRef.current = u
        setUnits(u)
        setCurrentPreset(id)
        setSelectedId(null)
        setFollow(false)
        rerender()
        return
      }
      const { zoom, units: u } = loadPreset(sim, id)
      camRef.current = { x: 0, y: 0, zoom }
      baseTimeScaleRef.current = sim.config.timeScale
      unitsRef.current = u
      setUnits(u)
      setCurrentPreset(id)
      setSelectedId(null)
      setFollow(false)
      future.fork(sim)
      rerender()
    },
    [sim, rerender, future, remote],
  )

  useEffect(() => {
    applyPreset('real')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // —— 运行位置切换：连/断服务器 ——
  useEffect(() => {
    if (runMode === 'remote') {
      const addr = prefs.serverAddr || `${location.hostname}:8321`
      remote.connect(addr)
    } else {
      remote.disconnect()
      future.invalidate()
    }
    return () => remote.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runMode, prefs.serverAddr])

  // —— 主循环 ——
  useEffect(() => {
    const canvas = canvasRef.current!
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
      starfieldRef.current = makeStarfield(window.innerWidth, window.innerHeight)
    }
    resize()
    window.addEventListener('resize', resize)

    const loop = (now: number) => {
      if (!running) return
      const rawDt = (now - last) / 1000
      last = now
      const dt = Math.min(rawDt, 1 / 30)
      fpsRef.current = fpsRef.current * 0.92 + (1 / Math.max(rawDt, 1e-4)) * 0.08

      // —— 飞船推进器输入（键盘 + 触屏摇杆），在积分前写入油门/方向 ——
      const ship = sim.bodies.find((b) => b.kind === 'ship' && b.alive)
      let tx = 0
      let ty = 0
      let m = 0
      let newThrust = 0
      let thrustChanged = false
      if (ship && !ship.held) {
        const keys = keysRef.current
        const joy = joystickRef.current
        let throttle = 0
        const vMag = Math.hypot(ship.vx, ship.vy)
        // W/↑ 顺行加速（沿速度方向），S/↓ 逆行减速，A/D 横向机动
        // 油门分档：正常 35%（微调），Shift 全推力；减速逆行比加速更温和，避免一脚踩停
        let base = 0.35
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
          throttle = base * 0.6 // 逆行减速更柔和，减速过半不至于立刻反向
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
        // 推力变化 → 预演缓冲分叉：从干预点重新推演未来
        thrustChanged = newThrust !== lastThrottleRef.current
        if (thrustChanged) future.invalidate()
        lastThrottleRef.current = newThrust
        ship.thrust = newThrust
        if (m > 0) {
          ship.thrustX = tx / m
          ship.thrustY = ty / m
        }
      }

      // —— 预演驱动：影子模拟往前赶（加速补库存/达标后匀速），渲染帧从缓冲消费 ——
      if (isRemote) {
        // 远程：物理在服务器上跑，这里只做网络帧插值
        remote.interpolate(camRef.current.zoom)
        // 推力变化 → 发给服务器（本地傀儡也写上，尾焰立即响应）
        const dxn = m > 0 ? tx / m : 0
        const dyn = m > 0 ? ty / m : 0
        const dirChanged = dxn !== lastThrustDirRef.current.x || dyn !== lastThrustDirRef.current.y
        if (thrustChanged || (newThrust > 0 && dirChanged)) {
          lastThrustDirRef.current = { x: dxn, y: dyn }
          remote.send({ type: 'thrust', throttle: newThrust, x: dxn, y: dyn })
        }
      } else if (!sim.config.paused) {
        if (!future.active) future.fork(sim)
        future.tick(sim)
        if (!future.consume(sim)) sim.advance(dt, camRef.current.zoom) // 缓冲未建好（刚分叉）时直跑
      } else {
        future.invalidate() // 暂停时无未来可言，释放影子
      }

      // 追踪选中天体
      if (followRef.current && selectedRef.current != null) {
        const b = sim.bodies.find((x) => x.id === selectedRef.current)
        if (b) {
          camRef.current.x += (b.x - camRef.current.x) * 0.12
          camRef.current.y += (b.y - camRef.current.y) * 0.12
        }
      }

      draw(
        ctx,
        sim,
        camRef.current,
        window.innerWidth,
        window.innerHeight,
        starfieldRef.current,
        selectedRef.current,
        spawnPreviewRef.current,
        spawnCfgRef.current,
        now,
        future,
      )
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    const statTimer = setInterval(() => {
      const remoteMode = runModeRef.current === 'remote'
      const stars = sim.bodies.reduce((acc, b) => acc + (b.kind === 'star' || b.kind === 'blackhole' ? 1 : 0), 0)
      setStats({
        bodies: sim.bodies.length,
        stars,
        fps: Math.round(fpsRef.current),
        simTime: remoteMode ? remote.simTime : sim.simTime,
        merges: remoteMode ? remote.merges : sim.merges,
        totalMass: remoteMode ? remote.totalMass : sim.totalMass,
      })
      setSnapTick((t) => t + 1)
      // 选中天体的轨道根数：相对引力主导者的二体解（任意天体，不只飞船）
      const sel = selectedRef.current != null ? sim.bodies.find((x) => x.id === selectedRef.current) : null
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
      const ship = sim.bodies.find((b) => b.kind === 'ship' && b.alive)
      if (ship) {
        const host = resolveOrbitHost(sim, ship.x, ship.y, ship.id)
        const spd = Math.hypot(ship.vx, ship.vy)
        if (host) {
          const r = Math.hypot(ship.x - host.x, ship.y - host.y)
          const mu = sim.config.G * host.mass
          const esc = Math.sqrt((2 * mu) / r)
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
  }, [sim, remote])

  // —— 键盘快捷键 ——
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      keysRef.current.add(e.code)
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault()
      if (e.code === 'Space') {
        e.preventDefault()
        if (runModeRef.current === 'remote') {
          // 远程：暂停状态在服务器上，本地傀儡只是镜像
          const next = !remote.paused
          remote.paused = next
          remote.send({ type: 'pause', paused: next })
        } else {
          sim.config.paused = !sim.config.paused
        }
        rerender()
      } else if (e.key === 't' || e.key === 'T') {
        if (runModeRef.current === 'remote') {
          // 轨迹是本地渲染层行为，直接切傀儡配置即可
          remote.puppet.config.trails = !remote.puppet.config.trails
          remote.config = { ...remote.config, trails: remote.puppet.config.trails }
        } else {
          sim.config.trails = !sim.config.trails
        }
        rerender()
      } else if (e.key === 'Escape') {
        setSelectedId(null)
        setFollow(false)
        spawnPreviewRef.current = null
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedRef.current != null) {
        if (runModeRef.current === 'remote') {
          remote.send({ type: 'remove', id: selectedRef.current })
        } else {
          sim.removeBody(selectedRef.current)
          future.invalidate()
        }
        setSelectedId(null)
      }
    }
    const onKeyUp = (e: KeyboardEvent) => keysRef.current.delete(e.code)
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [sim, rerender, remote])

  // —— 坐标换算 ——
  const toWorld = useCallback((px: number, py: number) => {
    const cam = camRef.current
    return {
      x: (px - window.innerWidth / 2) / cam.zoom + cam.x,
      y: (py - window.innerHeight / 2) / cam.zoom + cam.y,
    }
  }, [])

  // —— 指针交互 ——
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return
    // 随手模式：触屏落在摇杆侧半屏 → 该触点即摇杆中心，优先于平移/拾取
    if (e.pointerType === 'touch' && prefsRef.current.joyMode === 'float' && pointersRef.current.size === 0) {
      const hasShip = sim.bodies.some((b) => b.kind === 'ship' && b.alive)
      const side = prefsRef.current.joySide
      const inZone = side === 'left' ? e.clientX < window.innerWidth * 0.42 : e.clientX > window.innerWidth * 0.58
      if (hasShip && inZone && e.clientY > window.innerHeight * 0.25) {
        pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
        joyAnchorRef.current = { x: e.clientX, y: e.clientY }
        setJoyAnchor(joyAnchorRef.current)
        joystickRef.current = { active: true, x: 0, y: 0 }
        setJoystick({ active: true, x: 0, y: 0 })
        ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
        return
      }
    }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    // 第二根手指落下：取消单指操作，进入捏合缩放
    if (pointersRef.current.size === 2) {
      spawnPreviewRef.current = null
      const g = grabRef.current
      if (g) {
        grabRef.current = null
        if (runModeRef.current === 'remote') {
          if (!g.armed) remote.send({ type: 'release', id: g.id, vx: g.origVx, vy: g.origVy })
        } else {
          const b = sim.bodies.find((x) => x.id === g.id)
          if (b && !g.armed) {
            b.held = false
            b.x = g.origX
            b.y = g.origY
            b.vx = g.origVx
            b.vy = g.origVy
          }
        }
      }
      dragRef.current.active = false
      const pts = [...pointersRef.current.values()]
      const mx = (pts[0].x + pts[1].x) / 2
      const my = (pts[0].y + pts[1].y) / 2
      const w = toWorld(mx, my)
      pinchRef.current = {
        d0: Math.max(Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y), 1),
        zoom0: camRef.current.zoom,
        wx: w.x,
        wy: w.y,
      }
      return
    }
    if (modeRef.current === 'spawn' && e.button === 0) {
      const w = toWorld(e.clientX, e.clientY)
      spawnPreviewRef.current = { active: true, sx: w.x, sy: w.y, cx: w.x, cy: w.y }
    } else if (e.button === 0) {
      // 观察模式：优先尝试抓取天体，落空则平移视野（触屏拾取半径更大）
      const w = toWorld(e.clientX, e.clientY)
      const pickR = (e.pointerType === 'touch' ? 28 : 16) / camRef.current.zoom
      const hit = sim.pick(w.x, w.y, pickR)
      if (hit) {
        grabRef.current = {
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
        setSelectedId(hit.id)
      } else {
        dragRef.current = { active: true, sx: e.clientX, sy: e.clientY, moved: false }
      }
    } else {
      dragRef.current = { active: true, sx: e.clientX, sy: e.clientY, moved: false }
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (pointersRef.current.has(e.pointerId)) pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    // 随手模式摇杆：相对锚点计算偏置（半径 40px 满推）
    if (joystickRef.current.active && joyAnchorRef.current && prefsRef.current.joyMode === 'float') {
      const a = joyAnchorRef.current
      const nx = (e.clientX - a.x) / 40
      const ny = (e.clientY - a.y) / 40
      const m = Math.min(1, Math.hypot(nx, ny))
      const ang = Math.atan2(ny, nx)
      joystickRef.current = { active: true, x: Math.cos(ang) * m, y: Math.sin(ang) * m }
      setJoystick({ ...joystickRef.current })
      return
    }
    // 双指捏合：以双指中点锚定的世界坐标为中心缩放
    if (pinchRef.current && pointersRef.current.size >= 2) {
      const pts = [...pointersRef.current.values()]
      const mx = (pts[0].x + pts[1].x) / 2
      const my = (pts[0].y + pts[1].y) / 2
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
      const cam = camRef.current
      const nz = Math.min(20000, Math.max(0.02, pinchRef.current.zoom0 * (d / pinchRef.current.d0)))
      cam.zoom = nz
      cam.x = pinchRef.current.wx - (mx - window.innerWidth / 2) / nz
      cam.y = pinchRef.current.wy - (my - window.innerHeight / 2) / nz
      return
    }
    if (spawnPreviewRef.current?.active) {
      const w = toWorld(e.clientX, e.clientY)
      spawnPreviewRef.current.cx = w.x
      spawnPreviewRef.current.cy = w.y
      return
    }
    const grab = grabRef.current
    if (grab) {
      const body = sim.bodies.find((b) => b.id === grab.id)
      if (!body) {
        grabRef.current = null
        return
      }
      // 未越过拖动阈值：仅视为选中，天体保持原轨道运行
      if (grab.armed) {
        if (Math.hypot(e.clientX - grab.sx, e.clientY - grab.sy) < (e.pointerType === 'touch' ? 12 : 6)) return
        grab.armed = false
        if (runModeRef.current === 'remote') {
          remote.send({ type: 'grab', id: grab.id })
        } else {
          body.held = true
          future.invalidate() // 拖拽开始，旧未来作废
        }
      }
      const w = toWorld(e.clientX, e.clientY)
      const now = performance.now()
      const dtReal = Math.max((now - grab.lastT) / 1000, 1e-3)
      // 指针速度（世界单位/真实秒）→ 模拟速度需除以时间倍率，平滑滤波防抖
      const ivx = ((w.x - grab.lastX) / dtReal) / sim.config.timeScale
      const ivy = ((w.y - grab.lastY) / dtReal) / sim.config.timeScale
      grab.vx += (ivx - grab.vx) * 0.45
      grab.vy += (ivy - grab.vy) * 0.45
      grab.lastX = w.x
      grab.lastY = w.y
      grab.lastT = now
      const dx = w.x - body.x
      const dy = w.y - body.y
      if (Math.abs(dx) + Math.abs(dy) > 0.5 / camRef.current.zoom) grab.moved = true
      if (runModeRef.current === 'remote') {
        // 远程：拖拽位置发服务器；本地傀儡同步摆过去，避免等待网络帧的空窗
        remote.send({ type: 'drag', id: grab.id, x: w.x, y: w.y })
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
    const d = dragRef.current
    if (!d.active) return
    const dx = e.clientX - d.sx
    const dy = e.clientY - d.sy
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true
    camRef.current.x -= dx / camRef.current.zoom
    camRef.current.y -= dy / camRef.current.zoom
    d.sx = e.clientX
    d.sy = e.clientY
  }

  const onPointerUp = (e: React.PointerEvent) => {
    pointersRef.current.delete(e.pointerId)
    // 随手模式摇杆松手
    if (joyAnchorRef.current) {
      joyAnchorRef.current = null
      setJoyAnchor(null)
      joystickRef.current = { active: false, x: 0, y: 0 }
      setJoystick({ active: false, x: 0, y: 0 })
      return
    }
    if (pinchRef.current) {
      if (pointersRef.current.size < 2) pinchRef.current = null
      // 捏合期间不触发任何单指逻辑
      grabRef.current = null
      dragRef.current.active = false
      spawnPreviewRef.current = null
      return
    }
    const sp = spawnPreviewRef.current
    if (sp?.active) {
      spawnPreviewRef.current = null
      const w = toWorld(e.clientX, e.clientY)
      const cfg = spawnCfgRef.current
      // 飞船部署：全场唯一——先退役旧飞船，再按自动圆轨道放置新飞船
      if (cfg.kind === 'ship') {
        const host = sim.dominantMassive(sp.sx, sp.sy)
        let svx = 0
        let svy = 0
        if (host) {
          const dx = sp.sx - host.x
          const dy = sp.sy - host.y
          const d = Math.hypot(dx, dy)
          if (d > host.radius * 2) {
            const v = Math.sqrt((sim.config.G * host.mass) / d)
            svx = host.vx + (-dy / d) * v
            svy = host.vy + (dx / d) * v
          }
        }
        if (runModeRef.current === 'remote') {
          // 远程：服务器负责退役旧船并创建新船（id 由下帧清单带回来）
          remote.send({ type: 'spawn', kind: 'ship', x: sp.sx, y: sp.sy, vx: svx, vy: svy, mass: 0.001 })
          setSelectedId(null)
        } else {
          for (const s of sim.bodies.filter((b) => b.kind === 'ship')) sim.removeBody(s.id)
          const shipBody = sim.addBody({ kind: 'ship', x: sp.sx, y: sp.sy, vx: svx, vy: svy, mass: 0.001 })
          future.invalidate()
          sim.addEffect(sp.sx, sp.sy, shipBody.radius * 3 + 4, '#34d399', 'spawn')
          setSelectedId(shipBody.id)
        }
        setMode('pan') // 部署完即回观察模式，直接开飞
        return
      }
      let vx = (w.x - sp.sx) * V_SCALE
      let vy = (w.y - sp.sy) * V_SCALE
      if (cfg.autoOrbit) {
        const host = sim.dominantMassive(sp.sx, sp.sy)
        if (host) {
          const dx = sp.sx - host.x
          const dy = sp.sy - host.y
          const d = Math.hypot(dx, dy)
          if (d > host.radius * 2) {
            const v = Math.sqrt((sim.config.G * host.mass) / d)
            vx = host.vx + (-dy / d) * v
            vy = host.vy + (dx / d) * v
          }
        } else {
          vx = 0
          vy = 0
        }
      }
      // 真实比例场景：生成物带视觉放大倍率，保持与场景内天体同一比例
      const useBoost = unitsRef.current != null
      const visBoost = useBoost ? (cfg.kind === 'star' ? 15 : 8) : undefined
      if (runModeRef.current === 'remote') {
        remote.send({ type: 'spawn', kind: cfg.kind, x: sp.sx, y: sp.sy, vx, vy, mass: cfg.mass, visBoost })
        return
      }
      const body = sim.addBody({
        kind: cfg.kind,
        x: sp.sx,
        y: sp.sy,
        vx,
        vy,
        mass: cfg.mass,
        visBoost,
      })
      future.invalidate() // 新天体加入，分叉重算
      sim.addEffect(sp.sx, sp.sy, body.radius * 3 + 4, '#22d3ee', 'spawn')
      setSelectedId(body.id)
      return
    }
    const grab = grabRef.current
    if (grab) {
      grabRef.current = null
      const body = sim.bodies.find((b) => b.id === grab.id)
      if (runModeRef.current === 'remote') {
        if (!grab.armed) {
          // 甩出（或放回）：把最终速度交服务器
          if (grab.moved) {
            const cap = 80
            const mag = Math.hypot(grab.vx, grab.vy)
            const k = mag > cap ? cap / mag : 1
            remote.send({ type: 'release', id: grab.id, vx: grab.vx * k, vy: grab.vy * k })
          } else {
            remote.send({ type: 'release', id: grab.id, vx: grab.origVx, vy: grab.origVy })
            remote.send({ type: 'drag', id: grab.id, x: grab.origX, y: grab.origY })
            remote.send({ type: 'release', id: grab.id, vx: grab.origVx, vy: grab.origVy })
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
    const d = dragRef.current
    if (!d.active) return
    d.active = false
    if (!d.moved) {
      // 点击拾取
      const w = toWorld(e.clientX, e.clientY)
      const hit = sim.pick(w.x, w.y, 14 / camRef.current.zoom)
      setSelectedId(hit ? hit.id : null)
      if (!hit) setFollow(false)
    }
  }

  const onWheel = (e: React.WheelEvent) => {
    const cam = camRef.current
    const factor = Math.pow(1.0015, -e.deltaY)
    const nz = Math.min(20000, Math.max(0.02, cam.zoom * factor))
    const w = toWorld(e.clientX, e.clientY)
    cam.zoom = nz
    // 缩放锚定在光标处
    cam.x = w.x - (e.clientX - window.innerWidth / 2) / nz
    cam.y = w.y - (e.clientY - window.innerHeight / 2) / nz
  }

  const onConfig = useCallback(
    (patch: Partial<SimConfig>) => {
      // 性能档是渲染端行为（傀儡/本地各自生效），不进服务器
      const { perfTier, ...phys } = patch
      if (perfTier != null) sim.config.perfTier = perfTier
      if (runModeRef.current === 'remote') {
        // 远程：物理参数发服务器；傀儡配置也同步一份（trails 等渲染层直接读）
        const out: Record<string, number | boolean> = { ...phys }
        if (phys.timeScale != null) {
          baseTimeScaleRef.current = phys.timeScale
          out.timeScale = phys.timeScale * warpRef.current
        }
        if (Object.keys(out).length > 0) remote.send({ type: 'config', patch: out })
        Object.assign(remote.puppet.config, phys)
        rerender()
        return
      }
      Object.assign(sim.config, phys)
      // 滑杆调整的是基准流速，时间倍率在此基础上叠加
      if (patch.timeScale != null) {
        baseTimeScaleRef.current = patch.timeScale
        sim.config.timeScale = patch.timeScale * warpRef.current
        future.invalidate() // 流速变了，按旧流速推的缓冲未来作废
      }
      // 物理参数变化 → 预演分叉（G/软化已锁定，仅保留兼容）
      if (patch.G != null || patch.softening != null) future.invalidate()
      rerender()
    },
    [sim, rerender, future, remote],
  )

  // 时间倍率：在预设/滑杆基准流速上乘 1/10/100/1000
  const warpRef = useRef(1)
  const baseTimeScaleRef = useRef(40)
  const applyWarp = useCallback(
    (w: number) => {
      warpRef.current = w
      setWarp(w)
      if (runModeRef.current === 'remote') {
        remote.send({ type: 'config', patch: { timeScale: baseTimeScaleRef.current * w } })
      } else {
        sim.config.timeScale = baseTimeScaleRef.current * w
        future.invalidate() // 流速变了，按旧流速推的缓冲未来作废
      }
      rerender()
    },
    [sim, rerender, future, remote],
  )
  const doRewind = useCallback(() => {
    if (runModeRef.current === 'remote') {
      remote.send({ type: 'rewind' })
      return
    }
    if (sim.rewind() != null) {
      setSelectedId(null)
      setFollow(false)
      future.invalidate() // 回退后未来全部作废，从新状态重算
      rerender()
    }
  }, [sim, rerender, future, remote])

  const onSpawnSettings = useCallback((patch: Partial<SpawnSettings>) => {
    setSpawnCfg((s) => ({ ...s, ...patch }))
  }, [])

  // 部署飞船：进入放置模式（飞船不参与质量滑杆，全场唯一）
  const deployShip = useCallback(() => {
    setSpawnCfg((s) => ({ ...s, kind: 'ship' }))
    setMode('spawn')
  }, [])

  const selected = useMemo(() => sim.bodies.find((b) => b.id === selectedId) ?? null, [sim, selectedId, stats])

  const hintText =
    mode === 'spawn'
      ? spawnCfg.kind === 'ship'
        ? '点击画布部署飞船（自动进入环绕轨道）· ESC 取消'
        : spawnCfg.autoOrbit
          ? '点击画布放置天体 · 自动获得圆轨道速度 · ESC 取消'
          : '按住拖拽放置天体 · 拖拽方向 = 初速度 · ESC 取消'
      : '拖动天体移动 / 甩出 · 拖动空白平移 · 滚轮缩放 · 空格暂停'

  // 真实比例场景下，用真实单位显示选中天体信息
  const selMass = units
    ? (() => {
        const kg = selected ? selected.mass * units.massKg : 0
        const exp = Math.floor(Math.log10(Math.max(kg, 1e-30)))
        return `${(kg / 10 ** exp).toFixed(2)}×10^${exp} kg`
      })()
    : null
  const selVel = units && selected ? `${((Math.hypot(selected.vx, selected.vy) * units.velMs) / 1000).toFixed(2)} km/s` : null
  const selRad = units && selected ? `${((selected.radius * units.distM) / 1000).toFixed(0)} km` : null
  const selDist =
    units && selected
      ? (() => {
          const au = (Math.hypot(selected.x, selected.y) * units.distM) / 1.496e11
          if (au >= 3000) return `${(au / 63241).toFixed(2)} 光年`
          if (au >= 10) return `${au.toFixed(1)} AU`
          return `${au.toFixed(3)} AU`
        })()
      : null

  return (
    <div className="scanlines relative h-full w-full overflow-hidden bg-[#050810]">
      <canvas
        ref={canvasRef}
        className={`absolute inset-0 touch-none ${mode === 'spawn' ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
      />

      {/* 左上：标题 + HUD */}
      <div className="pointer-events-none absolute left-3 top-3 z-10 origin-top-left scale-[0.72] sm:left-5 sm:top-5 sm:scale-100">
        <StatsBar stats={stats} zoom={camRef.current.zoom} running={isRemote ? !remote.paused : !sim.config.paused} units={units} />
      </div>

      {/* 时间控制条：倍率快进 + 快照回退 */}
      <div className="glass pointer-events-auto absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-md px-2 py-1">
        <button
          onClick={doRewind}
          disabled={!isRemote && sim.snapshotCount === 0}
          title="回退到上一个时间点（约每1.5秒一帧快照）"
          className="rounded px-2 py-1 font-mono text-[10px] text-[#5b6b8c] transition-colors hover:text-[#dbe4f3] disabled:opacity-30"
        >
          ⏪ 回退
        </button>
        <div className="h-3.5 w-px bg-[#1a2540]" />
        {[1, 10, 100, 1000].map((w) => (
          <button
            key={w}
            onClick={() => applyWarp(w)}
            className={`rounded px-2 py-1 font-mono text-[10px] transition-all ${
              warp === w
                ? 'bg-[#22d3ee]/20 text-[#22d3ee] shadow-[0_0_10px_rgba(34,211,238,0.25)]'
                : 'text-[#5b6b8c] hover:text-[#dbe4f3]'
            }`}
          >
            ×{w}
          </button>
        ))}
        <div className="h-3.5 w-px bg-[#1a2540]" />
        <button
          onClick={() => setSettingsOpen(true)}
          title="设置（摇杆/预演）"
          className="rounded px-2 py-1 font-mono text-[10px] text-[#5b6b8c] transition-colors hover:text-[#dbe4f3]"
        >
          ⚙
        </button>
      </div>

      {/* 设置抽屉 */}
      <SettingsPanel open={settingsOpen} prefs={prefs} onChange={onPrefs} onClose={() => setSettingsOpen(false)} remoteStatus={remoteStatus} />

      {/* 触屏虚拟摇杆（有飞船且触屏设备时显示） */}
      {isTouch &&
        sim.bodies.some((b) => b.kind === 'ship' && b.alive) &&
        // 固定模式：常驻角落；随手模式：仅在按住时于锚点显示
        (prefs.joyMode === 'fixed' || joyAnchor) && (
          <div
            className="glass pointer-events-auto absolute z-20 h-28 w-28 touch-none rounded-full"
            style={
              prefs.joyMode === 'float' && joyAnchor
                ? { left: joyAnchor.x - 56, top: joyAnchor.y - 56, opacity: 0.85 }
                : prefs.joySide === 'left'
                  ? { bottom: 80, left: 16 }
                  : { bottom: 80, right: 16 }
            }
            onPointerDown={(e) => {
              if (prefs.joyMode === 'float') return // 浮动的按下已由画布热区处理
              ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
              const rect = e.currentTarget.getBoundingClientRect()
              const nx = ((e.clientX - rect.left) / rect.width - 0.5) * 2
              const ny = ((e.clientY - rect.top) / rect.height - 0.5) * 2
              const m = Math.min(1, Math.hypot(nx, ny))
              const a = Math.atan2(ny, nx)
              joystickRef.current = { active: true, x: Math.cos(a) * m, y: Math.sin(a) * m }
              setJoystick({ ...joystickRef.current })
            }}
            onPointerMove={(e) => {
              if (!joystickRef.current.active || prefs.joyMode === 'float') return
              const rect = e.currentTarget.getBoundingClientRect()
              const nx = ((e.clientX - rect.left) / rect.width - 0.5) * 2
              const ny = ((e.clientY - rect.top) / rect.height - 0.5) * 2
              const m = Math.min(1, Math.hypot(nx, ny))
              const a = Math.atan2(ny, nx)
              joystickRef.current = { active: true, x: Math.cos(a) * m, y: Math.sin(a) * m }
              setJoystick({ ...joystickRef.current })
            }}
            onPointerUp={() => {
              joystickRef.current = { active: false, x: 0, y: 0 }
              setJoystick({ active: false, x: 0, y: 0 })
            }}
            onPointerCancel={() => {
              joystickRef.current = { active: false, x: 0, y: 0 }
              setJoystick({ active: false, x: 0, y: 0 })
            }}
          >
            <div className="absolute inset-0 rounded-full border border-[#22d3ee]/25" />
            <div className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#22d3ee]/40" />
            <div
              className="absolute h-9 w-9 rounded-full border border-[#22d3ee]/50 bg-[#22d3ee]/20 shadow-[0_0_14px_rgba(34,211,238,0.35)]"
              style={{ left: `calc(50% + ${joystick.x * 36}px)`, top: `calc(50% + ${joystick.y * 36}px)`, transform: 'translate(-50%,-50%)' }}
            />
            <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap font-mono text-[9px] tracking-[0.2em] text-[#5b6b8c]">
              推进器摇杆
            </div>
          </div>
        )}

      {/* 飞船控制台：只管遥测与操控（轨道根数在选中面板里看）；触屏固定摇杆在左侧时抬高避开 */}
      {shipTel && (
        <div
          className={`glass mg-fadeup pointer-events-none absolute z-10 w-[180px] rounded-lg p-3 font-mono sm:left-5 ${
            isTouch && prefs.joyMode === 'fixed' && prefs.joySide === 'left'
              ? 'bottom-56 left-3'
              : 'left-3 top-1/2 -translate-y-1/2'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[9px] tracking-[0.25em] text-[#34d399]/90">飞船遥测</span>
            <span className="h-1.5 w-1.5 rounded-full bg-[#34d399]" style={{ animation: 'mg-pulse 1.4s ease-in-out infinite' }} />
          </div>
          <div className="mt-2 space-y-1 text-[10.5px] text-[#dbe4f3]/90">
            <div className="flex justify-between"><span className="text-[#5b6b8c]">速度</span><span>{units ? `${((shipTel.speed * units.velMs) / 1000).toFixed(2)} km/s` : `${shipTel.speed.toFixed(2)} u/s`}</span></div>
            <div className="flex justify-between"><span className="text-[#5b6b8c]">高度</span><span>{units ? `${((shipTel.altitude * units.distM) / 1.496e11).toFixed(3)} AU` : shipTel.altitude.toFixed(1)}</span></div>
            <div className="flex justify-between">
              <span className="text-[#5b6b8c]">速度/逃逸</span>
              <span className={shipTel.escRatio >= 1 ? 'text-[#fbbf24]' : ''}>{shipTel.escRatio.toFixed(2)}×{shipTel.escRatio >= 1 ? ' 逃逸!' : ''}</span>
            </div>
            {shipTel.dilation != null && (
              <div className="flex justify-between">
                <span className="text-[#5b6b8c]">时间膨胀</span>
                <span className={shipTel.dilation < 0.85 ? 'text-[#fbbf24]' : ''}>dτ/dt = {shipTel.dilation.toFixed(3)}</span>
              </div>
            )}
          </div>
          {/* 油门条 */}
          <div className="mt-2.5">
            <div className="flex justify-between text-[9px] text-[#5b6b8c]"><span>油门</span><span>{Math.round(shipTel.throttle * 100)}%</span></div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-sm bg-[#1a2540]">
              <div
                className="h-full rounded-sm transition-all duration-100"
                style={{ width: `${shipTel.throttle * 100}%`, background: shipTel.throttle > 0.8 ? '#fbbf24' : '#34d399', boxShadow: '0 0 8px rgba(52,211,153,0.5)' }}
              />
            </div>
          </div>
          <div className="mt-2 border-t border-[#1a2540] pt-1.5 text-[9px] leading-relaxed text-[#5b6b8c]">
            {isTouch ? '摇杆 = 推力方向与油门（满推 50%）' : 'W/S 顺行/逆行 · A/D 侧移 · Shift 全推力'}
          </div>
        </div>
      )}

      {/* 右上：控制面板 */}
      <div className="absolute right-3 top-3 z-10 flex flex-col items-end gap-2 sm:right-5 sm:top-5">
        <button
          onClick={() => setPanelOpen(!panelOpen)}
          className="glass pointer-events-auto rounded-md px-3 py-1.5 font-mono text-[10px] tracking-[0.2em] text-[#5b6b8c] transition-colors hover:text-[#dbe4f3]"
        >
          {panelOpen ? '收起面板 −' : '控制面板 +'}
        </button>
        {/* 性能档位指示（远程模式显示连接状态） */}
        {isRemote ? (
          <div className="glass pointer-events-none rounded-md px-2 py-1 font-mono text-[9px] text-[#5b6b8c]">
            远程{' '}
            <span
              className={
                remoteStatus === 'connected' ? 'text-[#34d399]' : remoteStatus === 'connecting' ? 'text-[#fbbf24]' : 'text-[#f87171]'
              }
            >
              {remoteStatus === 'connected' ? '已连接·服务器运算' : remoteStatus === 'connecting' ? '连接中…' : remoteStatus === 'error' ? '连接失败' : '未连接'}
            </span>
          </div>
        ) : (
          <div className="glass pointer-events-none rounded-md px-2 py-1 font-mono text-[9px] text-[#5b6b8c]">
            性能档 <span className="text-[#22d3ee]">{sim.config.perfTier === 'auto' ? `自动·${sim.perf === PERF_TIERS.ultra ? '极致' : sim.perf === PERF_TIERS.high ? '高' : sim.perf === PERF_TIERS.balanced ? '均衡' : sim.perf === PERF_TIERS.low ? '低' : '省电'}` : { ultra: '极致', high: '高', balanced: '均衡', low: '低', saver: '省电' }[sim.config.perfTier as 'ultra' | 'high' | 'balanced' | 'low' | 'saver']}</span>
          </div>
        )}
        {panelOpen && (
          <div className="max-h-[calc(100dvh-110px)] overflow-y-auto">
          <ControlPanel
            config={sim.config}
            onConfig={onConfig}
            mode={mode}
            onMode={setMode}
            spawn={spawnCfg}
            onSpawn={onSpawnSettings}
            currentPreset={currentPreset}
            onPreset={applyPreset}
            onResetScene={() => applyPreset(currentPreset)}
            onClear={() => {
              if (runModeRef.current === 'remote') {
                remote.send({ type: 'clear' })
              } else {
                sim.reset()
                future.invalidate()
              }
              unitsRef.current = undefined
              setUnits(undefined)
              setCurrentPreset('empty')
              setSelectedId(null)
            }}
            onResetView={() => (camRef.current = { x: 0, y: 0, zoom: 1 })}
            hasShip={sim.bodies.some((b) => b.kind === 'ship' && b.alive)}
            onDeployShip={deployShip}
          />
          </div>
        )}
      </div>

      {/* 左下：选中天体信息（含轨道根数，任意天体都有）；触屏固定摇杆在左侧时抬高避开 */}
      {selected && (
        <div
          className={`glass mg-fadeup pointer-events-auto absolute z-10 w-[min(250px,72vw)] rounded-lg p-4 sm:bottom-12 sm:left-5 ${
            isTouch && prefs.joyMode === 'fixed' && prefs.joySide === 'left' && sim.bodies.some((b) => b.kind === 'ship' && b.alive)
              ? 'bottom-56 left-3'
              : 'bottom-4 left-3'
          }`}
        >
          <div className="flex items-start justify-between">
            <div>
              <div className="text-[13px] font-medium text-[#dbe4f3]">{selected.name}</div>
              <div className="mt-0.5 font-mono text-[9px] tracking-[0.25em] text-[#5b6b8c]">
                {KIND_LABEL[selected.kind].toUpperCase()} · ID {selected.id}
              </div>
            </div>
            <div className="h-3 w-3 rounded-full" style={{ background: selected.color, boxShadow: `0 0 10px ${selected.glow}` }} />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 font-mono text-[11px]">
            <div>
              <div className="text-[9px] tracking-[0.15em] text-[#5b6b8c]">质量{units ? '' : ' M*'}</div>
              <div className="text-[#dbe4f3]">{selMass ?? selected.mass.toPrecision(4)}</div>
            </div>
            <div>
              <div className="text-[9px] tracking-[0.15em] text-[#5b6b8c]">速度</div>
              <div className="text-[#dbe4f3]">{selVel ?? `${Math.hypot(selected.vx, selected.vy).toFixed(2)} u/s`}</div>
            </div>
            <div>
              <div className="text-[9px] tracking-[0.15em] text-[#5b6b8c]">半径</div>
              <div className="text-[#dbe4f3]">{selRad ?? `${selected.radius.toFixed(1)} u`}</div>
            </div>
            <div>
              <div className="text-[9px] tracking-[0.15em] text-[#5b6b8c]">距原点</div>
              <div className="text-[#dbe4f3]">{selDist ?? `${Math.hypot(selected.x, selected.y).toFixed(0)} u`}</div>
            </div>
          </div>
          {/* 轨道根数：相对引力主导者的二体解 */}
          {selOrbit && (
            <div className="mt-3 space-y-1 border-t border-[#1a2540] pt-2 font-mono text-[10.5px]">
              <div className="text-[9px] tracking-[0.2em] text-[#5b6b8c]">轨道 · 绕{selOrbit.host}</div>
              {selOrbit.rp > 0 ? (
                <>
                  <div className="flex justify-between"><span className="text-[#5b6b8c]">近拱点</span><span className="text-[#dbe4f3]">{units ? (selOrbit.rp * units.distM / 1.496e11).toFixed(3) + ' AU' : selOrbit.rp.toFixed(1)}</span></div>
                  <div className="flex justify-between"><span className="text-[#5b6b8c]">远拱点</span><span className="text-[#dbe4f3]">{units ? (selOrbit.ra * units.distM / 1.496e11).toFixed(3) + ' AU' : selOrbit.ra.toFixed(1)}</span></div>
                  <div className="flex justify-between"><span className="text-[#5b6b8c]">偏心率</span><span className="text-[#dbe4f3]">{selOrbit.ecc.toFixed(3)}</span></div>
                  <div className="flex justify-between"><span className="text-[#5b6b8c]">周期</span><span className="text-[#dbe4f3]">{units ? (selOrbit.T * units.timeDays / 365.25).toFixed(2) + ' 年' : selOrbit.T.toFixed(0)}</span></div>
                </>
              ) : (
                <div className="flex justify-between"><span className="text-[#fbbf24]/80">轨道</span><span className="text-[#fbbf24]">双曲线 · 逃逸中</span></div>
              )}
              <div className="flex justify-between"><span className="text-[#5b6b8c]">速度/逃逸</span><span className="text-[#dbe4f3]">{(selOrbit.vr / selOrbit.esc).toFixed(2)}×</span></div>
              {selOrbit.rsRatio != null && (
                <>
                  <div className="flex justify-between">
                    <span className="text-[#5b6b8c]">距视界</span>
                    <span className={selOrbit.rsRatio < 6 ? 'text-[#f87171]' : 'text-[#dbe4f3]'}>{selOrbit.rsRatio.toFixed(1)} r_s{selOrbit.rsRatio < 6 ? ' · ISCO内!' : ''}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#5b6b8c]">时间膨胀</span>
                    <span className={(selOrbit.dilation ?? 1) < 0.85 ? 'text-[#fbbf24]' : 'text-[#dbe4f3]'}>dτ/dt = {(selOrbit.dilation ?? 1).toFixed(3)}</span>
                  </div>
                </>
              )}
            </div>
          )}
          <div className="mt-3 flex gap-1.5">
            <button
              onClick={() => setFollow(!follow)}
              className={`flex-1 rounded border px-2 py-1 text-[11px] transition-all ${
                follow
                  ? 'border-[#22d3ee]/60 bg-[#22d3ee]/15 text-[#22d3ee]'
                  : 'border-[#1a2540] text-[#dbe4f3]/70 hover:border-[#22d3ee]/40'
              }`}
            >
              {follow ? '◉ 追踪中' : '◎ 追踪'}
            </button>
            <button
              onClick={() => {
                if (runModeRef.current === 'remote') {
                  remote.send({ type: 'remove', id: selected.id })
                } else {
                  sim.removeBody(selected.id)
                  future.invalidate()
                }
                setSelectedId(null)
              }}
              className="flex-1 rounded border border-[#f87171]/25 px-2 py-1 text-[11px] text-[#f87171]/80 transition-all hover:border-[#f87171]/50"
            >
              删除
            </button>
          </div>
        </div>
      )}

      {/* 底部：操作提示 */}
      <div className="pointer-events-none absolute bottom-14 left-1/2 z-10 hidden -translate-x-1/2 sm:block">
        <div className="glass rounded-md px-5 py-1.5 font-mono text-[10.5px] tracking-wider text-[#5b6b8c]">
          {hintText}
        </div>
      </div>
    </div>
  )
}
