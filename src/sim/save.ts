/** 世界状态的纯校验（服务器 hostsave 与客户端导入共用；不依赖浏览器 API）。文件导入导出见 saveFile.ts。 */
import type { BodyKind, WorldState } from './types'

const KINDS: readonly BodyKind[] = ['star', 'planet', 'moon', 'asteroid', 'blackhole', 'ship']
/** 有限数且在绝对值域内（NaN/Infinity 会永久污染权威模拟） */
function fin(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
}

/** 校验并收窄一份外部世界状态（导入文件 / hostsave）。逐字段检查 kind 白名单与数值有限性 */
export function validateWorldState(raw: unknown): WorldState | null {
  if (typeof raw !== 'object' || raw === null) return null
  const s = raw as Partial<WorldState>
  if (s.version !== 1) return null
  if (!s.config || !fin(s.config.G, 0, 100) || !fin(s.config.timeScale, 0, 5000)) return null
  if (!Array.isArray(s.bodies) || s.bodies.length > 2500) return null
  const ids = new Set<number>()
  for (const b of s.bodies) {
    if (!b || !KINDS.includes(b.kind)) return null
    if (typeof b.id !== 'number' || !Number.isInteger(b.id) || b.id < 0) return null
    if (ids.has(b.id)) return null
    ids.add(b.id)
    if (!fin(b.x, -1e7, 1e7) || !fin(b.y, -1e7, 1e7)) return null
    if (!fin(b.mass, 1e-9, 2e6)) return null
    if (!fin(b.radius, 0, 1e6)) return null
    if (b.vx != null && !fin(b.vx, -1e4, 1e4)) return null
    if (b.vy != null && !fin(b.vy, -1e4, 1e4)) return null
    if (typeof b.name === 'string' && b.name.length > 40) return null
  }
  return s as WorldState
}
