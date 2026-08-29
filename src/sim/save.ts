/** 世界状态的纯校验（服务器 hostsave 与客户端导入共用；不依赖浏览器 API）。文件导入导出见 saveFile.ts。 */
import type { WorldState } from './types'

/** 校验并收窄一份外部世界状态（导入文件 / hostsave 前的客户端自检） */
export function validateWorldState(raw: unknown): WorldState | null {
  if (typeof raw !== 'object' || raw === null) return null
  const s = raw as Partial<WorldState>
  if (s.version !== 1) return null
  if (!s.config || typeof s.config.G !== 'number') return null
  if (!Array.isArray(s.bodies) || s.bodies.length > 5000) return null
  for (const b of s.bodies) {
    if (typeof b?.id !== 'number' || typeof b?.x !== 'number' || typeof b?.mass !== 'number' || !b?.kind) return null
  }
  return s as WorldState
}
