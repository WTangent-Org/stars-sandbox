import type { PresetId, UnitProfile } from './types'
import type { Simulation } from './engine'

export interface PresetMeta {
  id: PresetId
  label: string
  desc: string
}

export const PRESETS: PresetMeta[] = [
  { id: 'real', label: '真实太阳系', desc: 'JPL 星历 · 当天真实方位 · 等比缩放' },
  { id: 'solar', label: '演示太阳系', desc: '1 颗恒星 + 8 颗行星与卫星' },
  { id: 'binary', label: '双星系统', desc: '相互环绕的双星与环双星行星' },
  { id: 'triple', label: '三星混沌', desc: '三体问题的混沌之舞' },
  { id: 'galaxy', label: '旋涡星系', desc: '中心黑洞 + 550 颗恒星' },
  { id: 'collision', label: '星系碰撞', desc: '两个星系的引力对决' },
  { id: 'empty', label: '空白宇宙', desc: '从零开始创造你的星系' },
]

function rand(seed: { v: number }) {
  seed.v = (seed.v * 16807) % 2147483647
  return (seed.v - 1) / 2147483646
}

/* ================= 真实太阳系：JPL 近似开普勒轨道要素 =================
 * 数据来源：JPL "Keplerian Elements for Approximate Positions of the Major Planets"
 * 要素 = J2000 值 + 每世纪变化率，历元取当前日期。
 * 等比缩放：距离 ×1e-9，质量 ×1e-27，G' = 0.527
 *   → 速度 = 真实值 × 8.9e-5，1 模拟时间单位 ≈ 1.03 真实天（物理自洽）
 */

const LY = 1e-9 // 距离缩放 m → 单位
const LM = 1e-27 // 质量缩放 kg → 单位
const G_REAL = 0.527
const AU_SIM = 1.496e11 * LY // 149.6

export const REAL_UNITS: UnitProfile = {
  massKg: 1e27,
  distM: 1e9,
  velMs: 1 / 8.9e-5, // 1 模拟速度单位 = 11236 m/s
  timeDays: 1.03,
}

// [名称, a(AU), e, L(°), ϖ(°), Δa, Δe, ΔL, Δϖ, 质量(kg), 半径(m), 颜色]
type PlanetRow = [string, number, number, number, number, number, number, number, number, number, number, string]

const REAL_PLANETS: PlanetRow[] = [
  ['水星', 0.38709927, 0.20563593, 252.2503235, 77.45779628, 0.00000037, 0.00001906, 149472.67411175, 0.16047689, 3.301e23, 2.4397e6, '#b8a08a'],
  ['金星', 0.72333566, 0.00677672, 181.9790995, 131.60246718, 0.0000039, -0.00004107, 58517.81538729, 0.00268329, 4.867e24, 6.0518e6, '#e0b56a'],
  ['地球', 1.00000261, 0.01671123, 100.46457166, 102.93768193, 0.00000562, -0.00004392, 35999.37244981, 0.32327364, 5.972e24, 6.371e6, '#6fa8dc'],
  ['火星', 1.52371034, 0.0933941, -4.55343205, -23.94362959, 0.00001847, 0.00007882, 19140.30268499, 0.44441088, 6.417e23, 3.3895e6, '#c97e5a'],
  ['木星', 5.202887, 0.04838624, 34.39644051, 14.72847983, -0.00011607, -0.00013253, 3034.74612775, 0.21252668, 1.898e27, 6.9911e7, '#d9b380'],
  ['土星', 9.53667594, 0.05386179, 49.95424423, 92.59887831, -0.0012506, -0.00050991, 1222.49362201, -0.41897216, 5.683e26, 5.8232e7, '#d9c98f'],
  ['天王星', 19.18916464, 0.04725744, 313.23810451, 170.9542763, -0.00196176, -0.00004397, 428.48202785, 0.40805281, 8.681e25, 2.5362e7, '#8fc7c9'],
  ['海王星', 30.06992276, 0.00859048, -55.12002969, 44.96476227, 0.00026291, 0.00005105, 218.45945325, -0.32241464, 1.024e26, 2.4622e7, '#7f9fd9'],
]

/** J2000 (2000-01-01 12:00 UTC) 起算的天数 */
function daysSinceJ2000(): number {
  return Date.now() / 86400000 - 10957.5
}

/** 解开普勒方程 M = E - e·sinE（Newton 迭代） */
function solveKepler(M: number, e: number): number {
  let E = M
  for (let i = 0; i < 8; i++) {
    E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E))
  }
  return E
}

const D2R = Math.PI / 180

/** 行星在历元 d（天）的日心黄道面位置（AU），投影到黄道面 */
function planetPos(p: PlanetRow, dDays: number): [number, number] {
  const T = dDays / 36525
  const a = p[1] + p[5] * T
  const e = p[2] + p[6] * T
  const L = (p[3] + p[7] * T) * D2R
  const lp = (p[4] + p[8] * T) * D2R // 近日点经度
  const M = L - lp
  const E = solveKepler(M, e)
  const nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2))
  const r = a * (1 - e * Math.cos(E))
  const lam = lp + nu // 日心黄经（忽略轨道倾角，2D 投影）
  return [r * Math.cos(lam), r * Math.sin(lam)]
}

/** 行星日心速度（AU/天），数值微分 */
function planetVel(p: PlanetRow, dDays: number): [number, number] {
  const h = 0.05
  const [x1, y1] = planetPos(p, dDays - h)
  const [x2, y2] = planetPos(p, dDays + h)
  return [(x2 - x1) / (2 * h), (y2 - y1) / (2 * h)]
}

/** 月球地心位置（km）与速度（km/天）：低精度月球黄经公式，2D 投影 */
function moonGeo(dDays: number): { pos: [number, number]; vel: [number, number] } {
  const f = (d: number): [number, number] => {
    const Lm = (218.316 + 13.176396 * d) * D2R // 平黄经
    const Mm = (134.963 + 13.064993 * d) * D2R // 平近点角
    const nu = Mm + 2 * 0.0549 * Math.sin(Mm) // 真近点角（一阶）
    const a = 384400 // km
    const e = 0.0549
    const r = (a * (1 - e * e)) / (1 + e * Math.cos(nu))
    const lam = Lm - Mm + nu
    return [r * Math.cos(lam), r * Math.sin(lam)]
  }
  const h = 0.02
  const [x1, y1] = f(dDays - h)
  const [x2, y2] = f(dDays + h)
  return { pos: f(dDays), vel: [(x2 - x1) / (2 * h), (y2 - y1) / (2 * h)] }
}

/** AU/天 → 模拟速度：1 时间单位 ≈ 1.03 天，故 1 AU/天 = AU_SIM × 1.03（每时间单位） */
const AU_PER_DAY_TO_SIM = AU_SIM * REAL_UNITS.timeDays

// 视觉半径倍率：真实天体半径在沙盒里只有千分之几单位，统一放大才能看清——
// 恒星/行星/卫星比例不变（卫星不会被地板项抬到行星那么大，渲染层有对应处理）。
const RADIUS_BOOST = 15
const PLANET_BOOST = 8 // 行星/卫星的真实半径较小，给得比恒星低一档，避免反超恒星

function loadRealSolar(sim: Simulation): { zoom: number } {
  const d = daysSinceJ2000()
  sim.config.G = G_REAL
  sim.config.softening = 0.02
  sim.config.timeScale = 40

  // 太阳
  sim.addBody({
    kind: 'star',
    x: 0,
    y: 0,
    mass: 1.989e30 * LM, // 1989
    radius: 6.957e8 * LY,
    visBoost: RADIUS_BOOST,
    name: '太阳',
  })

  let earth: { x: number; y: number; vx: number; vy: number } | null = null

  for (const p of REAL_PLANETS) {
    const [px, py] = planetPos(p, d)
    const [vx, vy] = planetVel(p, d)
    const body = sim.addBody({
      kind: 'planet',
      x: px * AU_SIM,
      y: py * AU_SIM,
      vx: vx * AU_PER_DAY_TO_SIM,
      vy: vy * AU_PER_DAY_TO_SIM,
      mass: p[9] * LM,
      radius: p[10] * LY,
      visBoost: PLANET_BOOST,
      name: p[0],
      color: p[11],
      glow: `${p[11]}59`,
    })
    if (p[0] === '地球') earth = body
  }

  // 月球：真实地月距离（0.384 单位 = 地球的 0.26 希尔球，与真实一致）
  if (earth) {
    const mg = moonGeo(d)
    const kmToSim = 1e3 * LY // km → 模拟距离
    sim.addBody({
      kind: 'moon',
      x: earth.x + mg.pos[0] * kmToSim,
      y: earth.y + mg.pos[1] * kmToSim,
      vx: earth.vx + mg.vel[0] * kmToSim * REAL_UNITS.timeDays,
      vy: earth.vy + mg.vel[1] * kmToSim * REAL_UNITS.timeDays,
      mass: 7.342e22 * LM,
      radius: 1.7374e6 * LY,
      visBoost: PLANET_BOOST,
      solid: false,
      name: '月球',
      color: '#c9c4bd',
      glow: 'rgba(200,195,190,0.3)',
    })
  }
  // 飞船：从地球附近出发，速度略高于地球公转 → 一条略外扩的日心轨道，方便练习变轨
  if (earth) {
    const sx = earth.x + 0.5
    const sy = earth.y + 0.5
    const d = Math.hypot(sx, sy)
    sim.addBody({
      kind: 'ship',
      x: sx,
      y: sy,
      // 日心圆轨道速度的 1.02 倍，沿切向
      vx: (-sy / d) * Math.sqrt((G_REAL * 1989) / d) * 1.02,
      vy: (sx / d) * Math.sqrt((G_REAL * 1989) / d) * 1.02,
      mass: 3e3 * LM,
      solid: false,
      name: '飞船 · 远征号',
    })
  }
  return { zoom: 0.15 } // 海王星轨道 ~30AU≈4488 单位，缩到一屏内
}

// 示踪恒星色表（暖白 / 蓝白 / 金 / 橙），权重加权
const TRACER_STARS: Array<[string, string, number]> = [
  ['#ffe9c9', 'rgba(255,233,201,0.45)', 0.52],
  ['#bcd6ff', 'rgba(188,214,255,0.45)', 0.22],
  ['#ffd76e', 'rgba(255,215,110,0.45)', 0.16],
  ['#ff8a5c', 'rgba(255,138,92,0.45)', 0.1],
]

function pickTracer(r: number): [string, string] {
  let acc = 0
  for (const [c, g, w] of TRACER_STARS) {
    acc += w
    if (r <= acc) return [c, g]
  }
  return [TRACER_STARS[0][0], TRACER_STARS[0][1]]
}


/** 旋涡星系生成器：中心黑洞 + 示踪恒星盘（无碰撞系统）。galaxy / collision 两个预设共用 */
function makeTracerGalaxy(
  sim: Simulation,
  opts: { cx: number; cy: number; vx: number; vy: number; tilt: number; coreMass: number; coreName: string; radius: number; count: number; seed: { v: number }; squash?: number; spiral: number },
) {
  const { squash = 1 } = opts
  const bh = sim.addBody({ kind: 'blackhole', x: opts.cx, y: opts.cy, vx: opts.vx, vy: opts.vy, mass: opts.coreMass, name: opts.coreName })
  const rs = bh.radius
  for (let i = 0; i < opts.count; i++) {
    const t = rand(opts.seed)
    const r = opts.radius * 0.12 + opts.radius * Math.pow(t, 0.8)
    const arm = i % 2
    const theta = r * opts.spiral + arm * Math.PI + (rand(opts.seed) - 0.5) * 0.7
    const lx = Math.cos(theta) * r
    const ly = Math.sin(theta) * r * squash
    const x = opts.cx + lx * Math.cos(opts.tilt) - ly * Math.sin(opts.tilt)
    const y = opts.cy + lx * Math.sin(opts.tilt) + ly * Math.cos(opts.tilt)
    // PW 势下的圆轨道速度：v = sqrt(GM/r) · r/(r−r_s)，相对论开时内侧引力更强
    const v = Math.sqrt((G * opts.coreMass) / r) * (r / Math.max(r - rs, r * 0.2))
    const lvx = -Math.sin(theta) * v
    const lvy = Math.cos(theta) * v * squash
    const mass = 0.4 + rand(opts.seed) * rand(opts.seed) * 3
    const [color, glow] = pickTracer(rand(opts.seed))
    sim.addBody({
      kind: 'star',
      x,
      y,
      vx: opts.vx + lvx * Math.cos(opts.tilt) - lvy * Math.sin(opts.tilt),
      vy: opts.vy + lvx * Math.sin(opts.tilt) + lvy * Math.cos(opts.tilt),
      mass,
      color,
      glow,
      radius: 1.8 + rand(opts.seed) * 1.6,
      solid: false,
    })
  }
}

/** 所有预设统一 G=1（真实太阳系预设自行覆盖为 G_REAL） */
const G = 1

export function loadPreset(sim: Simulation, id: PresetId): { zoom: number; units?: UnitProfile } {
  sim.reset()
  sim.config.G = G
  sim.config.softening = 3

  switch (id) {
    case 'real': {
      const r = loadRealSolar(sim)
      return { ...r, units: REAL_UNITS }
    }
    case 'solar': {
      const M = 1000
      sim.config.softening = 0.4
      sim.addBody({ kind: 'star', x: 0, y: 0, mass: M, name: '恒星 · 曦' })
      const planets: Array<[string, number, number, string]> = [
        ['水星', 78, 0.05, '#b8a08a'],
        ['金星', 108, 0.08, '#e0b56a'],
        ['地球', 142, 1.0, '#6fa8dc'],
        ['火星', 178, 0.04, '#c97e5a'],
        ['木星', 245, 1.6, '#d9b380'],
        ['土星', 318, 0.7, '#d9c98f'],
        ['天王星', 392, 0.22, '#8fc7c9'],
        ['海王星', 462, 0.26, '#7f9fd9'],
      ]
      planets.forEach(([name, d, m, color], i) => {
        const ang = (i / planets.length) * Math.PI * 2 + 0.4
        const x = Math.cos(ang) * d
        const y = Math.sin(ang) * d
        const v = Math.sqrt((G * M) / d)
        const p = sim.addBody({
          kind: 'planet',
          x,
          y,
          vx: -Math.sin(ang) * v,
          vy: Math.cos(ang) * v,
          mass: m,
          name,
          color,
          glow: `${color}59`,
        })
        if (name === '地球' || name === '木星') {
          // 卫星：宿主当前速度 + 绕宿主的圆轨道速度（沿轨道切向）。
          // 距离取宿主希尔球内 ~1/4，永不逃逸；solid:false 避免紧贴时误触发碰撞。
          const md = name === '地球' ? 2.0 : 4.5
          const mm = name === '地球' ? 0.03 : 0.06
          const mv = Math.sqrt((G * m) / md)
          const tx = -Math.sin(ang)
          const ty = Math.cos(ang)
          sim.addBody({
            kind: 'moon',
            x: x + md,
            y,
            vx: p.vx + tx * mv,
            vy: p.vy + ty * mv,
            mass: mm,
            radius: name === '地球' ? 0.9 : 1.1,
            solid: false,
            name: name === '地球' ? '月球' : '木卫一',
            color: '#c9c4bd',
            glow: 'rgba(200,195,190,0.3)',
          })
        }
      })
      sim.config.timeScale = 30
      return { zoom: 1, units: REAL_UNITS }
    }

    case 'binary': {
      const m = 420
      const d = 300
      const v = Math.sqrt((G * m) / (2 * d))
      sim.addBody({ kind: 'star', x: -d / 2, y: 0, vy: v, mass: m, name: '恒星 · 天璇' })
      sim.addBody({ kind: 'star', x: d / 2, y: 0, vy: -v, mass: m, name: '恒星 · 天枢' })
      const ring = [
        { d: 470, m: 0.4, color: '#b093d6' },
        { d: 560, m: 0.2, color: '#7fb5d9' },
        { d: 660, m: 0.5, color: '#d9c27f' },
      ]
      ring.forEach((r, i) => {
        const ang = i * 2.1 + 0.7
        const vv = Math.sqrt((G * m * 2) / r.d)
        sim.addBody({
          kind: 'planet',
          x: Math.cos(ang) * r.d,
          y: Math.sin(ang) * r.d,
          vx: -Math.sin(ang) * vv,
          vy: Math.cos(ang) * vv,
          mass: r.m,
          color: r.color,
          glow: `${r.color}59`,
        })
      })
      sim.config.timeScale = 30
      return { zoom: 0.85, units: REAL_UNITS }
    }

    case 'triple': {
      // 低角动量三角开局：三颗星反复塌缩纠缠、近距擦肩，
      // 经历约三十余次近距离接触后才逐渐分出双星+逃逸者——典型混沌
      const m = 400
      const R = 260
      const v = Math.sqrt((G * m) / R) * 0.25
      for (let i = 0; i < 3; i++) {
        const ang = (i / 3) * Math.PI * 2
        const x = Math.cos(ang) * R
        const y = Math.sin(ang) * R
        sim.addBody({
          kind: 'star',
          x,
          y,
          vx: -Math.sin(ang) * v,
          vy: Math.cos(ang) * v,
          mass: m,
          name: ['恒星 · 玉衡', '恒星 · 开阳', '恒星 · 摇光'][i],
        })
      }
      sim.config.timeScale = 24
      return { zoom: 0.9, units: REAL_UNITS }
    }

    case 'galaxy': {
      const seed = { v: 42 }
      sim.addBody({ kind: 'blackhole', x: 0, y: 0, mass: 20000, name: '超大质量黑洞 · 银心' })
      // 示踪恒星：轻质量 + 非实体（真实星系是无碰撞系统，恒星不会互相撞上）
      for (let i = 0; i < 550; i++) {
        const t = rand(seed)
        const r = 110 + 570 * Math.pow(t, 0.75)
        const arm = i % 2
        const theta = r * 0.016 + arm * Math.PI + (rand(seed) - 0.5) * (0.35 + 70 / r)
        const v = Math.sqrt((G * 20000) / r) * 1.02
        const mass = 0.4 + rand(seed) * rand(seed) * 4
        const [color, glow] = pickTracer(rand(seed))
        sim.addBody({
          kind: 'star',
          x: Math.cos(theta) * r + (rand(seed) - 0.5) * 10,
          y: Math.sin(theta) * r + (rand(seed) - 0.5) * 10,
          vx: -Math.sin(theta) * v,
          vy: Math.cos(theta) * v,
          mass,
          color,
          glow,
          radius: 2.2 + rand(seed) * 1.8,
          solid: false,
        })
      }
      sim.config.timeScale = 40
      sim.config.softening = 25
      sim.config.trails = false
      return { zoom: 0.55, units: REAL_UNITS }
    }

    case 'collision': {
      const seed = { v: 7 }
      // 非对心相遇：约 700 的碰撞参数，先掠飞、拉出潮汐尾，再回旋并合
      makeTracerGalaxy(sim, { cx: -560, cy: -40, vx: 0.75, vy: 0.7, tilt: 0.5, coreMass: 5200, coreName: '星系核 · 阿贝尔-A', radius: 216, count: 130, seed, spiral: 0.045 })
      makeTracerGalaxy(sim, { cx: 560, cy: 40, vx: -0.75, vy: -0.7, tilt: -0.9, coreMass: 5200, coreName: '星系核 · 阿贝尔-B', radius: 216, count: 130, seed, spiral: 0.045, squash: 0.55 })
      sim.config.timeScale = 50
      sim.config.softening = 20
      sim.config.trails = false
      return { zoom: 0.42, units: REAL_UNITS }
    }

    case 'empty':
    default:
      sim.config.timeScale = 30
      return { zoom: 1, units: REAL_UNITS }
  }
}
