/**
 * 轨迹与特效维护：engine（权威/离线积分）、net（插值降级）、future（影子模拟）
 * 三处共用同一套采样/裁剪/老化规则——此前是三份常数还不一致的实现。
 */
import type { Body, TrailPoint } from './types'
import { TRAIL } from './config'

/** 轨迹采样上限：多天体场景用短轨迹（性能档已由 perf.trailMax 覆盖，这里兜底） */
export function trailCap(bodies: number): number {
  return bodies > TRAIL.manyBodies ? TRAIL.maxPointsMany : TRAIL.maxPoints
}

/** 追加一个轨迹点：间距不足跳过；超限按步长裁剪。zoom 控制屏幕上间距恒定 */
export function recordTrail(
  cfg: { trails: boolean; trailsForever: boolean },
  b: Body,
  x: number,
  y: number,
  zoom: number,
  bodies: number,
) {
  if (!cfg.trails) return
  const last = b.trail[b.trail.length - 1]
  const dx = x - (last?.x ?? Infinity)
  const dy = y - (last?.y ?? Infinity)
  const spacing2 = (Math.max(TRAIL.spacing / zoom, 1e-6) * 1.5) ** 2
  if (dx * dx + dy * dy > spacing2) {
    b.trail.push({ x, y })
    if (!cfg.trailsForever && b.trail.length > trailCap(bodies)) b.trail.splice(0, TRAIL.trimStep)
  }
}

/** 特效老化：按真实时间推进 age 并过滤过期 */
export function ageEffects<T extends { age: number; ttl: number }>(effects: T[], dt: number): T[] {
  for (const e of effects) e.age += dt
  return effects.filter((e) => e.age < e.ttl)
}

export type { TrailPoint }
