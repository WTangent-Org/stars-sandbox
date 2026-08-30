// 远程模拟通信协议：服务器 ↔ 浏览器共享
// 帧用二进制（大场景省带宽），控制/元信息用 JSON
import type { WorldState } from '../sim/types'

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
  /** 视觉半径倍率（真实比例场景）：二进制帧不带，走元数据通道 */
  visBoost?: number
  /** 拥有者玩家 id（联机）；undefined/null = 无主 */
  owner?: string | null
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
  /** 房间当前预设 id：客户端据此同步相机缩放/单位换算（新连进来的玩家也能对上画面） */
  preset: string
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
  /** 服务器只产生 merge（碰撞/并合）；spawn 型特效仅在客户端本地放置时出现 */
  effects: Array<{ x: number; y: number; age: number; ttl: number; size: number; color: string; kind: 'merge' | 'spawn' }>
}

export interface HelloMsg {
  type: 'hello'
  preset: string
  /** 服务器每帧广播间隔（ms） */
  tickMs: number
}

// ———— 联机：房间 / 玩家 / 权限 / 投票 ————

/** 星球权限：admin=可删可改权限可移动；move=可拖动抛掷；read=只读（默认） */
export type BodyPerm = 'admin' | 'move' | 'read'

export interface PlayerInfo {
  id: string
  name: string
  color: string
}

/** 服务端 → 客户端：你进房了（含自己的身份与房间号） */
export interface RoomMsg {
  type: 'room'
  /** 房间号；'lobby' = 公共大厅 */
  room: string
  you: PlayerInfo
  players: PlayerInfo[]
  /** 房主玩家 id；null = 公共大厅等无主房间（全局操作走投票） */
  host: string | null
}

/** 服务端 → 客户端：玩家进出 */
export interface PlayersMsg {
  type: 'players'
  players: PlayerInfo[]
}

/** 服务端 → 客户端：某颗天体的权限表（点选天体时下发） */
export interface BodyPermsMsg {
  type: 'bodyperms'
  bodyId: number
  /** 拥有者玩家 id；null = 无主（预设天体/创建者已离开） */
  owner: string | null
  /** 各玩家被授予的权限（不在表里的玩家 = read） */
  grants: Record<string, BodyPerm>
}

/** 全局操作的投票状态 */
export interface VoteMsg {
  type: 'vote'
  /** 投票 id（-1 = 无进行中的投票） */
  id: number
  action: 'pause' | 'rewind' | 'clear' | 'preset'
  preset?: string
  paused?: boolean
  initiator: string
  yes: number
  no: number
  total: number
  /** 剩余秒数 */
  ttl: number
}

export type ServerMsg =
  | ManifestMsg
  | MetaMsg
  | EffectMsg
  | HelloMsg
  | RoomMsg
  | PlayersMsg
  | BodyPermsMsg
  | VoteMsg
  | WorldStateMsg
  | HostedMsg
  | RoomClosedMsg
  | RoomListMsg

/** 服务端 → 客户端：世界状态应答（存档「保存当前」用，权威快照） */
export interface WorldStateMsg {
  type: 'worldstate'
  state: WorldState
}

/** 服务端 → 客户端：hostsave 结果（开放到局域网完成，回房号） */
export interface HostedMsg {
  type: 'hosted'
  /** 目标房间号；'' = 失败（房间满等） */
  room: string
}

/** 服务端 → 客户端：活跃房间列表（不含大厅；roomlist 应答） */
export interface RoomListMsg {
  type: 'roomlist'
  rooms: Array<{ id: string; players: number; host: boolean }>
}

/** 服务端 → 客户端：房主解散了房间（MC 语义：房主走，房没） */
export interface RoomClosedMsg {
  type: 'roomClosed'
  /** 'host_left' = 房主退出；'host_closed' = 房主主动关闭 */
  reason: 'host_left' | 'host_closed'
}

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
  /** 进房：room 省略 = 公共大厅；给房号 = 加入/创建私房 */
  | { type: 'join'; room?: string }
  /** 授权/回收某颗天体的权限（owner 或该天体 admin 可用） */
  | { type: 'perm'; bodyId: number; target: string; perm: BodyPerm | 'revoke' }
  /** 点选天体时请求权限表 */
  | { type: 'permquery'; bodyId: number }
  /** 发起全局操作投票 */
  | { type: 'votecall'; action: 'pause' | 'rewind' | 'clear' | 'preset'; preset?: string; paused?: boolean }
  /** 对当前投票表态 */
  | { type: 'votecast'; yes: boolean }
  /** 请求当前房间宇宙的权威状态（存档「保存当前」用） */
  | { type: 'getstate' }
  /** 房主主动关闭房间（房解散，客人收到 roomClosed） */
  | { type: 'closeRoom' }
  /** 请求活跃房间列表（应答 roomlist） */
  | { type: 'listrooms' }
  /** 开放到局域网（MC 式）：把一份世界状态装进房间（省略 room = 新建随机房），
   *  自己随即被移入该房。等价于「用存档开服」。 */
  | { type: 'hostsave'; room?: string; state: WorldState }

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
