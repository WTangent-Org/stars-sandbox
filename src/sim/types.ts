export type BodyKind = 'star' | 'planet' | 'moon' | 'asteroid' | 'blackhole' | 'ship'

export interface TrailPoint {
  x: number
  y: number
}

export interface Body {
  id: number
  name: string
  kind: BodyKind
  x: number
  y: number
  vx: number
  vy: number
  ax: number
  ay: number
  mass: number
  radius: number
  /** 视觉半径倍率：仅用于渲染，不影响物理与碰撞。真实比例场景下天体半径
   *  在沙盒单位里只有千分之几，统一放大 N 倍才能看清——比例不变，仍等比 */
  visBoost?: number
  color: string
  glow: string
  /** 是否参与碰撞合并。星系示踪恒星为 false（真实星系是无碰撞系统，恒星彼此穿过） */
  solid: boolean
  /** 被用户抓取拖拽时暂停物理积分，跟随指针 */
  held?: boolean
  /** 碎片/新生的冷却（帧数）：刚由撕碎/撞击产生时不立即再次碰撞，
   *  防止碎片云在生成瞬间雪崩式级联 */
  cooldown?: number
  /** 自旋角速度（rad/模拟秒）：撞击的切向摩擦产生，影响后续碰撞响应 */
  spin?: number
  /** 潮汐形变 0..1：0=球形，1=极度拉长（洛希极限附近），用于渲染椭球 */
  tidal?: number
  /** 飞船：当前推进器油门 0..1 与推力方向（世界坐标单位向量），由操控层每帧写入 */
  thrust?: number
  thrustX?: number
  thrustY?: number
  /** 恒星累计吞并的质量（驱动生命周期演化）；普通天体为 0 */
  absorbed?: number
  /** 生命周期阶段标签（恒星/致密星演化），与 kind 解耦以保持轨道逻辑不变 */
  lifeStage?: 'main' | 'giant' | 'whitedwarf' | 'neutron' | 'blackhole'
  trail: TrailPoint[]
  alive: boolean
}

export interface Effect {
  x: number
  y: number
  age: number
  ttl: number
  size: number
  color: string
  kind: 'merge' | 'spawn'
}

/** 性能档位：极致（服务器级）/高/均衡/低/省电 */
export type PerfTier = 'ultra' | 'high' | 'balanced' | 'low' | 'saver'

export interface PerfConfig {
  /** 物理积分子步数上限（≤60天体） */
  substepMax: number
  /** 星系子步数上限（>60天体） */
  galaxySubstepMax: number
  /** 预演缓冲加速期倍率 */
  prebufferRate: number
  /** 轨迹点上限（小规模） */
  trailMaxSmall: number
  /** 轨迹点上限（大规模） */
  trailMaxLarge: number
  /** 黑洞护盾子步上限 */
  bhShieldMax: number
  /** 碎片/效果数量上限 */
  effectMax: number
}

export const PERF_TIERS: Record<PerfTier, PerfConfig> = {
  ultra:   { substepMax: 1024, galaxySubstepMax: 128, prebufferRate: 16, trailMaxSmall: 640, trailMaxLarge: 140, bhShieldMax: 256, effectMax: 120 },
  high:    { substepMax: 512,  galaxySubstepMax: 64,  prebufferRate: 8,  trailMaxSmall: 320, trailMaxLarge: 70,  bhShieldMax: 128, effectMax: 80 },
  balanced:{ substepMax: 256,  galaxySubstepMax: 32,  prebufferRate: 4,  trailMaxSmall: 200, trailMaxLarge: 50,  bhShieldMax: 64,  effectMax: 60 },
  low:     { substepMax: 128,  galaxySubstepMax: 16,  prebufferRate: 2,  trailMaxSmall: 100, trailMaxLarge: 30,  bhShieldMax: 32,  effectMax: 40 },
  saver:   { substepMax: 64,   galaxySubstepMax: 8,   prebufferRate: 1,  trailMaxSmall: 50,  trailMaxLarge: 20,  bhShieldMax: 16,  effectMax: 20 },
}

export interface SimConfig {
  /** 引力常数：按场景固定，不可改（改了等于换一套物理定律） */
  G: number
  timeScale: number
  /** 引力软化：按场景固定，不可改（数值防奇点参数） */
  softening: number
  trails: boolean
  /** 永久轨迹：不裁剪长度，保留完整轨道痕迹 */
  trailsForever: boolean
  /** 相对论修正：黑洞用 Paczyński–Wiita 赝牛顿势（恒为 true，开销可忽略） */
  relativity: boolean
  paused: boolean
  /** 性能档位：auto 时由运行时根据 FPS 自动调节 */
  perfTier: PerfTier | 'auto'
}

/** 各档位下的实际运行参数（resolvePerf 填充） */
export interface ResolvedPerf {
  tier: PerfTier
  cfg: PerfConfig
  /** auto 模式下当前实际生效的档位 */
  effectiveTier: PerfTier
}

export interface SimStats {
  bodies: number
  stars: number
  fps: number
  simTime: number
  merges: number
  totalMass: number
}

export type PresetId = 'solar' | 'real' | 'binary' | 'triple' | 'galaxy' | 'collision' | 'empty'

/** 场景单位描述：模拟单位 → 真实单位的换算（仅「真实太阳系」场景设置） */
export interface UnitProfile {
  /** 1 模拟质量单位 = kg */
  massKg: number
  /** 1 模拟距离单位 = m */
  distM: number
  /** 1 模拟速度单位 = m/s */
  velMs: number
  /** 1 模拟时间单位 = 天 */
  timeDays: number
}

export type ToolMode = 'pan' | 'spawn'

// ———— 存档 / 世界状态（本地存档、getstate/hostsave 协议共用） ————

/** 单个天体的可序列化状态（轨迹不存：量大且会自然重建） */
export interface WorldBodyState {
  id: number
  name: string
  kind: BodyKind
  x: number
  y: number
  vx: number
  vy: number
  mass: number
  radius: number
  visBoost?: number
  color: string
  glow: string
  solid: boolean
  spin?: number
  absorbed?: number
  lifeStage?: Body['lifeStage']
}

export interface WorldState {
  version: 1
  /** 保存时的预设 id（决定单位换算与默认相机） */
  preset?: string
  /** 保存时的相机（自动存档恢复视野用；导入的存档可以没有） */
  camera?: { x: number; y: number; zoom: number }
  config: {
    G: number
    timeScale: number
    softening: number
    trails: boolean
    trailsForever: boolean
    paused: boolean
  }
  simTime: number
  merges: number
  bodies: WorldBodyState[]
}

export interface SpawnSettings {
  kind: BodyKind
  mass: number
  autoOrbit: boolean
}

export interface Camera {
  x: number
  y: number
  zoom: number
}
