/**
 * 轨道数学：引力主导者解析、圆轨道速度、逃逸速度、双星质心。
 * engine（行星点燃轨道）、Home（飞船部署/生成）、renderer（质心标记）共用，
 * 避免三处各自维护一份 sqrt(GM/d)。
 */
import type { Body } from './types'
import type { Simulation } from './engine'

export interface OrbitHostInfo {
  x: number
  y: number
  vx: number
  vy: number
  mass: number
  radius: number
  name: string
  kind: Body['kind']
}

/** 圆轨道速度大小：v = √(GM/d) */
export function circularOrbitSpeed(G: number, mass: number, d: number): number {
  return Math.sqrt((G * mass) / d)
}

/** 逃逸速度大小：v = √(2GM/d) */
export function escapeSpeed(G: number, mass: number, d: number): number {
  return Math.sqrt((2 * G * mass) / Math.max(d, 1e-9))
}

/** 位置 (x,y) 相对宿主的圆轨道速度向量（沿轨道切向、与宿主速度叠加） */
export function circularOrbitVelocity(
  G: number,
  host: { x: number; y: number; vx: number; vy: number; mass: number },
  x: number,
  y: number,
): { vx: number; vy: number } {
  const dx = x - host.x
  const dy = y - host.y
  const d = Math.hypot(dx, dy) || 1
  const v = circularOrbitSpeed(G, host.mass, d)
  return { vx: host.vx + (-dy / d) * v, vy: host.vy + (dx / d) * v }
}

/** 双星质心（质量加权） */
export function barycenter(a: Body, b: Body): { x: number; y: number } {
  const M = a.mass + b.mass
  return { x: (a.x * a.mass + b.x * b.mass) / M, y: (a.y * a.mass + b.y * b.mass) / M }
}

/**
 * 轨道宿主解析：找到引力主导者后，若它正处在紧密双星中（伴星质量不可忽略、
 * 双星间距远小于目标到它的距离），则改用双星质心（合成位置/速度/总质量）。
 * 这解决了双星系统里行星/恒星轨道根数乱跳的问题。
 */
export function resolveOrbitHost(sim: Simulation, x: number, y: number, excludeId?: number): OrbitHostInfo | null {
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
  if (!partner) {
    return { x: host.x, y: host.y, vx: host.vx, vy: host.vy, mass: host.mass, radius: host.radius, name: host.name, kind: host.kind }
  }
  const M = host.mass + partner.mass
  const c = barycenter(host, partner)
  return {
    x: c.x,
    y: c.y,
    vx: (host.vx * host.mass + partner.vx * partner.mass) / M,
    vy: (host.vy * host.mass + partner.vy * partner.mass) / M,
    mass: M,
    radius: Math.max(host.radius, partner.radius),
    name: `${host.name}+${partner.name} 质心`,
    kind: 'star' as const,
  }
}
