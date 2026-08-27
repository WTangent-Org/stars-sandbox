// 远程模拟通信协议：服务器 ↔ 浏览器共享
// 帧用二进制（大场景省带宽），控制/元信息用 JSON

/** 帧内天体种类编码（与 BodyKind 顺序一致） */
export const KIND_CODE = ['star', 'planet', 'moon', 'asteroid', 'blackhole', 'ship'] as const
export type KindCode = (typeof KIND_CODE)[number]

/** 服务端 → 客户端：天体清单（名字/颜色等不常变的字段，新增天体时下发） */
export interface ManifestBody {
  id: number
  name: string
  kind: KindCode
  color: string
  glow: string
  solid: boolean
}

export interface ManifestMsg {
  type: 'manifest'
  bodies: ManifestBody[]
}

export interface MetaMsg {
  type: 'meta'
  simTime: number
  merges: number
  totalMass: number
  paused: boolean
  config: {
    G: number
    timeScale: number
    softening: number
    trails: boolean
    trailsForever: boolean
  }
}

export interface EffectMsg {
  type: 'effects'
  effects: Array<{ x: number; y: number; age: number; ttl: number; size: number; color: string; kind: 'merge' | 'spawn' }>
}

export interface HelloMsg {
  type: 'hello'
  preset: string
  /** 服务器每帧广播间隔（ms） */
  tickMs: number
}

export type ServerMsg = ManifestMsg | MetaMsg | EffectMsg | HelloMsg

/** 客户端 → 服务端：控制指令 */
export type ClientCmd =
  | { type: 'config'; patch: Record<string, number | boolean> }
  | { type: 'preset'; id: string }
  | { type: 'spawn'; kind: KindCode; x: number; y: number; vx: number; vy: number; mass: number; visBoost?: number }
  | { type: 'thrust'; throttle: number; x: number; y: number }
  | { type: 'grab'; id: number }
  | { type: 'drag'; id: number; x: number; y: number }
  | { type: 'release'; id: number; vx: number; vy: number }
  | { type: 'remove'; id: number }
  | { type: 'clear' }
  | { type: 'rewind' }
  | { type: 'pause'; paused: boolean }

// ———— 二进制帧编解码 ————
// 布局：msgType u8=1 | simTime f64 | merges u32 | count u32 | 每天体 34B:
// id u32 | kind u8 | flags u8(alive) | x f32 | y f32 | vx f32 | vy f32 | mass f32 | radius f32 | thrust f32
const BODY_BYTES = 34

export interface FrameBody {
  id: number
  kind: number
  alive: boolean
  x: number
  y: number
  vx: number
  vy: number
  mass: number
  radius: number
  thrust: number
}

export interface Frame {
  simTime: number
  merges: number
  bodies: FrameBody[]
}

export function encodeFrame(simTime: number, merges: number, bodies: Array<FrameBody>): ArrayBuffer {
  const buf = new ArrayBuffer(17 + bodies.length * BODY_BYTES)
  const dv = new DataView(buf)
  dv.setUint8(0, 1)
  dv.setFloat64(1, simTime)
  dv.setUint32(9, merges)
  dv.setUint32(13, bodies.length)
  let off = 17
  for (const b of bodies) {
    dv.setUint32(off, b.id)
    dv.setUint8(off + 4, b.kind)
    dv.setUint8(off + 5, b.alive ? 1 : 0)
    dv.setFloat32(off + 6, b.x)
    dv.setFloat32(off + 10, b.y)
    dv.setFloat32(off + 14, b.vx)
    dv.setFloat32(off + 18, b.vy)
    dv.setFloat32(off + 22, b.mass)
    dv.setFloat32(off + 26, b.radius)
    dv.setFloat32(off + 30, b.thrust)
    off += BODY_BYTES
  }
  return buf
}

export function decodeFrame(buf: ArrayBuffer): Frame {
  const dv = new DataView(buf)
  const simTime = dv.getFloat64(1)
  const merges = dv.getUint32(9)
  const count = dv.getUint32(13)
  const bodies: FrameBody[] = new Array(count)
  let off = 17
  for (let i = 0; i < count; i++) {
    bodies[i] = {
      id: dv.getUint32(off),
      kind: dv.getUint8(off + 4),
      alive: dv.getUint8(off + 5) === 1,
      x: dv.getFloat32(off + 6),
      y: dv.getFloat32(off + 10),
      vx: dv.getFloat32(off + 14),
      vy: dv.getFloat32(off + 18),
      mass: dv.getFloat32(off + 22),
      radius: dv.getFloat32(off + 26),
      thrust: dv.getFloat32(off + 30),
    }
    off += BODY_BYTES
  }
  return { simTime, merges, bodies }
}
