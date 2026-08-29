import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Simulation } from '../sim/engine'
import { FutureBuffer } from '../sim/future'
import { NetSim, type NetStatus } from '../sim/net'
import { loadPreset, PRESETS } from '../sim/presets'
import { kindForMass } from '../sim/engine'
import { draw, makeStarfield, type SpawnPreview } from '../sim/renderer'
import type { Body, Camera, PerfTier, PresetId, SimConfig, SimStats, SpawnSettings, ToolMode, UnitProfile } from '../sim/types'
import { PERF_TIERS } from '../sim/types'
import Dock from '../sections/Dock'
import GameMenu from '../sections/GameMenu'
import MainMenu, { type AutosaveInfo } from '../sections/MainMenu'
import SelectedCard from '../sections/SelectedCard'
import ShipTelemetry from '../sections/ShipTelemetry'
import StatsBar from '../sections/StatsBar'
import { loadPrefs, savePrefs, type Prefs } from '../sim/prefs'
import { exportSaveFile, importSaveFile } from '../sim/save'
import { deleteSave, getAutosave, getSave, listSaves, putAutosave, putSave, type SaveMeta } from '../sim/saveStore'

const V_SCALE = 0.022 // 拖拽距离 → 初速度

/** 性能档位中文名（徽标用） */
const TIER_LABEL: Record<PerfTier, string> = { ultra: '极致', high: '高', balanced: '均衡', low: '低', saver: '省电' }

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

/** T+ 读数：无单位时按模拟时间缩写，有单位时换算真实 天/年 */
function fmtSimTime(t: number, units?: UnitProfile): string {
  if (units) {
    const days = t * units.timeDays
    return days < 730 ? `${days.toFixed(0)} 天` : `${(days / 365.25).toFixed(2)} 年`
  }
  if (t < 1000) return t.toFixed(1)
  if (t < 100000) return t.toFixed(0)
  return t.toExponential(2)
}

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // 离线兜底模拟：服务器不可用时顶上；联机时物理权威在服务器，客户端读镜像
  const localSimRef = useRef<Simulation | null>(null)
  if (!localSimRef.current) localSimRef.current = new Simulation()
  const localSim = localSimRef.current
  // 联机客户端：镜像模拟（渲染层直接读），权威帧对账纠偏
  const netRef = useRef<NetSim | null>(null)
  if (!netRef.current) netRef.current = new NetSim()
  const net = netRef.current
  const [netStatus, setNetStatus] = useState<NetStatus>(net.status)
  net.onStatus = setNetStatus
  // 联机状态（房间/玩家/投票/权限）变化时重渲染
  const [, setLobbyTick] = useState(0)
  net.onLobby = () => setLobbyTick((t) => t + 1)
  // 单模式：在线 = 已连上服务器；激活模拟 = 在线用镜像、离线用本地
  const online = netStatus === 'connected'
  const sim = online ? net.mirror : localSim
  const onlineRef = useRef(online)
  const activeSimRef = useRef<Simulation>(localSim)
  onlineRef.current = online
  activeSimRef.current = sim

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
  // 偏好设置（摇杆模式/位置、预演时长、房号、性能档），localStorage 持久化
  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs())
  const prefsRef = useRef(prefs)
  // 浮动摇杆的锚点（屏幕坐标，随手模式下手指落点即摇杆中心）
  const joyAnchorRef = useRef<{ x: number; y: number } | null>(null)
  const [joyAnchor, setJoyAnchor] = useState<{ x: number; y: number } | null>(null)
  // 触屏多指跟踪：双指捏合缩放
  const pointersRef = useRef(new Map<number, { x: number; y: number }>())
  const pinchRef = useRef<{ d0: number; zoom0: number; wx: number; wy: number } | null>(null)
  const modeRef = useRef<ToolMode>('pan')
  const spawnCfgRef = useRef<SpawnSettings>({ kind: 'planet', mass: 20, autoOrbit: false })
  const selectedRef = useRef<number | null>(null)
  const followRef = useRef(false)
  // 未来预演缓冲（仅离线单机用）：影子模拟以快于画面的速度推演，渲染帧消费缓冲
  const futureRef = useRef<FutureBuffer | null>(null)
  if (!futureRef.current) futureRef.current = new FutureBuffer()
  const future = futureRef.current
  // 上一帧油门/方向（检测推力变化 → 分叉或发服务器）
  const lastThrottleRef = useRef(0)
  const lastThrustDirRef = useRef({ x: 0, y: 0 })

  const [, setTick] = useState(0)
  const rerender = useCallback(() => setTick((t) => t + 1), [])

  const [mode, setMode] = useState<ToolMode>('pan')
  const [warp, setWarp] = useState(1)
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
  const [currentPreset, setCurrentPreset] = useState<PresetId>('real')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [follow, setFollow] = useState(false)
  // 窄屏（手机/平板竖屏）默认收起停靠栏，画布优先
  const [dockOpen, setDockOpen] = useState(() => (typeof window === 'undefined' ? true : window.innerWidth >= 820))
  const [stats, setStats] = useState<SimStats>({ bodies: 0, stars: 0, fps: 60, simTime: 0, merges: 0, totalMass: 0 })
  const unitsRef = useRef<UnitProfile | undefined>(undefined)
  const [units, setUnits] = useState<UnitProfile | undefined>(undefined)
  // 本地存档库
  const [saves, setSaves] = useState<SaveMeta[]>([])
  const [saveMsg, setSaveMsg] = useState('')
  const saveMsgTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // MC 式双层界面：menu = 主菜单（世界列表/多人），game = 游戏；menuOpen = 游戏内菜单按钮展开的覆盖层
  const [screen, setScreen] = useState<'menu' | 'game'>('menu')
  const [menuOpen, setMenuOpen] = useState(false)
  const [autosaveInfo, setAutosaveInfo] = useState<AutosaveInfo | null>(null)
  // 时间倍率：在预设/滑杆基准流速上乘 1/10/100/1000
  const warpRef = useRef(1)
  const baseTimeScaleRef = useRef(40)
  const currentPresetRef = useRef<PresetId>('real')
  /** 启动恢复存档是一次异步过程：用户先动了预设/存档就放弃恢复 */
  const userTouchedRef = useRef(false)

  modeRef.current = mode
  spawnCfgRef.current = spawnCfg
  selectedRef.current = selectedId
  followRef.current = follow
  prefsRef.current = prefs
  currentPresetRef.current = currentPreset

  const onPrefs = useCallback((patch: Partial<Prefs>) => {
    setPrefs((p) => {
      const next = { ...p, ...patch }
      savePrefs(next)
      return next
    })
  }, [])

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
    if (onlineRef.current) return // 联机时权威在房间，不覆盖本地自动存档
    try {
      const state = localSim.serialize(currentPresetRef.current)
      state.camera = { ...camRef.current }
      void putAutosave(state)
    } catch {
      /* IndexedDB 不可用时静默 */
    }
  }, [localSim])

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

  // —— 显式连接后的断线自动重试（默认离线，不自动连） ——
  const netDesiredRef = useRef(false)
  const connectNet = useCallback(() => {
    netDesiredRef.current = true
    net.pendingRoom = prefsRef.current.roomCode
    net.connect()
  }, [net])

  // hostsave 结果：开房成功给出房号提示
  net.onHosted = (room) => {
    if (room) showSaveMsg(`已开放到局域网 · 房号 ${room}，朋友打开本页面填房号即可加入`)
    setLobbyTick((t) => t + 1)
  }

  // 房主解散房间（MC：房主走，房没）：回到离线单机
  net.onRoomClosed = (reason) => {
    netDesiredRef.current = false
    showSaveMsg(reason === 'host_closed' ? '房主已关闭房间，回到单机模式' : '房主已离开，房间解散，回到单机模式')
    setLobbyTick((t) => t + 1)
  }

  // 房间预设（进房/房内投票切换）：客户端采用房间的呈现（相机/单位/流速）
  net.onPreset = (preset) => {
    const id = (PRESETS.some((pr) => pr.id === preset) ? preset : 'empty') as PresetId
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
  }

  // —— 挂载：以存档为基础启动（恢复上次的宇宙），默认离线单机；联机需显式连接 ——
  useEffect(() => {
    let cancelled = false
    void (async () => {
      let restored = false
      try {
        const rec = await getAutosave()
        // 用户在恢复完成前已切预设/载入存档时，放弃恢复（避免旧存档覆盖新操作）
        if (rec && !cancelled && !userTouchedRef.current) {
          localSim.restoreWorld(rec.state)
          restored = true
          setAutosaveInfo({ savedAt: rec.savedAt, bodies: rec.state.bodies.length, preset: rec.state.preset })
          const pid = rec.state.preset
          if (pid && PRESETS.some((pr) => pr.id === pid)) {
            // 合法预设：用探针恢复单位换算，相机用存档里的
            const probe = new Simulation()
            const { zoom, units: u } = loadPreset(probe, pid as PresetId)
            camRef.current = rec.state.camera ?? { x: 0, y: 0, zoom }
            unitsRef.current = u
            setUnits(u)
            baseTimeScaleRef.current = rec.state.config.timeScale
            setCurrentPreset(pid as PresetId)
          } else {
            camRef.current = rec.state.camera ?? { x: 0, y: 0, zoom: 1 }
            unitsRef.current = undefined
            setUnits(undefined)
            baseTimeScaleRef.current = rec.state.config.timeScale
            setCurrentPreset('empty')
          }
        }
      } catch {
        /* IndexedDB 不可用（隐私模式等）：走默认预设 */
      }
      if (!restored && !cancelled) {
        const { zoom, units: u } = loadPreset(localSim, 'real')
        camRef.current = { x: 0, y: 0, zoom }
        baseTimeScaleRef.current = localSim.config.timeScale
        unitsRef.current = u
        setUnits(u)
        setCurrentPreset('real')
      }
      if (!cancelled) {
        future.fork(localSim)
        rerender()
      }
    })()
    return () => {
      cancelled = true
      net.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const t = setInterval(() => {
      if (netDesiredRef.current && (net.status === 'disconnected' || net.status === 'error')) net.connect()
    }, 15000)
    return () => clearInterval(t)
  }, [net])

  // —— 房间号变化：换房（在线时立即加入，离线记为待进房） ——
  useEffect(() => {
    net.pendingRoom = prefs.roomCode
    if (net.status === 'connected') {
      net.joinRoom(prefs.roomCode || undefined)
      setSelectedId(null)
      setFollow(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs.roomCode])

  // —— 联机点选天体：拉取权限表（选中卡片显示归属/授权用） ——
  useEffect(() => {
    if (net.status === 'connected' && selectedId != null) net.queryPerms(selectedId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, netStatus])

  // —— 性能档变化：落到本地与镜像两个模拟（渲染端行为，不进服务器） ——
  useEffect(() => {
    localSim.config.perfTier = prefs.perfTier
    net.mirror.config.perfTier = prefs.perfTier
  }, [prefs.perfTier, localSim, net])

  // —— 挂载时拉一次存档列表 ——
  useEffect(() => {
    void refreshSaves()
  }, [refreshSaves])

  /** 找「我的飞船」：联机时按 owners 归属找自己的船（找不到退化任意一艘）；离线取第一艘 */
  const findMyShip = useCallback((): Body | undefined => {
    const s = activeSimRef.current
    if (onlineRef.current && net.you) {
      return (
        s.bodies.find((b) => b.kind === 'ship' && b.alive && net.owners.get(b.id) === net.you!.id) ??
        s.bodies.find((b) => b.kind === 'ship' && b.alive)
      )
    }
    return s.bodies.find((b) => b.kind === 'ship' && b.alive)
  }, [net])

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

      const on = onlineRef.current
      const sim = activeSimRef.current
      // 每帧把实测 FPS 喂给引擎的 auto 档位调节器（副作用收在循环里，render 体保持纯净）
      sim.resolvePerf(fpsRef.current)
      future.leadTargetSec = prefsRef.current.leadSeconds
      future.rateMax = sim.perf.prebufferRate

      // —— 飞船推进器输入（键盘 + 触屏摇杆），在积分前写入油门/方向 ——
      const ship = findMyShip()
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
        thrustChanged = newThrust !== lastThrottleRef.current
        if (thrustChanged && !on) future.invalidate() // 离线：推力变化 → 预演缓冲分叉
        lastThrottleRef.current = newThrust
        ship.thrust = newThrust
        if (m > 0) {
          ship.thrustX = tx / m
          ship.thrustY = ty / m
        }
      }

      // —— 物理推进：在线 = 镜像补算（权威帧纠偏）；离线 = 预演缓冲驱动 ——
      if (on) {
        net.tick(dt, camRef.current.zoom)
        // 推力/方向变化 → 发给服务器（镜像本地也写上，尾焰立即响应）
        const dxn = m > 0 ? tx / m : 0
        const dyn = m > 0 ? ty / m : 0
        const dirChanged = dxn !== lastThrustDirRef.current.x || dyn !== lastThrustDirRef.current.y
        if (thrustChanged || (newThrust > 0 && dirChanged)) {
          lastThrustDirRef.current = { x: dxn, y: dyn }
          net.send({ type: 'thrust', throttle: newThrust, x: dxn, y: dyn })
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
      const on = onlineRef.current
      const sim = activeSimRef.current
      const stars = sim.bodies.reduce((acc, b) => acc + (b.kind === 'star' || b.kind === 'blackhole' ? 1 : 0), 0)
      setStats({
        bodies: sim.bodies.length,
        stars,
        fps: Math.round(fpsRef.current),
        simTime: on ? net.simTime : sim.simTime,
        merges: on ? net.merges : sim.merges,
        totalMass: on ? net.totalMass : sim.totalMass,
      })
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
      const ship = findMyShip()
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
  }, [net, future, findMyShip])

  // —— 暂停切换（空格与底部按钮共用） ——
  const togglePause = useCallback(() => {
    if (onlineRef.current) {
      // MC 语义：有主房里暂停是房主特权；大厅（无主）人人可通过投票暂停
      if (net.hostId != null && !net.isHost) {
        showSaveMsg('联机房间中暂停由房主控制')
        return
      }
      // 联机：暂停状态在服务器上，本地乐观翻转
      const next = !net.paused
      net.paused = next
      net.send({ type: 'pause', paused: next })
    } else {
      localSim.config.paused = !localSim.config.paused
    }
    rerender()
  }, [net, localSim, rerender, showSaveMsg])

  // —— 键盘快捷键 ——
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      keysRef.current.add(e.code)
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault()
      if (e.code === 'Space') {
        e.preventDefault()
        togglePause()
      } else if (e.key === 't' || e.key === 'T') {
        // 轨迹是纯本地渲染层行为：本地与镜像两个配置都写，保持同步
        localSim.config.trails = !localSim.config.trails
        net.mirror.config.trails = localSim.config.trails
        rerender()
      } else if (e.key === 'Escape') {
        setSelectedId(null)
        setFollow(false)
        spawnPreviewRef.current = null
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedRef.current != null) {
        if (onlineRef.current) {
          net.send({ type: 'remove', id: selectedRef.current })
        } else {
          localSim.removeBody(selectedRef.current)
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
  }, [net, localSim, future, rerender, togglePause])

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
        const gb = sim.bodies.find((x) => x.id === g.id)
        if (online) {
          // 取消抓取：放回/还原速度；镜像天体解除 held（对账恢复接管）
          if (gb) gb.held = false
          if (!g.armed) net.send({ type: 'release', id: g.id, vx: g.origVx, vy: g.origVy })
        } else {
          if (gb && !g.armed) {
            gb.held = false
            gb.x = g.origX
            gb.y = g.origY
            gb.vx = g.origVx
            gb.vy = g.origVy
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
        if (online) {
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
      if (online) {
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
      // 飞船部署：先算自动圆轨道初速度；联机时服务器负责退役旧船/发新船
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
        if (online) {
          net.send({ type: 'spawn', kind: 'ship', x: sp.sx, y: sp.sy, vx: svx, vy: svy, mass: 0.001 })
          setSelectedId(null)
        } else {
          // 全场唯一：先退役旧飞船
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
      // 拖拽位移（屏幕像素）：拉了明显一段虚线就用拖拽速度——拖拽意图优先于自动圆轨道
      const dragPx = Math.hypot(w.x - sp.sx, w.y - sp.sy) * camRef.current.zoom
      const dragged = dragPx > 12
      if (cfg.autoOrbit && !dragged) {
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
        }
        // 无主星（空白宇宙）且无拖拽：静止放置
      }
      // 真实比例场景：生成物带视觉放大倍率，保持与场景内天体同一比例
      const useBoost = unitsRef.current != null
      const kind = kindForMass(cfg.mass) // 类型由质量唯一决定（滑杆状态只是 UI 缓存）
      const visBoost = useBoost ? (kind === 'star' ? 15 : 8) : undefined
      if (online) {
        net.send({ type: 'spawn', kind, x: sp.sx, y: sp.sy, vx, vy, mass: cfg.mass, visBoost })
        return
      }
      const body = sim.addBody({
        kind,
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
      if (online) {
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
      const { perfTier, timeScale, ...rest } = patch
      // 性能档是渲染端行为：记入 prefs，由 effect 落到本地与镜像两个模拟
      if (perfTier != null) onPrefs({ perfTier })
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
        baseTimeScaleRef.current = timeScale
        if (onlineRef.current) {
          net.send({ type: 'config', patch: { timeScale: timeScale * warpRef.current } })
        } else {
          localSim.config.timeScale = timeScale * warpRef.current
          future.invalidate() // 流速变了，按旧流速推的缓冲未来作废
        }
      }
      rerender()
    },
    [net, localSim, future, rerender, onPrefs],
  )

  const applyWarp = useCallback(
    (w: number) => {
      warpRef.current = w
      setWarp(w)
      if (onlineRef.current) {
        net.send({ type: 'config', patch: { timeScale: baseTimeScaleRef.current * w } })
      } else {
        localSim.config.timeScale = baseTimeScaleRef.current * w
        future.invalidate() // 流速变了，按旧流速推的缓冲未来作废
      }
      rerender()
    },
    [net, localSim, future, rerender],
  )

  const applyPreset = useCallback(
    (id: PresetId) => {
      userTouchedRef.current = true
      if (onlineRef.current) {
        if (net.hostId != null && !net.isHost) {
          showSaveMsg('联机房间中仅房主可切换预设')
          return
        }
        // 联机：预设切换发给服务器；zoom/单位换算用一次性探针本地算出（与服务器端同一套预设表）
        net.send({ type: 'preset', id })
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
      const { zoom, units: u } = loadPreset(localSim, id)
      camRef.current = { x: 0, y: 0, zoom }
      baseTimeScaleRef.current = localSim.config.timeScale
      unitsRef.current = u
      setUnits(u)
      setCurrentPreset(id)
      setSelectedId(null)
      setFollow(false)
      future.fork(localSim)
      saveAutosave()
      rerender()
    },
    [net, localSim, future, rerender, saveAutosave, showSaveMsg],
  )

  const doRewind = useCallback(() => {
    if (onlineRef.current) {
      if (net.hostId != null && !net.isHost) {
        showSaveMsg('联机房间中回退由房主执行')
        return
      }
      net.send({ type: 'rewind' })
      return
    }
    if (localSim.rewind() != null) {
      setSelectedId(null)
      setFollow(false)
      future.invalidate() // 回退后未来全部作废，从新状态重算
      rerender()
    }
  }, [net, localSim, future, rerender, showSaveMsg])

  const onClear = useCallback(() => {
    if (onlineRef.current) {
      if (net.hostId != null && !net.isHost) {
        showSaveMsg('联机房间中清空由房主执行')
        return
      }
      net.send({ type: 'clear' })
    } else {
      localSim.reset()
      future.invalidate()
      saveAutosave()
    }
    unitsRef.current = undefined
    setUnits(undefined)
    setCurrentPreset('empty')
    setSelectedId(null)
    setFollow(false)
  }, [net, localSim, future, saveAutosave, showSaveMsg])

  const onSpawnSettings = useCallback((patch: Partial<SpawnSettings>) => {
    setSpawnCfg((s) => ({ ...s, ...patch }))
  }, [])

  // 部署飞船：进入放置模式（飞船不参与质量滑杆，全场唯一）
  const deployShip = useCallback(() => {
    setSpawnCfg((s) => ({ ...s, kind: 'ship' }))
    setMode('spawn')
  }, [])

  // —— 存档 ——
  const onSaveCurrent = async () => {
    try {
      const state = onlineRef.current ? await net.requestState() : localSim.serialize(currentPreset)
      if (!onlineRef.current) state.camera = { ...camRef.current }
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

  const onHostLan = async () => {
    if (!onlineRef.current) {
      showSaveMsg('离线状态无法开放，请先连接服务器（主菜单 · 多人游戏）')
      return
    }
    try {
      const state = await net.requestState()
      net.hostSave(state)
    } catch (e) {
      showSaveMsg(`开放失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // —— MC 式主菜单流程 ——
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
      setUnits(u)
      setCurrentPreset(id)
      setSelectedId(null)
      setFollow(false)
      future.fork(localSim)
      saveAutosave()
      setScreen('game')
      rerender()
    },
    [net, localSim, future, rerender, saveAutosave],
  )

  /** 从主菜单进入多人游戏：连接服务器（房号留空 = 公共大厅），进游戏后由房间呈现 */
  const joinMultiplayer = useCallback(
    (roomCode: string) => {
      onPrefs({ roomCode })
      net.pendingRoom = roomCode
      netDesiredRef.current = true
      net.connect()
      setScreen('game')
    },
    [net, onPrefs],
  )

  /** 游戏菜单：保存并退出到主菜单。联机时把房间宇宙回收进自己的自动存档（MC：世界跟着人走） */
  const exitToMenu = useCallback(async () => {
    try {
      if (onlineRef.current) {
        const state = await net.requestState()
        state.camera = { ...camRef.current }
        await putAutosave(state)
        setAutosaveInfo({ savedAt: Date.now(), bodies: state.bodies.length, preset: state.preset })
      } else {
        saveAutosave()
      }
    } catch {
      /* 保存失败也照样退出 */
    }
    if (onlineRef.current) {
      if (net.isHost) {
        net.closeRoom() // 房主：房随人走，客人收到 roomClosed
      } else {
        netDesiredRef.current = false
        net.disconnect()
      }
    }
    setMenuOpen(false)
    setScreen('menu')
    rerender()
  }, [net, saveAutosave, rerender])

  /** 主菜单：载入本地世界（强制离线进入；联机中先断开） */
  const loadSaveFromMenu = useCallback(
    async (id: string) => {
      userTouchedRef.current = true
      try {
        const rec = await getSave(id)
        if (!rec) {
          showSaveMsg('存档不存在')
          return
        }
        if (onlineRef.current) {
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
          setUnits(u)
          setCurrentPreset(pid as PresetId)
        } else {
          camRef.current = rec.state.camera ?? { x: 0, y: 0, zoom: 1 }
          unitsRef.current = undefined
          setUnits(undefined)
          setCurrentPreset('empty')
        }
        setSelectedId(null)
        setFollow(false)
        future.invalidate()
        saveAutosave()
        setScreen('game')
        rerender()
      } catch (e) {
        showSaveMsg(`载入失败：${e instanceof Error ? e.message : String(e)}`)
      }
    },
    [net, localSim, future, rerender, saveAutosave, showSaveMsg],
  )

  // stats 每 400ms 刷新一次：天体对象是原地突变的，靠它驱动 selected 重取
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const selected = useMemo(() => sim.bodies.find((b) => b.id === selectedId) ?? null, [sim, selectedId, stats])

  const hintText =
    mode === 'spawn'
      ? spawnCfg.kind === 'ship'
        ? '点击画布部署飞船（自动进入环绕轨道）· ESC 取消'
        : '点击放置（自动圆轨道开启时获得环绕速度）· 按住拖拽拉虚线定初速度 · ESC 取消'
      : '拖动天体移动 / 甩出 · 拖动空白平移 · 滚轮缩放 · 空格暂停'

  const paused = online ? net.paused : localSim.config.paused
  // 性能徽标：auto 档显示当前实际生效档位（与 PERF_TIERS 对象做 identity 比较）
  const effectiveTier =
    (Object.keys(PERF_TIERS) as PerfTier[]).find((t) => PERF_TIERS[t] === sim.perf) ?? 'balanced'
  const perfLabel =
    sim.config.perfTier === 'auto' ? `自动·${TIER_LABEL[effectiveTier]}` : TIER_LABEL[sim.config.perfTier as PerfTier]

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

      {/* 左上：HUD（收起面板的把手长在停靠栏标题行里） */}
      {screen === 'game' && (
        <>
      <div className="pointer-events-none absolute left-3 top-3 z-10 origin-top-left scale-[0.72] sm:left-5 sm:top-5 sm:scale-100">
        <StatsBar stats={stats} zoom={camRef.current.zoom} running={!paused} units={units} />
      </div>

      {/* 右上：菜单按钮 + 连接/性能徽标 */}
      <div className="absolute right-3 top-3 z-10 flex flex-col items-end gap-2 sm:right-5 sm:top-5">
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="glass pointer-events-auto rounded-md px-3 py-1.5 font-mono text-[10px] tracking-[0.2em] text-[#5b6b8c] transition-colors hover:text-[#dbe4f3]"
        >
          {menuOpen ? '关闭菜单 ×' : '☰ 菜单'}
        </button>
        <div className="glass pointer-events-none rounded-md px-2 py-1 font-mono text-[9px]">
          {online ? (
            <span className="text-[#34d399]">联机 · {net.room === 'lobby' ? '公共大厅' : `房间 ${net.room}`}</span>
          ) : netStatus === 'connecting' ? (
            <span className="text-[#fbbf24]">连接中…</span>
          ) : (
            <span className="text-[#f87171]">离线 · 单机模式</span>
          )}
        </div>
        <div className="glass pointer-events-none rounded-md px-2 py-1 font-mono text-[9px] text-[#5b6b8c]">
          性能 <span className="text-[#22d3ee]">{perfLabel}</span>
        </div>
      </div>

      {/* 左侧：停靠栏（场景/创建/飞船/存档/联机/设置） */}
      {dockOpen ? (
        <div className="absolute left-3 top-[136px] z-10 sm:left-5">
          <Dock
            config={sim.config}
            onConfig={onConfig}
            mode={mode}
            onMode={setMode}
            spawn={spawnCfg}
            onSpawn={onSpawnSettings}
            currentPreset={currentPreset}
            onPreset={applyPreset}
            onResetScene={() => applyPreset(currentPreset)}
            onClear={onClear}
            hasShip={sim.bodies.some((b) => b.kind === 'ship' && b.alive)}
            onDeployShip={deployShip}
            prefs={prefs}
            onPrefs={onPrefs}
            net={{
              status: netStatus,
              online,
              room: net.room,
              players: net.players,
              youId: net.you?.id,
              hostName: net.hostId != null ? net.players.find((pl) => pl.id === net.hostId)?.name ?? null : null,
              isHost: net.isHost,
            }}
            onReconnect={connectNet}
            onCloseRoom={() => net.closeRoom()}
            onCollapse={() => setDockOpen(false)}
          />
        </div>
      ) : (
        <button
          onClick={() => setDockOpen(true)}
          className="glass pointer-events-auto absolute left-3 top-[136px] z-10 rounded-md px-3 py-1.5 font-mono text-[10px] tracking-[0.2em] text-[#5b6b8c] transition-colors hover:text-[#dbe4f3] sm:left-5"
        >
          ☰ 控制面板 +
        </button>
      )}

      {/* 底部居中：时间控制条（回退 / 暂停 / 倍率 / T+ 读数） */}
      <div className="glass pointer-events-auto absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-md px-2 py-1">
        <button
          onClick={doRewind}
          disabled={!online && localSim.snapshotCount === 0}
          title="回退到上一个时间点（约每1.5秒一帧快照）"
          className="rounded px-2 py-1 font-mono text-[10px] text-[#5b6b8c] transition-colors hover:text-[#dbe4f3] disabled:opacity-30"
        >
          ⏪ 回退
        </button>
        <div className="h-3.5 w-px bg-[#1a2540]" />
        <button
          onClick={togglePause}
          title="空格键"
          className={`rounded px-2 py-1 font-mono text-[10px] transition-colors ${
            paused ? 'text-[#fbbf24] hover:text-[#fde68a]' : 'text-[#5b6b8c] hover:text-[#dbe4f3]'
          }`}
        >
          {paused ? '▶ 继续' : '❚❚ 暂停'}
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
        <span className="px-2 font-mono text-[10px] text-[#5b6b8c]" title="模拟时间">
          T+ <span className="text-[#dbe4f3]">{fmtSimTime(stats.simTime, units)}</span>
        </span>
      </div>

      {/* 底部：操作提示（时间条上方） */}
      <div className="pointer-events-none absolute bottom-16 left-1/2 z-10 hidden -translate-x-1/2 sm:block">
        <div className="glass rounded-md px-5 py-1.5 font-mono text-[10.5px] tracking-wider text-[#5b6b8c]">
          {hintText}
        </div>
      </div>

      {/* 联机投票横幅 */}
      {online && net.vote && (
        <div className="glass mg-fadeup pointer-events-auto absolute left-1/2 top-14 z-30 w-[min(340px,86vw)] -translate-x-1/2 rounded-lg p-3">
          <div className="flex items-center justify-between">
            <div className="text-[12px] text-[#dbe4f3]">
              {net.vote.initiator} 发起：
              {{ pause: net.vote.paused === false ? '恢复运行' : '暂停', rewind: '回退时间', clear: '清空宇宙', preset: `切换预设` }[net.vote.action]}
              {net.vote.action === 'preset' && net.vote.preset ? `「${net.vote.preset}」` : ''}
            </div>
            <div className="font-mono text-[10px] text-[#5b6b8c]">{net.vote.ttl}s</div>
          </div>
          <div className="mt-1.5 h-1 overflow-hidden rounded bg-[#1a2540]">
            <div
              className="h-full bg-[#34d399] transition-all"
              style={{ width: `${Math.min(100, (net.vote.yes / Math.max(net.vote.total, 1)) * 100)}%` }}
            />
          </div>
          <div className="mt-1 font-mono text-[9px] text-[#5b6b8c]">
            同意 {net.vote.yes} / 反对 {net.vote.no} / 共 {net.vote.total} 人 · 过半同意即执行
          </div>
          <div className="mt-2 flex gap-1.5">
            <button
              onClick={() => net.castVote(true)}
              className="flex-1 rounded border border-[#34d399]/40 bg-[#34d399]/10 px-2 py-1 text-[11px] text-[#34d399] hover:bg-[#34d399]/20"
            >
              同意
            </button>
            <button
              onClick={() => net.castVote(false)}
              className="flex-1 rounded border border-[#f87171]/40 bg-[#f87171]/10 px-2 py-1 text-[11px] text-[#f87171] hover:bg-[#f87171]/20"
            >
              反对
            </button>
          </div>
        </div>
      )}

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

      {/* 左下：飞船控制台遥测；触屏固定摇杆在左侧时抬高避开 */}
      {shipTel && (
        <div
          className={`absolute z-10 ${
            isTouch && prefs.joyMode === 'fixed' && prefs.joySide === 'left' ? 'bottom-56 left-3' : 'bottom-4 left-3 sm:left-5'
          }`}
        >
          <ShipTelemetry tel={shipTel} units={units} isTouch={isTouch} />
        </div>
      )}

      {/* 右下：选中天体信息卡 */}
      {selected && (
        <div className="absolute bottom-4 right-3 z-10 sm:bottom-6 sm:right-5">
          <SelectedCard
            selected={selected}
            orbit={selOrbit}
            units={units}
            follow={follow}
            onToggleFollow={() => setFollow(!follow)}
            onDelete={() => {
              if (onlineRef.current) {
                net.send({ type: 'remove', id: selected.id })
              } else {
                localSim.removeBody(selected.id)
                future.invalidate()
              }
              setSelectedId(null)
            }}
            net={online ? net : null}
          />
        </div>
      )}
        </>
      )}

      {/* 游戏内菜单按钮展开的覆盖层（Esc 不劫持，专按钮入口） */}
      {screen === 'game' && menuOpen && (
        <GameMenu
          online={online}
          isHost={net.isHost}
          room={net.room}
          saveMsg={saveMsg}
          onResume={() => setMenuOpen(false)}
          onSave={() => void onSaveCurrent()}
          onHostLan={() => void onHostLan()}
          onExitToMenu={() => void exitToMenu()}
        />
      )}

      {/* MC 风格主菜单：世界（存档）是一级入口 */}
      {screen === 'menu' && (
        <MainMenu
          autosave={autosaveInfo}
          saves={saves}
          onContinue={() => setScreen('game')}
          onNewWorld={startLocalWorld}
          onLoadSave={(id) => void loadSaveFromMenu(id)}
          onDeleteSave={(id) => void onDeleteSave(id)}
          onExportSave={(id) => void onExportSave(id)}
          onImportSave={() => void onImportSave()}
          onJoinMultiplayer={joinMultiplayer}
        />
      )}

      {/* 存档/开房等操作的浮动提示 */}
      {screen === 'game' && !menuOpen && saveMsg && (
        <div className="pointer-events-none absolute bottom-16 left-1/2 z-30 -translate-x-1/2">
          <div className="glass mg-fadeup rounded-md px-4 py-1.5 font-mono text-[11px] text-[#34d399]">{saveMsg}</div>
        </div>
      )}
    </div>
  )
}
