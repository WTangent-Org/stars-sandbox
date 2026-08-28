/** 用户偏好设置：localStorage 持久化，跨会话保留 */
import type { PerfTier } from './types'

export interface Prefs {
  /** 摇杆模式：fixed=固定位置；float=随手移动（触点在侧区哪，摇杆就在哪） */
  joyMode: 'fixed' | 'float'
  /** 摇杆位置：left/right（固定模式下生效；浮动模式决定触发热区） */
  joySide: 'left' | 'right'
  /** 预演缓冲领先时长（秒）：越长飞船未来轨迹画越远（离线单机时生效） */
  leadSeconds: number
  /** 联机房间号：空 = 公共大厅 */
  roomCode: string
  /** 客户端性能档位：auto = 按 FPS 自动调节（自动上限「高」），「极致」手动专属 */
  perfTier: PerfTier | 'auto'
}

const KEY = 'nbody-prefs-v2'

export const DEFAULT_PREFS: Prefs = {
  joyMode: 'fixed',
  joySide: 'left',
  leadSeconds: 10,
  roomCode: '',
  perfTier: 'auto',
}

const PERF_VALUES: Array<PerfTier | 'auto'> = ['auto', 'ultra', 'high', 'balanced', 'low', 'saver']

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULT_PREFS }
    const p = JSON.parse(raw)
    return {
      joyMode: p.joyMode === 'float' ? 'float' : 'fixed',
      joySide: p.joySide === 'right' ? 'right' : 'left',
      leadSeconds: [3, 6, 10, 20].includes(p.leadSeconds) ? p.leadSeconds : 10,
      roomCode: typeof p.roomCode === 'string' ? p.roomCode : '',
      perfTier: PERF_VALUES.includes(p.perfTier) ? p.perfTier : 'auto',
    }
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

export function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p))
  } catch {
    /* 隐私模式等场景静默失败 */
  }
}
