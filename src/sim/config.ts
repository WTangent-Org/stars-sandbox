/**
 * 引擎/渲染调参常量集中地。
 * 全部物理阈值原来散落在 engine.ts 的碰撞、生命周期、黑洞捕获等处；
 * 改这里即可全局生效，不再需要在实现里找数字。
 */

// ———— 碰撞（相对速度以两体逃逸速度 vEsc 为标尺） ————
export const COLLISION = {
  /** 超临界撞击 → 碎裂（shatter） */
  shatterAt: 1.5,
  /** 低速接触 → 并合（动能不足以克服引力束缚） */
  mergeBelow: 0.3,
  /** 硬反弹判定起点（低于此不溅屑） */
  debrisAbove: 0.7,
  /** 低于逃逸速度一半的碰撞近乎完全非弹性（防「弹开-拉回」数值极限环） */
  softAt: 0.5,
  /** 高能岩石弹跳恢复系数 */
  restitutionHigh: 0.35,
  /** 低能碰撞恢复系数 */
  restitutionLow: 0.1,
  /** 切向摩擦系数（决定自旋转换效率） */
  friction: 0.25,
  /** 溅屑质量：min(小天体 2%, 大天体 0.2%) */
  debrisMassSmall: 0.02,
  debrisMassBig: 0.002,
  /** 溅屑冷却帧数（新生碎片不参与碰撞，防级联） */
  debrisCooldown: 3,
  /** 洛希撕碎质量比阈值 */
  rocheMassRatio: 100,
  /** 撕碎/碎裂的碎片数 */
  disruptPieces: 5,
  shatterPieces: 4,
  /** 天体总量保险丝：超过后一切碰撞退化为直接并合 */
  hardFuse: 2500,
  /** 溅屑生成的天体数软顶 */
  debrisFuse: 1200,
} as const

// ———— 恒星生命周期 ————
export const LIFECYCLE = {
  /** ≥ 此质量的恒星走超新星路径（否则白矮星） */
  supernovaMass: 80000,
  /** 岁月演化基准速率：supernovaMass 恒星约 30 秒真实时间进入红巨星 */
  ageRate: 8e-5,
  /** 吞并驱动阶段跃迁的 absorbed/mass 阈值 */
  giantAt: 0.18,
  whiteDwarfAt: 0.45,
  massiveGiantAt: 0.1,
  massiveCollapseAt: 0.25,
  /** 恒星并合显著表现的质量比/相对速度阈值 */
  notableMassRatio: 0.02,
  notableRelV: 2,
  /** 包层抛射的溅屑参数 */
  ejectMassRatio: 0.08,
  ejectCap: 0.01,
  ejectPieces: 4,
  ejectCooldown: 4,
} as const

// ———— 黑洞 ————
export const BLACKHOLE = {
  /** 视界捕获半径倍率（实体天体=1×视界） */
  captureR: 1,
  /** 非实体示踪星的真实捕获截面（视觉半径比真实视界大几个量级） */
  captureRTracer: 0.04,
  /** 瞬移捕获：子步位移超过视界直径、且位于 3 倍视界内 */
  teleportGate: 2,
  teleportZone: 9,
  /** 护盾触发距离（倍视界）与局部时标缩放 */
  shieldZone: 3,
  shieldScale: 100,
  /** ISCO（最内稳定圆轨道）= 6 r_s，内部发生衰减坠毁 */
  iscoRs: 6,
  /** 超新星塌缩特效半径倍率 */
  supernovaFx: 40,
} as const

// ———— 轨迹 ————
export const TRAIL = {
  /** 采样最小间距（世界单位/zoom） */
  spacing: 1.5,
  /** 裁剪步长与默认上限（多天体时用小值） */
  trimStep: 40,
  maxPoints: 320,
  maxPointsMany: 70,
  manyBodies: 200,
} as const

// ———— 快照 / 回退 ————
export const SNAPSHOTS = {
  /** 快照间隔（真实秒）与保留帧数 */
  interval: 1.5,
  max: 160,
  /** 超过此天体数不做快照（大星系场景） */
  maxBodies: 60,
} as const
