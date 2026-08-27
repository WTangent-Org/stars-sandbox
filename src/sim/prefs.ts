/** 用户偏好设置：localStorage 持久化，跨会话保留 */
export interface Prefs {
  /** 摇杆模式：fixed=固定位置；float=随手移动（触点在侧区哪，摇杆就在哪） */
  joyMode: 'fixed' | 'float'
  /** 摇杆位置：left/right（固定模式下生效；浮动模式决定触发热区） */
  joySide: 'left' | 'right'
  /** 预演缓冲领先时长（秒）：越长飞船未来轨迹画越远 */
  leadSeconds: number
  /** 运行位置：local=浏览器本地跑物理；remote=连服务器跑（浏览器只渲染） */
  runMode: 'local' | 'remote'
  /** 远程服务器地址（host:port 或 ws:// 完整地址） */
  serverAddr: string
}

const KEY = 'nbody-prefs-v1'

export const DEFAULT_PREFS: Prefs = {
  joyMode: 'fixed',
  joySide: 'left',
  leadSeconds: 10,
  runMode: 'local',
  serverAddr: '',
}

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULT_PREFS }
    const p = JSON.parse(raw)
    return {
      joyMode: p.joyMode === 'float' ? 'float' : 'fixed',
      joySide: p.joySide === 'right' ? 'right' : 'left',
      leadSeconds: [3, 6, 10, 20].includes(p.leadSeconds) ? p.leadSeconds : 10,
      runMode: p.runMode === 'remote' ? 'remote' : 'local',
      serverAddr: typeof p.serverAddr === 'string' ? p.serverAddr : '',
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
