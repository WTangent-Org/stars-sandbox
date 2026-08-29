import { Simulation } from './engine'
import { trailCap } from './trail'
import { TRAIL } from './config'

/** 缓冲帧：全场天体的最小状态（按主模拟 bodies 顺序一一对应） */
export interface Frame {
  t: number // 模拟时间
  x: Float64Array
  y: Float64Array
  vx: Float64Array
  vy: Float64Array
  alive: Uint8Array
}

const FRAME_DT = 1 / 60 // 每帧对应的真实秒（与主循环帧步长一致）
/** 超过这个数量时预演进入「低精度模式」：全场大步长单步积分 */
const FULL_PRECISION_MAX = 60
/** 影子模拟每个真实帧最多跑的缓冲帧数（加速期上限，防 CPU 过载） */
const RATE_MAX = 8

/**
 * 未来缓冲预演器：
 * 维护一个影子模拟，以快于画面的速度往前推演，把每帧全场状态存入环形缓冲；
 * 渲染帧按画面速度从缓冲消费。推力/拖拽/加星等状态变更 → invalidate() 分叉重算。
 * 飞船的「未来轨迹」直接从缓冲里读——是真实 N 体结果，不是近似外推。
 *
 * 设计取舍：预演对主模拟是「单向帮助」——主模拟消费影子算好的缓冲帧，
 * 省下自己的积分开销；但主模拟不能反向跳帧复用影子（会吞掉用户的即时干预、
 * 丢失特效/生命周期事件），所以影子的计算本质是纯开销换预测。
 *
 * 场景分级：
 * - 小场景（≤FULL_PRECISION_MAX 天体）：影子全精度积分，主模拟直接消费缓冲，
 *   物理总量 ≈ 单场景 ×2（影子赶帧 + 主模拟偶尔分叉回填），操控零延迟。
 * - 大场景（星系）：影子整体关闭（低精度影子跑了主模拟也不敢用，纯白烧 CPU），
 *   飞船预测线回退到轻量 N 体外推——星系要的是视觉效果，轮廓对就够。
 */
export class FutureBuffer {
  frames: Frame[] = []
  /** 帧对应的 bodies 顺序（分叉时锁定；主模拟 add/remove 会触发 invalidate 重建） */
  order: number[] = []
  mergesAt: number[] = [] // 每帧的 merges 值（消费时同步给主模拟）
  private shadow: Simulation | null = null
  /** 连续分叉代数：同一代内影子状态有效 */
  generation = 0
  private budgetMs = 0 // 自适应速率：实测单帧物理耗时
  /** 目标领先量（秒）：加速期补到这个库存后转入匀速 */
  leadTargetSec = 10
  /** 低精度模式（大场景）：影子配置已被降级 */
  coarse = false
  /** 性能档位：加速期每真实帧最多跑的缓冲帧数（由外部注入） */
  rateMax?: number

  get active(): boolean {
    return this.shadow !== null
  }

  /** 从主模拟当前状态分叉，开始/重开预演；大场景直接关闭（影子低精度无意义） */
  fork(sim: Simulation) {
    if (sim.bodies.length > FULL_PRECISION_MAX) {
      this.shadow = null
      this.frames = []
      this.coarse = true
      return
    }
    this.shadow = sim.clone()
    this.order = sim.bodies.map((b) => b.id)
    this.frames = []
    this.mergesAt = []
    this.generation++
    this.coarse = false
  }

  /** 状态变更（推力变化、拖拽、加减天体、改参数）→ 丢弃旧未来 */
  invalidate() {
    this.shadow = null
    this.frames = []
  }

  /**
   * 每个真实帧调用：影子往前赶若干帧。
   * 自适应：目标领先 3 秒；不足时多跑（≤RATE_MAX），有余时少跑；
   * 单帧物理太贵（>6ms）时恒定为 1（1:1 跟随，不额外占 CPU）。
   * 时间流速同步：主模拟的 timeScale 变化（快进/慢放）会实时传给影子，
   * 否则影子按旧流速攒帧，画面消费的缓冲节奏跟不上，飞船看起来不随流速变快。
   */
  tick(sim: Simulation) {
    const sh = this.shadow
    if (!sh) return
    // 流速漂移 → 影子跟上（时间流速不属于「状态变更」，不需要分叉，直接改配置）
    if (sh.config.timeScale !== sim.config.timeScale) sh.config.timeScale = sim.config.timeScale
    const leadTarget = this.leadTargetSec / FRAME_DT
    const rateMax = this.rateMax ?? RATE_MAX
    const t0 = performance.now()
    let ran = 0
    while (ran < rateMax && this.frames.length < leadTarget + 60) {
      const need = this.frames.length < leadTarget ? rateMax : 1
      const batch = Math.min(need, rateMax - ran)
      for (let k = 0; k < batch; k++) {
        sh.advance(FRAME_DT, 1)
        this.pushFrame(sh)
      }
      ran += batch
      if (this.frames.length >= leadTarget) break
      // 自适应护栏：本帧已花 >5ms 就别再赶了，避免挤占渲染
      if (performance.now() - t0 > 5) break
    }
    const cost = performance.now() - t0
    this.budgetMs = this.budgetMs * 0.9 + cost * 0.1
    // 主模拟可能因合并少了天体——锁定顺序对不上就静默重建（外部一般也会 invalidate）
    if (sim.bodies.length !== this.order.length) this.fork(sim)
  }

  private pushFrame(sh: Simulation) {
    const n = sh.bodies.length
    const f: Frame = {
      t: sh.simTime,
      x: new Float64Array(n),
      y: new Float64Array(n),
      vx: new Float64Array(n),
      vy: new Float64Array(n),
      alive: new Uint8Array(n),
    }
    // 影子与主模拟的分叉点 bodies 顺序一致；合并会让影子变短，对不上的槽位标 dead
    const byId = new Map(sh.bodies.map((b) => [b.id, b] as const))
    const m = this.order.length
    const fx = new Float64Array(m)
    const fy = new Float64Array(m)
    const fvx = new Float64Array(m)
    const fvy = new Float64Array(m)
    const fa = new Uint8Array(m)
    for (let i = 0; i < m; i++) {
      const b = byId.get(this.order[i])
      if (b && b.alive) {
        fx[i] = b.x
        fy[i] = b.y
        fvx[i] = b.vx
        fvy[i] = b.vy
        fa[i] = 1
      }
    }
    this.frames.push({ t: f.t, x: fx, y: fy, vx: fvx, vy: fvy, alive: fa })
    this.mergesAt.push(sh.merges)
  }

  /** 领先画面的缓冲秒数 */
  get leadSeconds(): number {
    return this.frames.length * FRAME_DT
  }

  /** 消费一帧：把缓冲状态写回主模拟 bodies（不动对象身份，UI 引用不丢）。
   *  大场景（coarse）返回 false——影子精度不足以驱动主模拟，主模拟自己直跑 */
  consume(sim: Simulation): boolean {
    if (this.coarse) return false
    const f = this.frames.shift()
    if (!f) return false
    const merges = this.mergesAt.shift() ?? sim.merges
    // 被合并掉的天体：从主模拟移除（保持与影子一致）
    let removed = false
    for (let i = 0; i < this.order.length; i++) {
      if (!f.alive[i]) {
        const b = sim.bodies.find((x) => x.id === this.order[i])
        if (b) {
          b.alive = false
          removed = true
        }
      }
    }
    if (removed) sim.bodies = sim.bodies.filter((b) => b.alive)
    for (let i = 0; i < this.order.length; i++) {
      if (!f.alive[i]) continue
      const b = sim.bodies.find((x) => x.id === this.order[i])
      if (!b || b.held) continue
      // 轨迹记录（沿用与引擎一致的间距采样）
      const last = b.trail[b.trail.length - 1]
      const dx = f.x[i] - (last?.x ?? Infinity)
      const dy = f.y[i] - (last?.y ?? Infinity)
      if (sim.config.trails && dx * dx + dy * dy > 1e-12) {
        if (dx * dx + dy * dy > 0.0016) {
          b.trail.push({ x: f.x[i], y: f.y[i] })
          if (!sim.config.trailsForever && b.trail.length > trailCap(sim.bodies.length)) b.trail.splice(0, TRAIL.trimStep)
        }
      }
      b.x = f.x[i]
      b.y = f.y[i]
      b.vx = f.vx[i]
      b.vy = f.vy[i]
    }
    sim.simTime = f.t
    sim.merges = merges
    return true
  }

  /** 某艘飞船在缓冲里的未来位置序列（画虚线用；按 stride 抽稀） */
  shipFuture(shipId: number, stride = 6): Array<{ x: number; y: number }> | null {
    const idx = this.order.indexOf(shipId)
    if (idx < 0 || this.frames.length < 8) return null
    const pts: Array<{ x: number; y: number }> = []
    for (let i = 0; i < this.frames.length; i += stride) {
      const f = this.frames[i]
      if (!f.alive[idx]) break
      pts.push({ x: f.x[idx], y: f.y[idx] })
    }
    return pts.length > 4 ? pts : null
  }

  /** 预演覆盖的模拟时长（秒级显示用） */
  get horizonSimTime(): number {
    const f = this.frames[this.frames.length - 1]
    return f ? f.t : 0
  }
}
