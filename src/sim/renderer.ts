import type { Body, Camera, SpawnSettings } from './types'
import type { Simulation } from './engine'
import { radiusFor } from './engine'
import type { FutureBuffer } from './future'

interface StarDot {
  x: number
  y: number
  r: number
  a: number
  tint: string
}

const TINTS = ['#e6e6fa', '#cdd6ff', '#ffe9c9', '#a490c2']

/** 生成两层视差星野 */
export function makeStarfield(w: number, h: number): { far: StarDot[]; near: StarDot[] } {
  const far: StarDot[] = []
  const near: StarDot[] = []
  const area = Math.max(w * h, 800 * 600)
  const nFar = Math.floor(area / 5200)
  const nNear = Math.floor(area / 16000)
  for (let i = 0; i < nFar; i++) {
    far.push({
      x: Math.random() * w,
      y: Math.random() * h,
      r: Math.random() * 1.1 + 0.3,
      a: Math.random() * 0.5 + 0.15,
      tint: TINTS[(Math.random() * TINTS.length) | 0],
    })
  }
  for (let i = 0; i < nNear; i++) {
    near.push({
      x: Math.random() * w,
      y: Math.random() * h,
      r: Math.random() * 1.6 + 0.6,
      a: Math.random() * 0.7 + 0.3,
      tint: TINTS[(Math.random() * TINTS.length) | 0],
    })
  }
  return { far, near }
}

function drawStarLayer(ctx: CanvasRenderingContext2D, stars: StarDot[], w: number, h: number, ox: number, oy: number) {
  for (const s of stars) {
    let x = (s.x - ox) % w
    let y = (s.y - oy) % h
    if (x < 0) x += w
    if (y < 0) y += h
    ctx.globalAlpha = s.a
    ctx.fillStyle = s.tint
    ctx.beginPath()
    ctx.arc(x, y, s.r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

// —— 光晕精灵缓存：每色只生成一次，drawImage 比逐帧径向渐变快一个数量级 ——
const glowSprites = new Map<string, HTMLCanvasElement>()
// 飞船预测线缓存：key=飞船 id，最多每 120ms 重算一次
const predictCache = new Map<number, { t: number; path: Array<{ x: number; y: number }> | null }>()

function getGlowSprite(glow: string): HTMLCanvasElement {
  let c = glowSprites.get(glow)
  if (c) return c
  c = document.createElement('canvas')
  c.width = 128
  c.height = 128
  const g2 = c.getContext('2d')!
  const grad = g2.createRadialGradient(64, 64, 8, 64, 64, 64)
  grad.addColorStop(0, glow)
  grad.addColorStop(0.4, glow.replace(/[\d.]+\)$/, '0.18)'))
  grad.addColorStop(1, 'rgba(0,0,0,0)')
  g2.fillStyle = grad
  g2.fillRect(0, 0, 128, 128)
  glowSprites.set(glow, c)
  return c
}

export interface SpawnPreview {
  active: boolean
  sx: number // 世界坐标
  sy: number
  cx: number
  cy: number
}

export function draw(
  ctx: CanvasRenderingContext2D,
  sim: Simulation,
  cam: Camera,
  w: number,
  h: number,
  starfield: { far: StarDot[]; near: StarDot[] },
  selectedId: number | null,
  spawn: SpawnPreview | null,
  spawnSettings: SpawnSettings,
  now: number,
  future?: FutureBuffer,
) {
  // —— 深空底色 + 暗角 ——
  ctx.fillStyle = '#07040f'
  ctx.fillRect(0, 0, w, h)
  const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.max(w, h) * 0.75)
  vg.addColorStop(0, 'rgba(43,30,62,0.16)')
  vg.addColorStop(1, 'rgba(7,4,15,0)')
  ctx.fillStyle = vg
  ctx.fillRect(0, 0, w, h)

  drawStarLayer(ctx, starfield.far, w, h, cam.x * 0.04 * cam.zoom, cam.y * 0.04 * cam.zoom)
  drawStarLayer(ctx, starfield.near, w, h, cam.x * 0.12 * cam.zoom, cam.y * 0.12 * cam.zoom)

  ctx.save()
  ctx.translate(w / 2, h / 2)
  ctx.scale(cam.zoom, cam.zoom)
  ctx.translate(-cam.x, -cam.y)

  // —— 轨迹 ——
  if (sim.config.trails) {
    ctx.lineWidth = 1 / cam.zoom
    for (const b of sim.bodies) {
      const t = b.trail
      if (t.length < 2) continue
      ctx.strokeStyle = b.glow
      ctx.globalAlpha = b.kind === 'star' || b.kind === 'blackhole' ? 0.4 : 0.5
      ctx.beginPath()
      ctx.moveTo(t[0].x, t[0].y)
      for (let i = 1; i < t.length; i++) ctx.lineTo(t[i].x, t[i].y)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
  }

  // —— 飞船未来轨迹（虚线） ——
  // 优先从预演缓冲读真实 N 体未来（加速影子模拟的推演结果，非近似外推）；
  // 缓冲不可用（大星系/刚分叉重建中）时回退到 N 体近似预测器
  for (const b of sim.bodies) {
    if (b.kind !== 'ship' || !b.alive) continue
    let path = future && future.active ? future.shipFuture(b.id) : null
    if (!path) {
      let cached = predictCache.get(b.id)
      if (!cached || now - cached.t > 120) {
        cached = { t: now, path: predictShipPath(sim, b) }
        predictCache.set(b.id, cached)
      }
      path = cached.path
    }
    if (path) {
      ctx.strokeStyle = 'rgba(164,224,255,0.55)'
      ctx.lineWidth = 1.1 / cam.zoom
      ctx.setLineDash([6 / cam.zoom, 5 / cam.zoom])
      ctx.beginPath()
      ctx.moveTo(path[0].x, path[0].y)
      for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y)
      ctx.stroke()
      ctx.setLineDash([])
    }
  }

  // —— 天体 ——
  for (const b of sim.bodies) {
    drawBody(ctx, b, cam.zoom, now, sim)
  }

  // —— 选中标记 ——
  if (selectedId != null) {
    const b = sim.bodies.find((x) => x.id === selectedId)
    if (b) {
      const r = b.radius + 8 / cam.zoom
      ctx.strokeStyle = 'rgba(164,144,194,0.9)'
      ctx.lineWidth = 1.2 / cam.zoom
      ctx.setLineDash([5 / cam.zoom, 4 / cam.zoom])
      ctx.beginPath()
      ctx.arc(b.x, b.y, r, 0, Math.PI * 2)
      ctx.stroke()
      ctx.setLineDash([])
    }
  }

  // —— 碰撞 / 生成特效 ——
  for (const e of sim.effects) {
    const p = e.age / e.ttl
    const r = e.size * (0.3 + p * 1.4)
    ctx.globalAlpha = (1 - p) * 0.9
    if (e.kind === 'merge') {
      ctx.strokeStyle = e.color
      ctx.lineWidth = 2.2 / cam.zoom
      ctx.beginPath()
      ctx.arc(e.x, e.y, r, 0, Math.PI * 2)
      ctx.stroke()
      const fg = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, r * 0.8)
      fg.addColorStop(0, 'rgba(255,255,255,0.5)')
      fg.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = fg
      ctx.beginPath()
      ctx.arc(e.x, e.y, r * 0.8, 0, Math.PI * 2)
      ctx.fill()
    } else {
      ctx.strokeStyle = e.color
      ctx.lineWidth = 1.4 / cam.zoom
      ctx.beginPath()
      ctx.arc(e.x, e.y, r, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
  }

  // —— 放置预览 ——
  if (spawn?.active) {
    const ghostR = radiusFor(spawnSettings.kind, spawnSettings.mass)
    ctx.globalAlpha = 0.55
    ctx.fillStyle = spawnSettings.kind === 'blackhole' ? '#05030c' : '#a490c2'
    ctx.strokeStyle = '#a490c2'
    ctx.lineWidth = 1.2 / cam.zoom
    ctx.beginPath()
    ctx.arc(spawn.sx, spawn.sy, ghostR, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    ctx.globalAlpha = 1

    const dx = spawn.cx - spawn.sx
    const dy = spawn.cy - spawn.sy
    if (Math.hypot(dx, dy) > 2) {
      ctx.strokeStyle = 'rgba(230,230,250,0.85)'
      ctx.lineWidth = 1.4 / cam.zoom
      ctx.setLineDash([6 / cam.zoom, 4 / cam.zoom])
      ctx.beginPath()
      ctx.moveTo(spawn.sx, spawn.sy)
      ctx.lineTo(spawn.cx, spawn.cy)
      ctx.stroke()
      ctx.setLineDash([])
      // 箭头
      const ang = Math.atan2(dy, dx)
      const ah = 9 / cam.zoom
      ctx.fillStyle = 'rgba(230,230,250,0.9)'
      ctx.beginPath()
      ctx.moveTo(spawn.cx, spawn.cy)
      ctx.lineTo(spawn.cx - ah * Math.cos(ang - 0.42), spawn.cy - ah * Math.sin(ang - 0.42))
      ctx.lineTo(spawn.cx - ah * Math.cos(ang + 0.42), spawn.cy - ah * Math.sin(ang + 0.42))
      ctx.closePath()
      ctx.fill()
    }
  }

  ctx.restore()
}

/**
 * 飞船轨道预测：以引力主导者为唯一引力源做二体外推，
 * 虚线画出当前轨道的一个完整周期（或逃逸段）。
 */
/**
 * 飞船轨道预测：完整 N 体数值外推（船为无质量测试粒子，其余天体照常互相吸引），
 * 因此会自然包含行星引力摄动，不会把宿主当静止点而画歪。
 * 用跳跃蛙（leapfrog）积分，能量长期行为好。
 */
export function predictShipPath(sim: Simulation, ship: Body, maxSteps = 1400): Array<{ x: number; y: number }> | null {
  let bodies = sim.bodies.filter((b) => b.alive && b.id !== ship.id && (b.kind === 'star' || b.kind === 'planet' || b.kind === 'moon' || b.kind === 'blackhole'))
  if (bodies.length === 0) return null
  const G = sim.config.G

  // 性能护栏：星系场景有数百天体，全部外推是 O(n²)×步数，每帧调用必卡死。
  // 只保留对飞船引力最强的前 MAX_PREDICT 个——远处恒星的引力在外推时标内
  // 近似匀速背景，对轨迹形状影响可忽略；少了它们反而更稳（不会累积多体误差乱晃）
  const MAX_PREDICT = 16
  if (bodies.length > MAX_PREDICT) {
    const scored = bodies.map((b) => {
      const r = Math.max(Math.hypot(ship.x - b.x, ship.y - b.y), 1e-9)
      return { b, pull: b.mass / (r * r) }
    })
    scored.sort((a, z) => z.pull - a.pull)
    bodies = scored.slice(0, MAX_PREDICT).map((s) => s.b)
  }

  // 宿主选择：先找引力最强的天体；若飞船相对它「牢固束缚」（轨道能量明显为负），
  // 以它为预测宿主（如贴行星停泊）；否则升到恒星级宿主（恒星/黑洞中最强者），
  // 因为勉强束缚/逃逸态的飞船很快进入绕主星轨道，绕主星的外推才是用户想看的
  let hostIdx = -1
  let hostPull = 0
  let hostR = Infinity
  for (let i = 0; i < bodies.length; i++) {
    const b = bodies[i]
    const r = Math.hypot(ship.x - b.x, ship.y - b.y)
    if (r < 1e-9 || b.mass <= 0) continue
    const pull = (G * b.mass) / (r * r)
    if (pull > hostPull) {
      hostPull = pull
      hostIdx = i
      hostR = r
    }
  }
  if (hostIdx >= 0) {
    const hb = bodies[hostIdx]
    const dvx = ship.vx - hb.vx
    const dvy = ship.vy - hb.vy
    const eps = (dvx * dvx + dvy * dvy) / 2 - (G * hb.mass) / hostR
    const boundMargin = (-eps) / ((G * hb.mass) / hostR)
    if (boundMargin < 0.15 && (hb.kind === 'planet' || hb.kind === 'moon')) {
      // 不够牢固 → 升级到恒星级宿主
      let starIdx = -1
      let starPull = 0
      for (let i = 0; i < bodies.length; i++) {
        const b = bodies[i]
        if (b.kind !== 'star' && b.kind !== 'blackhole') continue
        const r = Math.hypot(ship.x - b.x, ship.y - b.y)
        if (r < 1e-9 || b.mass <= 0) continue
        const pull = (G * b.mass) / (r * r)
        if (pull > starPull) {
          starPull = pull
          starIdx = i
        }
      }
      if (starIdx >= 0) hostIdx = starIdx
    }
  }
  // 基准 dt：绕宿主轨道周期的 1/300，限制在合理区间
  let minT = Infinity
  if (hostIdx >= 0) {
    const hb = bodies[hostIdx]
    const r = Math.hypot(ship.x - hb.x, ship.y - hb.y)
    minT = 2 * Math.PI * Math.sqrt((r * r * r) / (G * hb.mass))
  }
  const dt = isFinite(minT) ? Math.max(0.05, Math.min(minT / 300, 2.5)) : 0.5

  // 状态拷贝：所有天体的位置/速度 + 飞船（无质量）
  const n = bodies.length
  const px = new Float64Array(n)
  const py = new Float64Array(n)
  const vx = new Float64Array(n)
  const vy = new Float64Array(n)
  const ax = new Float64Array(n)
  const ay = new Float64Array(n)
  const ms = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    px[i] = bodies[i].x
    py[i] = bodies[i].y
    vx[i] = bodies[i].vx
    vy[i] = bodies[i].vy
    ms[i] = bodies[i].mass
  }
  let sx = ship.x
  let sy = ship.y
  let svx = ship.vx
  let svy = ship.vy
  let sax = 0
  let say = 0

  const eps2 = sim.config.softening * sim.config.softening
  const pts: Array<{ x: number; y: number }> = [{ x: sx, y: sy }]
  let prevAng = 0
  let acc = 0
  // 辐角参考系固定在预测宿主上（外推中同步运动），而不是每帧重选宿主——
  // 重选会导致飞船跨越两个天体中间时参考系切换，辐角方向反转、虚线提前收笔
  const refIdx = hostIdx

  // 仅飞船的加速度（用于近天体子步，天体位置可传入插值结果）
  const computeShipAccelAt = (bx: Float64Array, by: Float64Array) => {
    sax = 0
    say = 0
    for (let i = 0; i < n; i++) {
      const dxs = bx[i] - sx
      const dys = by[i] - sy
      const r2s = dxs * dxs + dys * dys + eps2
      const invRs = 1 / Math.sqrt(r2s)
      const fs = (G * ms[i]) * invRs / r2s
      sax += fs * dxs
      say += fs * dys
    }
  }

  // 标准 KDK（踢-漂-踢）蛙跳：先算加速度 → 半步速度 → 全步位置 → 重算加速度 → 半步速度
  const computeAll = () => {
    for (let i = 0; i < n; i++) {
      ax[i] = 0
      ay[i] = 0
    }
    sax = 0
    say = 0
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = px[j] - px[i]
        const dy = py[j] - py[i]
        const r2 = dx * dx + dy * dy + eps2
        const invR = 1 / Math.sqrt(r2)
        const invR3 = invR / r2
        const f = G * invR3
        ax[i] += f * dx * ms[j]
        ay[i] += f * dy * ms[j]
        ax[j] -= f * dx * ms[i]
        ay[j] -= f * dy * ms[i]
      }
      const dxs = px[i] - sx
      const dys = py[i] - sy
      const r2s = dxs * dxs + dys * dys + eps2
      const invRs = 1 / Math.sqrt(r2s)
      const fs = (G * ms[i]) * invRs / r2s
      sax += fs * dxs
      say += fs * dys
    }
  }
  computeAll()
  // 逃逸收笔用的初始相对距离
  const r0Ref = refIdx >= 0 ? Math.hypot(sy - py[refIdx], sx - px[refIdx]) : Infinity
  const pxs = new Float64Array(n)
  const pys = new Float64Array(n)
  const pxi = new Float64Array(n)
  const pyi = new Float64Array(n)
  for (let step = 0; step < maxSteps; step++) {
    // 踢半步（仅天体）
    const h = dt * 0.5
    for (let i = 0; i < n; i++) {
      vx[i] += ax[i] * h
      vy[i] += ay[i] * h
    }
    // 记录步初位置，漂全步
    for (let i = 0; i < n; i++) {
      pxs[i] = px[i]
      pys[i] = py[i]
      px[i] += vx[i] * dt
      py[i] += vy[i] * dt
    }
    // 飞船：在步初→步末位置线性插值的天体场中做自适应子步
    // 近天体时按局部轨道周期的 1/120 细分，保证引力弹弓/近距离逃逸不失真
    computeShipAccelAt(pxs, pys)
    let rem = dt
    while (rem > 1e-12) {
      // 当前最强引力源决定局部时标
      let pull = 0
      let rLocal = Infinity
      let mLocal = 0
      for (let i = 0; i < n; i++) {
        const dxs = px[i] - sx
        const dys = py[i] - sy
        const r2s = dxs * dxs + dys * dys + eps2
        if (ms[i] <= 0) continue
        const p = (G * ms[i]) / r2s
        if (p > pull) {
          pull = p
          rLocal = Math.sqrt(r2s)
          mLocal = ms[i]
        }
      }
      const tLocal = mLocal > 0 ? 2 * Math.PI * Math.sqrt((rLocal * rLocal * rLocal) / (G * mLocal)) : Infinity
      const hs = Math.min(rem, Math.max(0.01, Math.min(tLocal / 120, dt)))
      const frac = 1 - rem / dt
      for (let i = 0; i < n; i++) {
        pxi[i] = pxs[i] + (px[i] - pxs[i]) * frac
        pyi[i] = pys[i] + (py[i] - pys[i]) * frac
      }
      computeShipAccelAt(pxi, pyi)
      const hh = hs * 0.5
      svx += sax * hh
      svy += say * hh
      sx += svx * hs
      sy += svy * hs
      for (let i = 0; i < n; i++) {
        const f2 = frac + hs / dt
        pxi[i] = pxs[i] + (px[i] - pxs[i]) * f2
        pyi[i] = pys[i] + (py[i] - pys[i]) * f2
      }
      computeShipAccelAt(pxi, pyi)
      svx += sax * hh
      svy += say * hh
      rem -= hs
      // 子步密集时（近天体段）记录中间点，画出轨道的急转弯
      if (hs < dt * 0.9) pts.push({ x: sx, y: sy })
    }
    // 重算全部加速度（含飞船，供下一步前半踢使用——虽然飞船子步自算，这里保持数组同步）
    computeAll()
    // 踢半步（仅天体）
    for (let i = 0; i < n; i++) {
      vx[i] += ax[i] * h
      vy[i] += ay[i] * h
    }
    pts.push({ x: sx, y: sy })

    // 闭合判定：相对参考天体（外推中同步运动的）的辐角累计满一圈即收笔
    if (refIdx >= 0) {
      const ang = Math.atan2(sy - py[refIdx], sx - px[refIdx])
      if (step === 0) prevAng = ang
      let d = ang - prevAng
      if (d > Math.PI) d -= 2 * Math.PI
      if (d < -Math.PI) d += 2 * Math.PI
      acc += d
      prevAng = ang
      if (Math.abs(acc) > Math.PI * 1.98) break
      // 逃逸：距离拉到初始 6 倍且仍在远离，直接收笔，避免画出甩向无穷远的长线
      const rx = sx - px[refIdx]
      const ry = sy - py[refIdx]
      const rRel = Math.hypot(rx, ry)
      if (rRel > r0Ref * 6) {
        const rvx = svx - vx[refIdx]
        const rvy = svy - vy[refIdx]
        if ((rx * rvx + ry * rvy) / rRel > 0) break
      }
    }
  }
  return pts.length > 6 ? pts : null
}

function drawBody(ctx: CanvasRenderingContext2D, b: Body, zoom: number, now: number, sim: Simulation) {
  // 视觉半径：真实比例场景用 visBoost 统一放大（保持相互比例），
  // 再套一个随缩放纵小的最小像素半径，保证极端缩小时仍可点击/可见
  // 最小可视半径随光晕项让位：大天体光晕本身很大，无需地板，避免小卫星看起来和行星一样大
  const minR = (1.5 / zoom) / (1 + (b.visBoost ?? 1) * 0.2)
  const r = Math.max(b.radius * (b.visBoost ?? 1), minR)
  if (b.kind === 'ship') {
    // 三角形飞船：机头沿速度方向（静止时沿推力方向），推进时画尾焰
    const vMag = Math.hypot(b.vx, b.vy)
    const ang = vMag > 1e-4 ? Math.atan2(b.vy, b.vx) : Math.atan2(b.thrustY ?? 0, b.thrustX ?? -1)
    const L = Math.max(r * 2.2, 6 / zoom)
    const W = L * 0.55
    ctx.save()
    ctx.translate(b.x, b.y)
    ctx.rotate(ang)
    ctx.drawImage(getGlowSprite(b.glow), -L * 1.2, -L * 1.2, L * 2.4, L * 2.4)
    ctx.fillStyle = b.color
    ctx.strokeStyle = 'rgba(164,224,255,0.9)'
    ctx.lineWidth = Math.max(0.8 / zoom, L * 0.06)
    ctx.beginPath()
    ctx.moveTo(L, 0)
    ctx.lineTo(-L * 0.7, W * 0.5)
    ctx.lineTo(-L * 0.35, 0)
    ctx.lineTo(-L * 0.7, -W * 0.5)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    if (b.thrust && b.thrust > 0) {
      const fl = L * (0.9 + Math.sin(now / 40) * 0.25) * b.thrust
      const flame = ctx.createLinearGradient(-L * 0.7, 0, -L * 0.7 - fl, 0)
      flame.addColorStop(0, 'rgba(160,220,255,0.95)')
      flame.addColorStop(1, 'rgba(164,144,194,0)')
      ctx.fillStyle = flame
      ctx.beginPath()
      ctx.moveTo(-L * 0.65, W * 0.22)
      ctx.lineTo(-L * 0.7 - fl, 0)
      ctx.lineTo(-L * 0.65, -W * 0.22)
      ctx.closePath()
      ctx.fill()
    }
    ctx.restore()
    return
  }
  if (b.kind === 'star') {
    // 外层光晕（精灵缓存）
    const glowR = r * 4.5
    ctx.drawImage(getGlowSprite(b.glow), b.x - glowR, b.y - glowR, glowR * 2, glowR * 2)
    // 星体核心
    const core = ctx.createRadialGradient(b.x - r * 0.3, b.y - r * 0.3, 0, b.x, b.y, r)
    core.addColorStop(0, '#ffffff')
    core.addColorStop(0.55, b.color)
    core.addColorStop(1, b.color)
    ctx.fillStyle = core
    ctx.beginPath()
    ctx.arc(b.x, b.y, r, 0, Math.PI * 2)
    ctx.fill()
  } else if (b.kind === 'blackhole') {
    // 吸积辉光（随时间轻微脉动，质量越大光晕越大 → 星系核的隆起）
    const pulse = 1 + Math.sin(now / 480 + b.id) * 0.06
    const glowR = r * (5 + Math.cbrt(b.mass) * 0.35) * pulse
    ctx.drawImage(getGlowSprite(b.glow), b.x - glowR, b.y - glowR, glowR * 2, glowR * 2)
    // 事件视界
    ctx.fillStyle = '#020108'
    ctx.beginPath()
    ctx.arc(b.x, b.y, r, 0, Math.PI * 2)
    ctx.fill()
    // 光子环
    ctx.strokeStyle = 'rgba(230,230,250,0.9)'
    ctx.lineWidth = Math.max(1, r * 0.16)
    ctx.beginPath()
    ctx.arc(b.x, b.y, r * 1.12, 0, Math.PI * 2)
    ctx.stroke()
    // 吸积盘弧
    const spin = now / 900 + b.id * 2
    ctx.strokeStyle = 'rgba(176,147,214,0.8)'
    ctx.lineWidth = Math.max(0.8, r * 0.1)
    ctx.beginPath()
    ctx.ellipse(b.x, b.y, r * 2.1, r * 0.72, -0.35, spin, spin + Math.PI * 1.15)
    ctx.stroke()
  } else {
    // 行星 / 小行星：朝向最近恒星的方向打光
    let lx = -0.6
    let ly = -0.6
    let best = Infinity
    for (const s of sim.bodies) {
      if (s.kind !== 'star' && s.kind !== 'blackhole') continue
      const dx = s.x - b.x
      const dy = s.y - b.y
      const d2 = dx * dx + dy * dy
      if (d2 < best) {
        best = d2
        const d = Math.sqrt(d2) || 1
        lx = dx / d
        ly = dy / d
      }
    }
    // 潮汐形变：被拉长成椭球（沿引力方向），自旋时画赤道标记
    const tidal = b.tidal ?? 0
    const spin = b.spin ?? 0
    if (tidal > 0.05) {
      // 找到潮汐来源方向
      let tdx = 0
      let tdy = 0
      let bestD = Infinity
      for (const h of sim.bodies) {
        if (h === b || h.mass < b.mass * 50) continue
        const dx = h.x - b.x
        const dy = h.y - b.y
        const d2 = dx * dx + dy * dy
        if (d2 < bestD) { bestD = d2; tdx = dx; tdy = dy }
      }
      const ang = Math.atan2(tdy, tdx)
      const stretch = 1 + tidal * 0.8
      ctx.save()
      ctx.translate(b.x, b.y)
      ctx.rotate(ang)
      if (b.kind === 'planet' || b.kind === 'moon') {
        const g = ctx.createRadialGradient(lx * r * 0.7, ly * r * 0.7, r * 0.1, 0, 0, r * stretch)
        g.addColorStop(0, '#ffffff')
        g.addColorStop(0.35, b.color)
        g.addColorStop(1, '#120c22')
        ctx.fillStyle = g
      } else {
        ctx.fillStyle = b.color
      }
      ctx.beginPath()
      ctx.ellipse(0, 0, r * stretch, r / Math.sqrt(stretch), 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    } else {
      // 正常球形
      if (b.kind === 'planet' || b.kind === 'moon') {
        const g = ctx.createRadialGradient(b.x + lx * r * 0.7, b.y + ly * r * 0.7, r * 0.1, b.x, b.y, r)
        g.addColorStop(0, '#ffffff')
        g.addColorStop(0.35, b.color)
        g.addColorStop(1, '#120c22')
        ctx.fillStyle = g
      } else {
        ctx.fillStyle = b.color
      }
      ctx.beginPath()
      ctx.arc(b.x, b.y, Math.max(r, b.kind === 'asteroid' ? 1.6 / zoom : 0), 0, Math.PI * 2)
      ctx.fill()
    }
    if (b.kind === 'planet' || b.kind === 'moon') {
      ctx.strokeStyle = b.glow
      ctx.lineWidth = 1 / zoom
      ctx.stroke()
    }
    // 自旋指示：赤道短线（仅行星/卫星，潮汐形变时跳过）
    if (Math.abs(spin) > 0.01 && tidal <= 0.05 && (b.kind === 'planet' || b.kind === 'moon')) {
      const phase = now * spin * 0.1
      ctx.save()
      ctx.translate(b.x, b.y)
      ctx.rotate(phase)
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'
      ctx.lineWidth = Math.max(0.8 / zoom, r * 0.08)
      ctx.beginPath()
      ctx.moveTo(-r * 0.7, 0)
      ctx.lineTo(r * 0.7, 0)
      ctx.stroke()
      ctx.restore()
    }
  }
}
