/**
 * 数值格式化：HUD/存档/创建页共用一套（此前 StatsBar/Dock/Home 各自为政，
 * 同名 fmtMass 在两处有不同语义、fmtSimTime 与 fmtTime/fmtRealTime 重复）。
 */
import type { UnitProfile } from './types'

/** 沙盒质量（任意单位）缩写 */
export function fmtMass(m: number): string {
  if (m >= 10000) return (m / 1000).toFixed(1) + 'k'
  if (m >= 100) return m.toFixed(0)
  if (m >= 1) return m.toFixed(2)
  if (m >= 0.001) return m.toFixed(4)
  return m.toExponential(1)
}

/** 无单位模拟时间缩写 */
export function fmtTime(t: number): string {
  if (t < 1000) return t.toFixed(1)
  if (t < 100000) return t.toFixed(0)
  return t.toExponential(2)
}

/** 真实单位时间：天 / 年 */
export function fmtRealTime(days: number): string {
  if (days < 730) return days.toFixed(0) + ' 天'
  return (days / 365.25).toFixed(2) + ' 年'
}

/** 真实单位质量：科学计数 kg */
export function fmtRealMass(kg: number): string {
  if (!(kg > 0)) return '0kg'
  const e = Math.floor(Math.log10(kg))
  const m = kg / Math.pow(10, e)
  return `${m.toFixed(2)}e${e}kg`
}

/** 缩放读数 */
export function fmtZoom(z: number): string {
  if (z >= 100) return z.toFixed(0) + '×'
  if (z >= 1) return z.toFixed(2) + '×'
  return z.toFixed(3) + '×'
}

/** T+ 读数：有真实单位时换算天/年，否则按模拟时间缩写 */
export function fmtSimTime(t: number, units?: UnitProfile): string {
  if (units) return fmtRealTime(t * units.timeDays)
  return fmtTime(t)
}
