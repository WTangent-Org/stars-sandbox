import type { Body, BodyKind, Effect, SimConfig, TrailPoint, PerfConfig, WorldState } from './types'
import { COLLISION, LIFECYCLE, BLACKHOLE, TRAIL, SNAPSHOTS } from './config'
import { PERF_TIERS } from './types'

/** 飞船推进器加速度（模拟单位/时间²），随油门缩放。
 *  取相对温和的 0.35：顺行推半圈抬轨、逆行减轨都有操作余量，不会一脚冲出轨道。 */
export const SHIP_THRUST = 0.35

const GREEK = ['α', 'β', 'γ', 'δ', 'ε', 'ζ', 'η', 'θ', 'ι', 'κ', 'λ', 'μ', 'ν', 'ξ', 'ο', 'π', 'ρ', 'σ', 'τ', 'υ']

const PLANET_COLORS: Array<[string, string]> = [
  ['#e8b06f', 'rgba(232,176,111,0.35)'],
  ['#c97e5a', 'rgba(201,126,90,0.35)'],
  ['#7fb5d9', 'rgba(127,181,217,0.35)'],
  ['#9dc88f', 'rgba(157,200,143,0.35)'],
  ['#d9c27f', 'rgba(217,194,127,0.35)'],
  ['#b093d6', 'rgba(176,147,214,0.4)'],
]

/** 恒星外观：按真实质量分段（单位 10^27 kg，1 太阳质量 ≈ 1989）。
 *  红矮星 < 0.4 M☉；黄矮星（类日）< 2 M☉；蓝白巨星 < 8 M☉；更大的是超巨星 */
export function starAppearance(mass: number): { color: string; glow: string } {
  if (mass < 800) return { color: '#ff7a4e', glow: 'rgba(255,110,60,0.55)' } // 红矮星
  if (mass < 4000) return { color: '#ffe9b8', glow: 'rgba(255,225,160,0.6)' } // 类日
  if (mass < 16000) return { color: '#cfe0ff', glow: 'rgba(160,195,255,0.65)' } // 蓝白巨星
  return { color: '#b8c9ff', glow: 'rgba(140,170,255,0.7)' } // 超巨星
}

// ———— 质量段：类型由质量唯一决定（创建 UI 与并合升级共用同一张表） ————
export const MASS_BANDS: Array<{ min: number; kind: Exclude<BodyKind, 'ship'>; label: string; desc: string }> = [
  { min: 0, kind: 'asteroid', label: '小行星', desc: '碎石堆 · 撞出碎片而非并合' },
  { min: 0.1, kind: 'moon', label: '卫星', desc: '类月世界 · 可被行星捕获' },
  { min: 10, kind: 'planet', label: '行星', desc: '岩石/气态巨行星 · 越过点燃线成为恒星' },
  { min: 24000, kind: 'star', label: '恒星', desc: '红矮→类日→蓝白巨星→超巨星，靠吞并与岁月演化' },
  { min: 500000, kind: 'blackhole', label: '黑洞', desc: '超大质量黑洞 · 视界内无物幸存' },
]

/** 质量对应的类型（飞船除外）。并合升级行星/卫星/小行星时用它重新定级 */
export function kindForMass(mass: number): Exclude<BodyKind, 'ship'> {
  let kind: Exclude<BodyKind, 'ship'> = 'asteroid'
  for (const b of MASS_BANDS) if (mass >= b.min) kind = b.kind
  return kind
}

/** 恒星生命周期（基于真实质量，单位 10^27 kg）。
 *  演化由「吞并 + 岁月」共同驱动：吞并直接累计 absorbed；恒星还按质量三次方
 *  的速率随模拟时间自然衰老（大质量恒星寿命短，真实规律），时间倍率可加速观看。
 *  < 40 M☉（~80000）：主序星 →（膨胀）→ 红巨星 → 白矮星
 *  ≥ 40 M☉：主序星 → 超巨星 →（超新星）→ 黑洞 */
export interface StarStage {
  stage: 'main' | 'giant' | 'whitedwarf' | 'neutron' | 'blackhole'
  radiusFactor: number
  color: string
  glow: string
}
const SUPERNOVA_MASS = LIFECYCLE.supernovaMass
/** 岁月演化速率：80000 质量的恒星约 30 秒真实时间进入红巨星（×100 倍率下半分钟） */
const AGE_RATE = LIFECYCLE.ageRate
export function starEvolutionRate(mass: number): number {
  return AGE_RATE * Math.pow(mass / SUPERNOVA_MASS, 3)
}
export function starStageFor(mass: number, absorbed: number): StarStage {
  if (mass < SUPERNOVA_MASS) {
    if (absorbed > LIFECYCLE.whiteDwarfAt * mass) return { stage: 'whitedwarf', radiusFactor: 0.04, color: '#e8f4ff', glow: 'rgba(210,235,255,0.5)' }
    if (absorbed > LIFECYCLE.giantAt * mass) return { stage: 'giant', radiusFactor: 3.4, color: '#ff8f5e', glow: 'rgba(255,130,80,0.65)' }
    return { stage: 'main', radiusFactor: 1, color: starAppearance(mass).color, glow: starAppearance(mass).glow }
  }
  if (absorbed > LIFECYCLE.massiveCollapseAt * mass) return { stage: 'blackhole', radiusFactor: 0.25, color: '#05030c', glow: 'rgba(164,144,194,0.85)' }
  if (absorbed > LIFECYCLE.massiveGiantAt * mass) return { stage: 'giant', radiusFactor: 2.2, color: '#ffb08a', glow: 'rgba(255,170,120,0.65)' }
  return { stage: 'main', radiusFactor: 1, color: starAppearance(mass).color, glow: starAppearance(mass).glow }
}

export function radiusFor(kind: BodyKind, mass: number): number {
  const m = Math.max(mass, 1e-4)
  switch (kind) {
    // 恒星：R ∝ M^0.35（高质量恒星辐射压撑起更蓬松的包层，密度随质量下降）
    case 'star':
      return 1.7 + 1.05 * Math.pow(m, 0.35)
    // 黑洞：史瓦西半径 r_s ∝ M（线性增长），常数压扁到视觉可用范围
    case 'blackhole':
      return 2.2 + Math.cbrt(m) * 0.16
    // 行星：气态巨星被电子简并压支撑，半径几乎不随质量增长（木星≈土星），
    // 岩石行星 R ∝ M^0.27——综合成缓增 + 上限：再大也不会比恒星还夸张
    case 'planet':
      return Math.min(0.75 + 1.55 * Math.pow(m, 0.22), 6.0)
    // 卫星/小行星：岩石天体 R ∝ M^0.27（恒定密度是 M^(1/3)，岩石略压实）
    case 'moon':
      return 0.4 + 0.75 * Math.pow(m, 0.27)
    case 'ship':
      return 0.35
    default:
      return 0.3 + 0.6 * Math.pow(m, 0.27)
  }
}

export class Simulation {
  bodies: Body[] = []
  effects: Effect[] = []
  simTime = 0
  merges = 0
  /** 镜像模式（客户端补算）：只积分引力/推进/轨迹，碰撞、视界捕获、生命周期与
   *  特效全部由服务器权威帧裁决，本地不判定（避免与权威状态分歧） */
  mirror = false
  /** 时间回退：周期快照（浅拷贝天体数组 + 深拷贝各天体轨迹头尾信息） */
  private snapshots: Array<{ simTime: number; merges: number; bodies: Array<Partial<Body> & { trail: TrailPoint[] }> }> = []
  private snapTimer = 0
  /** 元数据变脏的天体 id：并合升级/超新星等原地改了 name/color/glow/kind，
   *  二进制帧不带这些字段，服务器要靠它补发 manifest（否则客户端显示旧外观） */
  readonly dirtyMeta = new Set<number>()
  config: SimConfig = {
    G: 1,
    timeScale: 30,
    softening: 3,
    trails: true,
    trailsForever: false,
    relativity: true,
    paused: false,
    perfTier: 'auto',
  }
  /** 当前生效的性能参数（resolvePerf 填充） */
  perf: PerfConfig = PERF_TIERS.balanced
  /** auto 模式：根据 FPS 自动升降档 */
  private perfAuto: { fps: number; tier: 'ultra' | 'high' | 'balanced' | 'low' | 'saver'; stable: number } = {
    fps: 60,
    tier: 'balanced',
    stable: 0,
  }

  /** 解析当前性能档位（auto 时根据 FPS 调节；自动档上限为「高」——
   *  「极致」是手动专属档，避免普通设备被自动分配到过重负载） */
  resolvePerf(fps: number) {
    if (this.config.perfTier !== 'auto') {
      this.perf = PERF_TIERS[this.config.perfTier]
      return
    }
    // 指数平滑 FPS
    this.perfAuto.fps = this.perfAuto.fps * 0.9 + fps * 0.1
    const tiers: Array<'high' | 'balanced' | 'low' | 'saver'> = ['saver', 'low', 'balanced', 'high']
    const idx = tiers.indexOf(this.perfAuto.tier === 'ultra' ? 'high' : this.perfAuto.tier)
    const fpsNow = this.perfAuto.fps
    // 升档：FPS > 50 且稳定 60 帧
    if (fpsNow > 50 && idx < tiers.length - 1) {
      this.perfAuto.stable++
      if (this.perfAuto.stable > 60) {
        this.perfAuto.tier = tiers[idx + 1]
        this.perfAuto.stable = 0
      }
    } else if (fpsNow < 30 && idx > 0) {
      // 降档：FPS < 30 立即降
      this.perfAuto.tier = tiers[idx - 1]
      this.perfAuto.stable = 0
    } else {
      this.perfAuto.stable = 0
    }
    this.perf = PERF_TIERS[this.perfAuto.tier]
  }

  private nextId = 1
  private counters: Record<BodyKind, number> = { star: 0, planet: 0, moon: 0, asteroid: 0, blackhole: 0, ship: 0 }

  reset() {
    this.bodies = []
    this.effects = []
    this.snapshots = []
    this.snapTimer = 0
    this.simTime = 0
    this.merges = 0
    this.nextId = 1
    this.counters = { star: 0, planet: 0, moon: 0, asteroid: 0, blackhole: 0, ship: 0 }
  }

  private makeName(kind: BodyKind): string {
    const n = ++this.counters[kind]
    switch (kind) {
      case 'star':
        return `恒星 ${GREEK[(n - 1) % GREEK.length]}-${Math.ceil(n / GREEK.length) || 1}`
      case 'blackhole':
        return `黑洞 Ω-${n}`
      case 'planet':
        return `行星 P-${n}`
      case 'moon':
        return `卫星 M-${n}`
      case 'ship':
        return `飞船 S-${n}`
      default:
        return `小行星 A-${n}`
    }
  }

  addBody(partial: {
    kind: BodyKind
    x: number
    y: number
    vx?: number
    vy?: number
    mass: number
    name?: string
    color?: string
    glow?: string
    radius?: number
    visBoost?: number
    solid?: boolean
    trail?: boolean
    /** 显式指定 id（联机镜像对账用：天体 id 必须与服务器一致，否则每帧被当未知体删除重建） */
    id?: number
  }): Body {
    let color = partial.color
    let glow = partial.glow
    if (!color || !glow) {
      if (partial.kind === 'star') {
        const a = starAppearance(partial.mass)
        color = a.color
        glow = a.glow
      } else if (partial.kind === 'blackhole') {
        color = '#05030c'
        glow = 'rgba(164,144,194,0.85)'
      } else if (partial.kind === 'planet') {
        const p = PLANET_COLORS[(this.counters.planet + PLANET_COLORS.length - 1) % PLANET_COLORS.length]
        color = p[0]
        glow = p[1]
      } else if (partial.kind === 'moon') {
        color = '#c9c4bd'
        glow = 'rgba(201,196,189,0.3)'
      } else if (partial.kind === 'ship') {
        color = '#e6e6fa'
        glow = 'rgba(164,224,255,0.55)'
      } else {
        color = '#9a8f85'
        glow = 'rgba(154,143,133,0.3)'
      }
    }
    const body: Body = {
      id: partial.id ?? this.nextId++,
      thrust: 0,
      thrustX: 0,
      thrustY: 1,
      name: partial.name ?? this.makeName(partial.kind),
      kind: partial.kind,
      x: partial.x,
      y: partial.y,
      vx: partial.vx ?? 0,
      vy: partial.vy ?? 0,
      ax: 0,
      ay: 0,
      mass: partial.mass,
      radius: partial.radius ?? radiusFor(partial.kind, partial.mass),
      visBoost: partial.visBoost,
      absorbed: 0,
      lifeStage: partial.kind === 'star' ? 'main' : partial.kind === 'blackhole' ? 'blackhole' : undefined,
      color,
      glow,
      solid: partial.solid ?? true,
      trail: [],
      alive: true,
    }
    // 显式 id（镜像对账）也不得与自增序列冲突：后续本地生成天体要绕开它
    if (body.id >= this.nextId) this.nextId = body.id + 1
    this.bodies.push(body)
    return body
  }

  removeBody(id: number) {
    this.bodies = this.bodies.filter((b) => b.id !== id)
  }

  /** 引力主导者：对某点引力最强的天体（用于自动圆轨道计算） */
  dominantAt(x: number, y: number, excludeId?: number): Body | null {
    let best: Body | null = null
    let bestA = 0
    for (const b of this.bodies) {
      if (b.id === excludeId) continue
      const dx = b.x - x
      const dy = b.y - y
      const a = b.mass / (dx * dx + dy * dy + 1)
      if (a > bestA) {
        bestA = a
        best = b
      }
    }
    return best
  }

  /** 有质量的主导者（跳过卫星/小行星/飞船）：用于飞船轨道与自动圆轨道，
   *  防止飞船掠过月球时"轨道面板"被月球抢走 */
  dominantMassive(x: number, y: number, excludeId?: number): Body | null {
    let best: Body | null = null
    let bestA = 0
    for (const b of this.bodies) {
      if (b.id === excludeId) continue
      if (b.kind === 'moon' || b.kind === 'asteroid' || b.kind === 'ship') continue
      const dx = b.x - x
      const dy = b.y - y
      const a = b.mass / (dx * dx + dy * dy + 1)
      if (a > bestA) {
        bestA = a
        best = b
      }
    }
    return best
  }

  step(frameDt: number, zoom = 1) {
    const { paused } = this.config
    if (!paused) {
      this.advance(frameDt, zoom)
      // 每 1.5 秒真实时间存一帧快照，供时间回退；最多保留 160 帧（镜像不回退，免存）
      if (!this.mirror) {
        this.snapTimer += frameDt
        if (this.snapTimer >= SNAPSHOTS.interval) {
          this.snapTimer = 0
          this.saveSnapshot()
        }
      }
    } else {
      // 暂停时物理不走，但闪光等特效仍按真实时间衰减
      this.ageEffects(frameDt)
    }
  }

  private ageEffects(dt: number) {
    for (const e of this.effects) e.age += dt
    this.effects = this.effects.filter((e) => e.age < e.ttl)
  }

  /** 纯物理步进（无快照/特效计时）——预演缓冲分叉出的影子模拟用它往前赶 */
  advance(frameDt: number, zoom = 1) {
    // 特效老化放在 advance：离线主循环走 advance/预演缓冲，放 step 里会让特效永远不过期
    this.ageEffects(frameDt)
    const { timeScale } = this.config
    const total = frameDt * timeScale
    // 岁月演化：恒星随模拟时间自然衰老（质量三次方速率，大质量恒星寿命短），
    // 吞并与时间双驱动——只吃小碎块的恒星也能肉眼看到膨胀→塌缩的全过程
    if (!this.mirror) {
      for (const b of this.bodies) {
        if (b.kind !== 'star') continue
        b.absorbed = (b.absorbed ?? 0) + b.mass * starEvolutionRate(b.mass) * total
        this.applyStarStage(b)
      }
    }
    // 碎片冷却按帧衰减（不是按子步）：子步数随时间倍率变化，按子步衰减会让冷却名存实亡
    for (const b of this.bodies) if ((b.cooldown ?? 0) > 0) b.cooldown = (b.cooldown ?? 0) - 1
    const n = this.bodies.length
    const perf = this.perf
    const base = n > 450 ? 2 : n > 150 ? 4 : 6
    const substeps = this.adaptiveSubsteps(total, base)
    const dt = total / substeps
    this.subDt = dt
    for (let s = 0; s < substeps; s++) {
      // 视界捕获在子步两端都检查：PW 势近视界发散，高速坠入者一个子步就能
      // 跨过视界再被甩飞——只查端点会两次都错过（数值虫洞）。镜像不判定，等权威帧。
      if (!this.mirror) this.captureHorizon()
      this.computeAccelerations()
      this.integrate(dt, zoom)
      if (!this.mirror) this.captureHorizon()
      this.collideCheck(true)
    }
    // 近黑洞护盾：PW 势近视界发散，任何天体贴到 1.5 r_s 内时按局部动力学时标
    // 追加细分子步，防止大步长直接跨过视界（跨过即捕获失败、被发散引力甩飞）
    if (!this.mirror) {
      let shieldDt = Infinity
      for (const bh of this.bodies) {
        if (bh.kind !== 'blackhole') continue
        for (const b of this.bodies) {
          if (b.kind === 'blackhole') continue
          const d = Math.hypot(b.x - bh.x, b.y - bh.y)
          if (d < bh.radius * BLACKHOLE.shieldZone && d > 1e-9) {
            const local = Math.sqrt((d * d * d) / (this.config.G * bh.mass)) / BLACKHOLE.shieldScale
            if (local < shieldDt) shieldDt = local
          }
        }
      }
      if (isFinite(shieldDt)) {
        const subDt = Math.max(Math.min(dt, shieldDt), 1e-7)
        const extra = Math.min(Math.ceil(dt / subDt), perf.bhShieldMax)
        this.subDt = dt / extra
        for (let s = 0; s < extra; s++) {
          this.captureHorizon()
          this.computeAccelerations()
          this.integrate(dt / extra, zoom)
          this.captureHorizon()
          this.collideCheck(true)
        }
      }
    }
    this.collideCheck(false)
    this.simTime += total
  }

  /** 子步级碰撞检查：高速天体一帧能跨过好几个身位，帧末才检查会穿透或错过真实撞击点。
   *  小场景（≤150 体）每个子步做一次；大场景 O(n²) 太贵，退回帧末一次。 */
  private collideCheck(perSubstep: boolean) {
    if (this.mirror) return
    const small = this.bodies.length <= 150
    if (perSubstep === small) this.resolveCollisions()
  }

  /** 深拷贝一个影子模拟（位置/速度/油门独立，预演分叉用）；不含快照与特效 */
  clone(): Simulation {
    const c = new Simulation()
    c.config = { ...this.config }
    c.perf = this.perf // 预演与观看必须同档：否则「极致」档的离线画面实际在跑均衡档
    c.simTime = this.simTime
    c.merges = this.merges
    c.nextId = this.nextId
    c.counters = { ...this.counters }
    c.bodies = this.bodies.map((b) => ({ ...b, trail: [] }))
    c.effects = []
    return c
  }

  /**
   * 自适应子步：估算系统中最紧密轨道（卫星绕宿主）的周期，
   * 保证每圈至少 ~150 个积分步，防止近距小轨道数值发散。
   */
  private adaptiveSubsteps(totalDt: number, base: number): number {
    const { G } = this.config
    let minT = Infinity
    for (const b of this.bodies) {
      if (b.kind !== 'moon') continue
      const host = this.dominantAt(b.x, b.y, b.id)
      if (!host) continue
      const dx = b.x - host.x
      const dy = b.y - host.y
      const r = Math.sqrt(dx * dx + dy * dy)
      if (r < 1e-9) continue
      const T = 2 * Math.PI * Math.sqrt((r * r * r) / (G * host.mass))
      if (T < minT) minT = T
    }
    if (!isFinite(minT)) return base
    const need = Math.ceil(totalDt / (minT / 150))
    // 子步上限按性能档位与场景规模分级
    const cap = this.bodies.length <= 60 ? this.perf.substepMax : this.perf.galaxySubstepMax
    return Math.min(Math.max(need, base), cap)
  }

  /** 保存当前状态快照（大星系场景跳过）。轨迹不进快照——量大且回退后会自然重建，
   *  服务器每个房间挂 160 份快照，带轨迹就是几十 MB */
  private saveSnapshot() {
    if (this.bodies.length > SNAPSHOTS.maxBodies) return
    this.snapshots.push({
      simTime: this.simTime,
      merges: this.merges,
      bodies: this.bodies.map((b) => ({
        ...b,
        trail: [] as TrailPoint[],
      })),
    })
    if (this.snapshots.length > SNAPSHOTS.max) this.snapshots.shift()
  }

  /** 回退到上一个快照点；返回回退到的模拟时间，失败返回 null */
  rewind(): number | null {
    const snap = this.snapshots.pop()
    if (!snap) return null
    this.restoreFrom(snap.bodies as Body[], snap.simTime, snap.merges)
    this.effects = []
    return snap.simTime
  }

  /** 从外部状态整体覆盖（回退快照、预演缓冲分叉回填共用） */
  restoreFrom(bodies: Body[], simTime: number, merges: number) {
    this.simTime = simTime
    this.merges = merges
    this.bodies = bodies
  }

  get snapshotCount(): number {
    return this.snapshots.length
  }

  /** 序列化整个世界（存档 / getstate 协议）。轨迹不存——量大且载入后会自然重建。 */
  serialize(preset?: string): WorldState {
    return {
      version: 1,
      preset,
      config: {
        G: this.config.G,
        timeScale: this.config.timeScale,
        softening: this.config.softening,
        trails: this.config.trails,
        trailsForever: this.config.trailsForever,
        paused: this.config.paused,
      },
      simTime: this.simTime,
      merges: this.merges,
      bodies: this.bodies.map((b) => ({
        id: b.id,
        name: b.name,
        kind: b.kind,
        x: b.x,
        y: b.y,
        vx: b.vx,
        vy: b.vy,
        mass: b.mass,
        radius: b.radius,
        visBoost: b.visBoost,
        color: b.color,
        glow: b.glow,
        solid: b.solid,
        spin: b.spin,
        absorbed: b.absorbed,
        lifeStage: b.lifeStage,
      })),
    }
  }

  /** 从 WorldState 重建整个宇宙（载入存档 / hostsave）。保留原天体 id（联机权限按 id 对齐）。 */
  restoreWorld(state: WorldState) {
    this.reset()
    Object.assign(this.config, state.config)
    this.simTime = state.simTime
    this.merges = state.merges
    let maxId = 0
    for (const s of state.bodies) {
      const body: Body = {
        id: s.id,
        name: s.name,
        kind: s.kind,
        x: s.x,
        y: s.y,
        vx: s.vx,
        vy: s.vy,
        ax: 0,
        ay: 0,
        mass: s.mass,
        radius: s.radius,
        visBoost: s.visBoost,
        color: s.color,
        glow: s.glow,
        solid: s.solid,
        spin: s.spin,
        absorbed: s.absorbed,
        lifeStage: s.lifeStage,
        trail: [],
        alive: true,
      }
      this.bodies.push(body)
      if (s.id > maxId) maxId = s.id
      this.counters[s.kind]++
    }
    this.nextId = maxId + 1
  }

  private computeAccelerations() {
    const bs = this.bodies
    const n = bs.length
    const { G, softening } = this.config
    const eps2 = softening * softening
    for (let i = 0; i < n; i++) {
      bs[i].ax = 0
      bs[i].ay = 0
    }
    for (let i = 0; i < n; i++) {
      const bi = bs[i]
      for (let j = i + 1; j < n; j++) {
        const bj = bs[j]
        const dx = bj.x - bi.x
        const dy = bj.y - bi.y
        const r2 = dx * dx + dy * dy + eps2
        const r = Math.sqrt(r2)
        // —— 相对论修正（Paczyński–Wiita 赝牛顿势）：只作用于黑洞的引力 ——
        // a = GM/(r − r_s)²，r_s 取事件视界半径（=黑洞物理半径）。
        // 相对牛顿引力：近视界急剧增强、r < 6 r_s 无稳定圆轨道（3 r_s 为 ISCO，
        // 内侧必坠落）、轨道产生进动——与广义相对论定性一致。
        // 远处 r ≫ r_s 时 (r−r_s)⁻² → r⁻²，平滑退回牛顿。
        let fi: number // i 受 j 的加速度大小系数（除以 r 得单位向量系数）
        let fj: number
        const rEff = r + bj.radius * 0.5 // 牛顿项防奇点（PW 项已由 r−r_s 处理视界）
        const rEff2 = r + bi.radius * 0.5
        if (bj.kind === 'blackhole' && bi.kind !== 'blackhole') {
          const rs = Math.max(bj.radius, 1e-6)
          // 实体天体：视界已垫在软化之上，不再额外地板，近视界引力真正发散（捕获）。
          // 示踪星（solid:false）：穿越核区时给视界地板——它只受「散射」不吃捕获，
          // 否则 rr→1e-4 的奇点会把示踪星数值甩飞（速度爆炸）
          const rr = Math.max(r - rs, bi.solid === false ? rs * 0.25 : 1e-4)
          fi = (G * bj.mass) / (rr * rr * r)
          fj = (G * bi.mass) / (rEff * rEff * r) // 黑洞自身按牛顿反作用（视界内物理对外不可见）
        } else if (bi.kind === 'blackhole' && bj.kind !== 'blackhole') {
          const rs = Math.max(bi.radius, 1e-6)
          const rr = Math.max(r - rs, bj.solid === false ? rs * 0.25 : 1e-4)
          fj = (G * bi.mass) / (rr * rr * r)
          fi = (G * bj.mass) / (rEff2 * rEff2 * r)
        } else {
          fi = (G * bj.mass) / (r2 * r)
          fj = (G * bi.mass) / (r2 * r)
        }
        bi.ax += fi * dx
        bi.ay += fi * dy
        bj.ax -= fj * dx
        bj.ay -= fj * dy
      }
    }
  }

  private integrate(dt: number, zoom = 1) {
    const { trails, trailsForever, G } = this.config
    const maxTrail = this.bodies.length > TRAIL.manyBodies ? this.perf.trailMaxLarge : this.perf.trailMaxSmall
    // 采样间距随缩放自适应：真实场景放大看卫星时仍能记录细密轨道
    const spacing = Math.max(TRAIL.spacing / zoom, 1e-6)
    const spacing2 = trailsForever ? (spacing * 2.7) ** 2 : spacing * spacing
    // 相对论：黑洞列表（ISCO 衰减用）
    const bhs = this.bodies.filter((x) => x.kind === 'blackhole')
    for (const b of this.bodies) {
      if (!b.held) {
        let ax = b.ax
        let ay = b.ay
        // 飞船推进器：在引力加速度上叠加推力（每模拟秒恒定——时间快进时 Δv 相应变大，
        // 这是快进的真实物理：踩 1 真实秒 = 模拟世界推了 N 秒）
        if (b.kind === 'ship' && b.thrust && b.thrust > 0) {
          ax += (b.thrustX ?? 0) * SHIP_THRUST * b.thrust
          ay += (b.thrustY ?? 0) * SHIP_THRUST * b.thrust
        }
        b.vx += ax * dt
        b.vy += ay * dt
        // —— ISCO 失稳：广义相对论中 r < 6 r_s 无稳定圆轨道（PW 势在此仍允许圆轨道，
        //  是赝势的已知偏差），叠加等效轨道衰减——切向速度按局部动力学时标耗散，
        //  越深入衰减越狠，3 r_s 内侧几乎直落。效果：吸积盘终止于 ISCO，
        //  内侧物体螺旋坠向视界，而不是以病态速度掠过奇点被数值甩飞 ——
        if (b.kind !== 'blackhole' && b.solid !== false) {
          for (const bh of bhs) {
            const dx = b.x - bh.x
            const dy = b.y - bh.y
            const r = Math.hypot(dx, dy)
            const rs = bh.radius
            if (r < rs * 6 && r > 1e-9) {
              // 切向方向（-dy, dx）/r
              const tx = -dy / r
              const ty = dx / r
              const vt = b.vx * tx + b.vy * ty - (bh.vx * tx + bh.vy * ty)
              const tDyn = Math.sqrt((r * r * r) / (G * bh.mass))
              const depth = Math.max(0, (6 * rs - r) / (6 * rs)) // 0@6rs → 1@视界
              const k = (dt / tDyn) * (0.5 + depth * depth * 12)
              const dv = vt * Math.min(k, 0.9)
              b.vx -= dv * tx
              b.vy -= dv * ty
              // 吸积增亮：ISCO 内坠落物体引力能释放 → 偶发闪光（吸积盘发光）
              // 镜像模式不本地造特效——吸积/并合特效由服务器权威事件下发
              if (!this.mirror && depth > 0.5 && this.effects.length < this.perf.effectMax && Math.random() < 0.06) {
                this.addEffect(b.x, b.y, b.radius * 2.5 + 2, '#ffb08a', 'merge')
              }
            }
          }
        }
        b.x += b.vx * dt
        b.y += b.vy * dt
      }
      if (trails) {
        const last = b.trail[b.trail.length - 1]
        const dx = b.x - (last?.x ?? Infinity)
        const dy = b.y - (last?.y ?? Infinity)
        if (dx * dx + dy * dy > spacing2) {
          b.trail.push({ x: b.x, y: b.y })
          if (!trailsForever && b.trail.length > maxTrail) b.trail.splice(0, TRAIL.trimStep)
        }
      } else if (b.trail.length > 0) {
        b.trail.length = 0
      }

      // —— 潮汐形变：靠近大质量天体时被拉长（洛希极限内最显著）——
      if (b.kind === 'planet' || b.kind === 'moon' || b.kind === 'asteroid') {
        let maxTidal = 0
        for (const h of this.bodies) {
          if (h === b || h.mass < b.mass * 50) continue
          const dx = b.x - h.x
          const dy = b.y - h.y
          const d = Math.hypot(dx, dy)
          const roche = this.rocheLimit(h, b)
          if (d < roche * 2) {
            maxTidal = Math.max(maxTidal, Math.min(1, (roche * 2 - d) / roche))
          }
        }
        b.tidal = maxTidal
      } else {
        b.tidal = 0
      }
    }
  }

  /** 事件视界捕获（最高优先级）：任何天体越过黑洞视界即被吞噬，越过所有豁免。
   *  示踪恒星（solid:false）只按真实尺度的史瓦西半径捕获（视觉半径在星系尺度上
   *  比真实视界大几个量级）——它们被散射而不是被吞噬 */
  /** 最近一个子步的步长（瞬移捕获判定用） */
  private subDt = 0

  private captureHorizon() {
    const bhs = this.bodies.filter((b) => b.kind === 'blackhole')
    if (bhs.length === 0) return
    let swallowed = false
    for (const bh of bhs) {
      for (const o of this.bodies) {
        if (o === bh || o.kind === 'blackhole' || !o.alive) continue
        const capR = o.solid === false ? bh.radius * BLACKHOLE.captureRTracer : bh.radius * BLACKHOLE.captureR
        const dx = o.x - bh.x
        const dy = o.y - bh.y
        const d2 = dx * dx + dy * dy
        if (d2 < capR * capR) {
          this.merge(bh, o)
          o.alive = false
          swallowed = true
          continue
        }
        // 瞬移捕获：高时间倍率下一个子步的位移可能远超视界直径，端点检测会
        // 「穿过黑洞而两端都在视界外」。凡是一个子步位移超过视界直径、且此刻
        // 就在 3 倍视界内的实体天体，判定为这一步跨过了视界，直接吞噬。
        if (o.solid !== false && this.subDt > 0) {
          const stepLen = Math.hypot(o.vx, o.vy) * this.subDt
          if (stepLen > capR * BLACKHOLE.teleportGate && d2 < capR * capR * BLACKHOLE.teleportZone) {
            this.merge(bh, o)
            o.alive = false
            swallowed = true
          }
        }
      }
    }
    if (swallowed) this.bodies = this.bodies.filter((b) => b.alive)
  }

  /** 天体物理密度（模拟单位）：由半径公式反推。
   *  恒星 R∝M^0.35 → ρ∝M^-0.03 近乎恒密度；行星 R∝M^0.22 → ρ∝M^0.34；
   *  岩石卫星 R∝M^0.27 → ρ∝M^0.19；黑洞按史瓦西半径 → ρ∝M^-2 */
  private densityOf(b: Body): number {
    return b.mass / ((4 / 3) * Math.PI * b.radius ** 3)
  }

  /** 洛希极限：流体刚体近似 d ≈ 2.44·R·(ρ_host/ρ_body)^(1/3) */
  private rocheLimit(host: Body, body: Body): number {
    return 2.44 * host.radius * Math.cbrt(this.densityOf(host) / Math.max(this.densityOf(body), 1e-9))
  }

  private resolveCollisions() {
    const bs = this.bodies
    const n = bs.length
    const dead = new Set<number>()
    for (let i = 0; i < n; i++) {
      const a = bs[i]
      if (dead.has(a.id)) continue
      for (let j = i + 1; j < n; j++) {
        const b = bs[j]
        if (dead.has(b.id)) continue
        // 事件视界捕获（最高优先级）：相对论开启时，任何天体越过黑洞视界即被吞噬，
        // 越过所有豁免——包括星系示踪星（非实体）与飞船，视界内物理没有例外
        {
          const bh = a.kind === 'blackhole' ? a : b.kind === 'blackhole' ? b : null
          if (bh) {
            const o = bh === a ? b : a
            const dxh = o.x - bh.x
            const dyh = o.y - bh.y
            // 示踪恒星（solid:false）只按真实史瓦西半径捕获：视觉半径在星系尺度上
            // 比真实视界大几个量级，若按视觉半径捕获，相遇一次就把两个星系吃空。
            // 真实捕获截面极小，示踪星应当被散射而不是被吞噬。
            const capR = o.solid === false ? bh.radius * BLACKHOLE.captureRTracer : bh.radius * BLACKHOLE.captureR
            if (dxh * dxh + dyh * dyh < capR * capR) {
              this.merge(bh, o)
              dead.add(o.id)
              continue
            }
          }
        }
        // 双方均为非实体（星系示踪恒星）时不碰撞——真实星系是无碰撞系统
        if (!a.solid && !b.solid) continue
        // 新生碎片冷却期内不碰撞：防止碎片云在生成瞬间级联
        if ((a.cooldown ?? 0) > 0 || (b.cooldown ?? 0) > 0) continue
        // 飞船免于常规碰撞合并：它负责近距离机动与掠飞，撞上什么也不消失（视界除外，见上）
        if (a.kind === 'ship' || b.kind === 'ship') continue

        const dx = b.x - a.x
        const dy = b.y - a.y
        const d = Math.hypot(dx, dy)
        const touch = a.radius + b.radius

        // —— 潮汐撕碎：小天体进入大天体洛希极限内，被引潮力撕成碎片 ——
        // 只对「行星/卫星/小行星」撕碎；恒星致密、黑洞更致密，不会被潮汐撕开
        {
          const [big, small] = a.mass >= b.mass ? [a, b] : [b, a]
          // 只对「行星/卫星」撕碎；小行星=碎屑/碎石堆（也是撕碎与碎裂的产物），
          // 再撕只会级联雪崩，故豁免——它进入洛希极限就直接撞击/并合。
          // 黑洞不撕碎：任何天体进洛希极限都是坠向视界，最终归宿是吞噬不是碎片环
          const fragile =
            (small.kind === 'planet' || small.kind === 'moon') && big.kind !== 'blackhole'
          if (fragile && big.mass / Math.max(small.mass, 1e-9) > COLLISION.rocheMassRatio && d < this.rocheLimit(big, small)) {
            this.disrupt(big, small)
            dead.add(small.id)
            continue
          }
        }

        // —— 体积接触：严格按真实表面接触判定（半径即体积）——
        if (d < touch) {
          const [big, small] = a.mass >= b.mass ? [a, b] : [b, a]
          // 恒星接触即并合：恒星是流体，碰撞从不反弹，接触必然合并（或落入）
          if (big.kind === 'star' || small.kind === 'star') {
            this.merge(big, small)
            dead.add(small.id)
            continue
          }
          // 黑洞吞噬任何接触者（含卫星）：不存在「卫星吃黑洞」——质量小的那方永远是被吞的
          if (big.kind === 'blackhole') {
            this.merge(big, small)
            dead.add(small.id)
            continue
          }
          const relVx = b.vx - a.vx
          const relVy = b.vy - a.vy
          const relV = Math.hypot(relVx, relVy)
          const vEsc = Math.sqrt((2 * this.config.G * (a.mass + b.mass)) / Math.max(touch, 1e-9))
          // 小行星（碎片）不能再碎裂——防止级联雪崩导致天体数爆炸
          const smallIsFragment = small.kind === 'asteroid'

          if (!smallIsFragment && relV > vEsc * COLLISION.shatterAt) {
            // 超临界撞击 → 碎裂
            this.shatter(big, small)
            dead.add(small.id)
          } else if (relV < vEsc * COLLISION.mergeBelow) {
            // 低速接触 → 并合（动能不足以克服引力束缚）
            this.merge(big, small)
            dead.add(small.id)
          } else {
            // 中速碰撞 → 物理反弹：法向按恢复系数分离，切向摩擦产生自旋，
            // 动能损失转化为热（发光效果）。不是简单合并也不是碎裂。
            const nx = dx / Math.max(d, 1e-9)
            const ny = dy / Math.max(d, 1e-9)
            const vn = relVx * nx + relVy * ny // 法向相对速度
            const vtx = relVx - vn * nx
            const vty = relVy - vn * ny // 切向相对速度
            const vt = Math.hypot(vtx, vty)

            // 恢复系数按能量分级：高能撞击岩石弹跳（~0.35）；低于逃逸速度一半的
            // 碰撞近乎完全非弹性（e=0.1）——否则引力每步泵入的能量会让贴脸天体
            // 陷入「弹开-拉回」的数值极限环，永远不吸积
            const e = relV < vEsc * COLLISION.softAt ? COLLISION.restitutionLow : COLLISION.restitutionHigh
            // 切向摩擦系数：决定自旋转换效率
            const mu = COLLISION.friction

            // 冲量计算（一维法向 + 二维切向）
            const m1 = big.mass
            const m2 = small.mass
            const reduced = (m1 * m2) / (m1 + m2)
            // 法向冲量：恢复系数 e 决定反弹强度
            const jn = -(1 + e) * vn * reduced
            // 切向冲量：摩擦耗散，上限受法向冲量限制（库仑摩擦）
            const jt = Math.min(mu * Math.abs(jn), vt * reduced) * Math.sign(vt || 1)

            big.vx -= (jn * nx - jt * (vty / Math.max(vt, 1e-9))) / m1
            big.vy -= (jn * ny + jt * (vtx / Math.max(vt, 1e-9))) / m1
            small.vx += (jn * nx - jt * (vty / Math.max(vt, 1e-9))) / m2
            small.vy += (jn * ny + jt * (vtx / Math.max(vt, 1e-9))) / m2

            // 自旋：切向摩擦 → 角动量（简化：I ≈ (2/5)mr²）
            const spinGain = (jt * big.radius) / (0.4 * m1 * big.radius * big.radius)
            big.spin = (big.spin ?? 0) + spinGain
            small.spin = (small.spin ?? 0) - spinGain * (m1 / m2) * (big.radius / small.radius)

            // 动能损失 → 热发光（能量耗散的可视化）；闪光放在接触点而非质心
            const keBefore = 0.5 * reduced * relV * relV
            const keAfter = 0.5 * reduced * (vn * vn * e * e + (vt - jt / reduced) ** 2)
            const heat = Math.max(keBefore - keAfter, 0)
            // 接触点：从大天体中心沿撞击方向推到表面
            const ctX = big.x - nx * big.radius
            const ctY = big.y - ny * big.radius
            if (heat > 0.1) {
              this.addEffect(ctX, ctY, Math.sqrt(heat) * 0.5 + 3, '#fbbf24', 'merge')
            }
            // 硬反弹溅碎片：动能足够大时从接触点崩出少量碎屑（非中心对称，撞击侧更多）。
            // 质量从大天体扣除——碎屑不是凭空造出来的。
            // 碎屑（asteroid）撞击不再溅新屑：否则碎屑回落砸中行星会级联雪崩
            if (relV > vEsc * COLLISION.debrisAbove && !smallIsFragment && this.bodies.length < COLLISION.debrisFuse) {
              const nFrag = relV > vEsc * COLLISION.shatterAt * 0.75 ? 3 : 2
              const eject = Math.min(small.mass * COLLISION.debrisMassSmall, big.mass * COLLISION.debrisMassBig)
              const mEach = eject / nFrag
              big.mass -= eject
              big.radius = radiusFor(big.kind, big.mass)
              for (let k = 0; k < nFrag; k++) {
                // 碎片偏向弹回侧（撞击面反向）+ 切向散开
                const back = Math.atan2(-ny, -nx) + (k - (nFrag - 1) / 2) * 0.7 + (Math.random() - 0.5) * 0.3
                const spd = relV * (0.3 + Math.random() * 0.25)
                const frag = this.addBody({
                  kind: 'asteroid',
                  x: ctX + Math.cos(back) * 1.5,
                  y: ctY + Math.sin(back) * 1.5,
                  vx: (big.vx + small.vx) / 2 + Math.cos(back) * spd,
                  vy: (big.vy + small.vy) / 2 + Math.sin(back) * spd,
                  mass: mEach,
                })
                frag.cooldown = COLLISION.debrisCooldown
              }
            }

            // 位置分离：防止重叠（把球推到刚好接触）
            const overlap = touch - d
            if (overlap > 0) {
              const push = overlap / 2 + 0.01
              big.x -= nx * push * (m2 / (m1 + m2))
              big.y -= ny * push * (m2 / (m1 + m2))
              small.x += nx * push * (m1 / (m1 + m2))
              small.y += ny * push * (m1 / (m1 + m2))
            }
          }
        }
      }
    }
    if (dead.size > 0) {
      for (const b of bs) if (dead.has(b.id)) b.alive = false
      this.bodies = bs.filter((b) => !dead.has(b.id))
    }
  }

  /** 潮汐撕碎：小天体重组为环绕宿主的一圈碎片（体积守恒：总质量不变）。
   *  碎片带 3 帧冷却，防止生成瞬间再次碰撞级联 */
  private disrupt(host: Body, victim: Body) {
    // 总量保险丝：碎片太多时退化为直接并合，防止任何意外级联拖垮整机
    if (this.bodies.length > COLLISION.hardFuse) {
      this.merge(host, victim)
      return
    }
    const pieces = COLLISION.disruptPieces
    const mEach = victim.mass / pieces
    const dx = victim.x - host.x
    const dy = victim.y - host.y
    const d = Math.max(Math.hypot(dx, dy), host.radius * 2)
    const vOrbit = Math.sqrt((this.config.G * host.mass) / d)
    for (let k = 0; k < pieces; k++) {
      const ang = (k / pieces) * Math.PI * 2 + Math.atan2(dy, dx)
      const rr = d * (0.7 + 0.1 * k)
      const frag = this.addBody({
        kind: 'asteroid',
        x: host.x + Math.cos(ang) * rr,
        y: host.y + Math.sin(ang) * rr,
        vx: host.vx + (-Math.sin(ang)) * vOrbit * (0.9 + 0.15 * Math.random()),
        vy: host.vy + Math.cos(ang) * vOrbit * (0.9 + 0.15 * Math.random()),
        mass: mEach,
      })
      frag.cooldown = COLLISION.debrisCooldown
    }
    this.addEffect(victim.x, victim.y, victim.radius * 8 + 6, '#fbbf24', 'merge')
  }

  /** 超临界撞击：大天体失去一部分质量，双方物质炸成碎片云向外抛射 */
  private shatter(big: Body, small: Body) {
    // 总量保险丝：同上
    if (this.bodies.length > COLLISION.hardFuse) {
      this.merge(big, small)
      return
    }
    const lostMass = Math.min(big.mass * 0.12, small.mass * 2)
    big.mass -= lostMass
    big.radius = radiusFor(big.kind, big.mass)
    const spray = Math.min(small.mass + lostMass, big.mass * 0.3)
    const pieces = COLLISION.shatterPieces
    const mEach = spray / pieces
    const ang0 = Math.atan2(small.y - big.y, small.x - big.x)
    const vRel = Math.hypot(small.vx - big.vx, small.vy - big.vy)
    for (let k = 0; k < pieces; k++) {
      const ang = ang0 + (k - pieces / 2) * 0.35 + (Math.random() - 0.5) * 0.2
      const v = vRel * (0.4 + 0.25 * k)
      const frag = this.addBody({
        kind: 'asteroid',
        x: big.x + Math.cos(ang) * big.radius * 1.3,
        y: big.y + Math.sin(ang) * big.radius * 1.3,
        vx: big.vx + Math.cos(ang) * v,
        vy: big.vy + Math.sin(ang) * v,
        mass: mEach,
      })
      frag.cooldown = COLLISION.debrisCooldown
    }
    this.addEffect((big.x + small.x) / 2, (big.y + small.y) / 2, (big.radius + small.radius) * 5, '#f87171', 'merge')
  }

  private merge(a: Body, b: Body) {
    // a 吸收 b：动量守恒、质量相加、体积相加
    const total = a.mass + b.mass
    // 撞击相对速度（并合表现按能量分级用，要在 a 被原地更新前取）
    const relV = Math.hypot(b.vx - a.vx, b.vy - a.vy)
    const mx = (a.x * a.mass + b.x * b.mass) / total
    const my = (a.y * a.mass + b.y * b.mass) / total
    a.vx = (a.vx * a.mass + b.vx * b.mass) / total
    a.vy = (a.vy * a.mass + b.vy * b.mass) / total
    a.x = mx
    a.y = my
    a.mass = total
    a.radius = Math.cbrt(a.radius ** 3 + b.radius ** 3)
    // 恒星吞并质量累计（驱动生命周期）
    if (a.kind === 'star' || a.kind === 'blackhole') a.absorbed = (a.absorbed ?? 0) + b.mass

    // —— 黑洞优先级最高：并合任一方是黑洞，结果必为黑洞（恒星质量再大也只是坠进去）——
    if (a.kind !== 'blackhole' && b.kind === 'blackhole') {
      a.kind = 'blackhole'
      this.dirtyMeta.add(a.id)
      a.name = `黑洞 Ω-${++this.counters.blackhole}`
      a.lifeStage = 'blackhole'
      a.color = '#05030c'
      a.glow = 'rgba(164,144,194,0.85)'
      a.radius = radiusFor('blackhole', total)
      this.effects.push({
        x: mx,
        y: my,
        age: 0,
        ttl: 0.9,
        size: a.radius * 3 + 6,
        color: '#a490c2',
        kind: 'merge',
      })
      this.merges++
      return
    }

    // —— 类型按质量段重新定级：并合后质量跨段就升级（小行星+小行星=卫星……行星越过
    //    点燃线成为恒星）；恒星/黑洞的归宿由生命周期与黑洞优先规则管辖，不在此改 ——
    if (a.kind === 'asteroid' || a.kind === 'moon' || a.kind === 'planet') {
      const promoted = kindForMass(a.mass)
      if (promoted !== a.kind) {
        this.dirtyMeta.add(a.id)
        a.kind = promoted
        this.counters[promoted]++
        if (promoted === 'star') {
          // 行星点燃：褐矮星点火成为恒星（名字/外观按恒星来）
          a.name = `恒星 ${GREEK[(this.counters.star++) % GREEK.length]}-N`
          a.lifeStage = 'main'
          const ap = starAppearance(a.mass)
          a.color = ap.color
          a.glow = ap.glow
        } else {
          a.name = this.makeName(promoted)
          a.lifeStage = undefined
        }
      }
    }

    if (a.kind === 'star') {
      // 恒星并合的物理表现：公共包层抛射 —— 撞击能量显著（撞过来的天体够大/够快）
      // 时：白闪 + 壳层扩散 + 溅射碎屑；小天体坠入只激起一次亮斑，不做夸张表现
      if (b.mass > total * LIFECYCLE.notableMassRatio || relV > LIFECYCLE.notableRelV) {
        this.addEffect(a.x, a.y, a.radius * 5 + 18, '#ffffff', 'merge')
        this.effects.push({ x: a.x, y: a.y, age: 0, ttl: 1.4, size: a.radius * 12 + 48, color: '#ff9b4a', kind: 'merge' })
        if (b.mass > total * LIFECYCLE.notableMassRatio && this.bodies.length < COLLISION.debrisFuse) {
          // 溅射：并合甩出的包层物质，沿随机方向以逃逸量级的速度抛出
          const pieces = 4
          const eject = Math.min(b.mass * LIFECYCLE.ejectMassRatio, a.mass * LIFECYCLE.ejectCap)
          const mEach = eject / pieces
          const vEj = Math.max(relV * 0.35, 1.2)
          for (let k = 0; k < pieces; k++) {
            const ang = Math.random() * Math.PI * 2
            const frag = this.addBody({
              kind: 'asteroid',
              x: a.x + Math.cos(ang) * a.radius * 1.5,
              y: a.y + Math.sin(ang) * a.radius * 1.5,
              vx: a.vx + Math.cos(ang) * vEj,
              vy: a.vy + Math.sin(ang) * vEj,
              mass: mEach,
            })
            frag.cooldown = LIFECYCLE.ejectCooldown
          }
        }
      } else {
        this.addEffect(a.x, a.y, a.radius * 2.5 + 10, '#ffe9c9', 'merge')
      }
      this.applyStarStage(a)
    }

    this.effects.push({
      x: mx,
      y: my,
      age: 0,
      ttl: 0.9,
      size: a.radius * 3 + 6,
      color: a.kind === 'blackhole' ? '#a490c2' : a.color,
      kind: 'merge',
    })
    this.merges++
  }

  addEffect(x: number, y: number, size: number, color: string, kind: Effect['kind']) {
    this.effects.push({ x, y, age: 0, ttl: 0.6, size, color, kind })
  }

  /** 应用恒星生命周期阶段：跃迁时更新外观/半径，超新星塌缩成黑洞。吞并与岁月演化共用 */
  private applyStarStage(a: Body) {
    const st = starStageFor(a.mass, a.absorbed ?? 0)
    const prev = a.lifeStage
    a.lifeStage = st.stage
    if (st.stage === 'blackhole') {
      // 超新星塌缩
      this.dirtyMeta.add(a.id)
      a.kind = 'blackhole'
      this.dirtyMeta.add(a.id)
      a.name = `黑洞 Ω-${++this.counters.blackhole}`
      a.color = st.color
      a.glow = st.glow
      a.radius = radiusFor('blackhole', a.mass)
      this.addEffect(a.x, a.y, a.radius * BLACKHOLE.supernovaFx + 20, '#ff6b4a', 'merge')
      return
    }
    if (st.stage !== prev) {
      // 阶段跃迁（红巨星/白矮星）：半径与颜色变化 + 爆发闪光
      this.dirtyMeta.add(a.id)
      a.color = st.color
      a.glow = st.glow
      a.radius = Math.max(radiusFor('star', a.mass) * st.radiusFactor, a.radius * (st.stage === 'giant' ? 1.6 : 1))
      if (st.stage !== 'main') this.addEffect(a.x, a.y, a.radius * 10 + 14, st.color, 'merge')
    }
  }

  get totalMass(): number {
    let m = 0
    for (const b of this.bodies) m += b.mass
    return m
  }

  /** 点击拾取：命中圈（max(容差, 半径×1.6)）内屏幕距离最近的天体 */
  pick(wx: number, wy: number, tolerance: number): Body | null {
    let best: Body | null = null
    let bestD = Infinity
    for (const b of this.bodies) {
      const dx = b.x - wx
      const dy = b.y - wy
      const d2 = dx * dx + dy * dy
      const hit = Math.max(tolerance, b.radius * 1.6)
      if (d2 <= hit * hit && d2 < bestD) {
        best = b
        bestD = d2
      }
    }
    return best
  }
}
