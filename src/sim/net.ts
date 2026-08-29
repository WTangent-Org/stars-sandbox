/**
 * 联机客户端（NetSim）：连接网页同源服务器的 WebSocket（/ws）。
 *
 * 客户端补算：镜像 Simulation 每帧本地积分（engine 的 mirror 模式——只算引力/
 * 推进/ISCO/轨迹，碰撞与生命周期由服务器裁决），服务器权威帧（默认 12Hz）到达时
 * 对账纠偏。这样服务器只需低频推流，画面仍有 60fps 的真实物理平滑度。
 * 低性能档（低/省电）退回线性插值，客户端几乎不出力。
 *
 * 用户操作（推力/拖拽/生成/配置）序列化为指令发给服务器；抓取中的天体与自己的
 * 飞船由本地即时控制，对账只做软纠正。
 */
import { Simulation } from './engine'
import { PERF_TIERS, type BodyKind, type WorldState } from './types'
import { decodeFrame, KIND_CODE, type BodyPerm, type ClientCmd, type PlayerInfo, type ServerMsg, type VoteMsg } from '../shared/protocol'

export type NetStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export class NetSim {
  /** 镜像模拟：渲染层直接读它；mirror 模式下本地补算帧间物理 */
  readonly mirror = new Simulation()
  status: NetStatus = 'disconnected'
  onStatus: ((s: NetStatus) => void) | null = null
  /** 服务器时钟（帧里带的 simTime，用于 HUD） */
  simTime = 0
  merges = 0
  totalMass = 0
  paused = false
  /** 房间当前预设（hello/meta 同步）：渲染层据此对齐相机缩放/单位换算 */
  preset = 'real'
  /** 服务器端配置（meta 同步；timeScale/G 驱动物镜像补算速率） */
  config = { G: 1, timeScale: 30, softening: 3, trails: true, trailsForever: false }
  // ———— 联机状态 ————
  /** 当前房间号；'' = 未进房 */
  room = ''
  /** 房主玩家 id；null = 公共大厅等无主房间（全局操作走投票） */
  hostId: string | null = null
  you: PlayerInfo | null = null
  players: PlayerInfo[] = []
  /** 天体 id → 拥有者玩家 id（来自清单） */
  owners = new Map<number, string | null>()
  /** 点选天体的权限表（permquery 应答；key 变化即刷新） */
  bodyPerms: { bodyId: number; owner: string | null; grants: Record<string, BodyPerm> } | null = null
  /** 进行中的投票（null = 无） */
  vote: VoteMsg | null = null
  /** 联机状态变化回调（房间/玩家/投票/权限） */
  onLobby: (() => void) | null = null
  /** 房间预设变化（进房 / 房内投票切换预设）：渲染层应采用该预设的呈现 */
  onPreset: ((preset: string) => void) | null = null
  /** hostsave 结果回调（房号；'' = 失败） */
  onHosted: ((room: string) => void) | null = null
  /** 房主解散房间（房主退出或主动关闭）：客户端回到离线单机 */
  onRoomClosed: ((reason: 'host_left' | 'host_closed') => void) | null = null
  private ws: WebSocket | null = null
  /** 已通知渲染层的预设（去重：同一预设只回调一次，重连后重置） */
  private firedPreset = ''
  private manifest = new Map<number, { name: string; kind: BodyKind; color: string; glow: string; solid: boolean; visBoost?: number; owner?: string | null }>()
  /** 未渲染的特效（服务器推来，本地按真实时间老化） */
  private pendingEffects: Array<{ x: number; y: number; age: number; ttl: number; size: number; color: string; kind: 'merge' | 'spawn' }> = []
  /** 帧插值（降级路径）：上一帧/当前帧天体位置 */
  private prev = new Map<number, { x: number; y: number }>()
  private curr = new Map<number, { x: number; y: number }>()
  private recvAt = 0
  private tickMs = 83
  private stateResolvers: Array<{ res: (s: WorldState) => void; rej: (e: Error) => void; timer: ReturnType<typeof setTimeout> }> = []

  /** 连接成功后要进的房（'' = 大厅） */
  pendingRoom = ''

  constructor() {
    this.mirror.mirror = true
  }

  /** 连同源服务器（网页服务器即物理服务器）；https 页面自动用 wss */
  connect() {
    this.disconnect()
    this.firedPreset = ''
    this.setStatus('connecting')
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${location.host}/ws`)
    ws.binaryType = 'arraybuffer'
    this.ws = ws
    ws.onopen = () => {
      this.setStatus('connected')
      this.joinRoom(this.pendingRoom || undefined)
    }
    ws.onerror = () => this.setStatus('error')
    ws.onclose = () => {
      if (this.status !== 'error') this.setStatus('disconnected')
    }
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') this.onJson(JSON.parse(ev.data) as ServerMsg)
      else this.onFrame(ev.data as ArrayBuffer)
    }
  }

  disconnect() {
    this.ws?.close()
    this.ws = null
    this.room = ''
    this.you = null
    this.players = []
    this.vote = null
    this.owners.clear()
    this.setStatus('disconnected')
  }

  send(cmd: ClientCmd) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(cmd))
  }

  private setStatus(s: NetStatus) {
    this.status = s
    this.onStatus?.(s)
  }

  /** 采用房间预设（去重：换预设才回调；渲染层据此同步相机/单位） */
  private adoptPreset(p: string) {
    this.preset = p || 'real'
    if (!p || p === this.firedPreset) return
    this.firedPreset = p
    this.onPreset?.(p)
  }

  /** 进房：room 省略/空 = 公共大厅 */
  joinRoom(room?: string) {
    this.send({ type: 'join', room })
  }

  /** 对当前投票表态 */
  castVote(yes: boolean) {
    this.send({ type: 'votecast', yes })
  }

  /** 授权/回收某颗天体的权限 */
  setPerm(bodyId: number, target: string, perm: BodyPerm | 'revoke') {
    this.send({ type: 'perm', bodyId, target, perm })
  }

  /** 请求某颗天体的权限表 */
  queryPerms(bodyId: number) {
    this.send({ type: 'permquery', bodyId })
  }

  /** 请求服务器权威世界状态（存档「保存当前」用） */
  requestState(): Promise<WorldState> {
    return new Promise((res, rej) => {
      const timer = setTimeout(() => {
        this.stateResolvers = this.stateResolvers.filter((r) => r.res !== res)
        rej(new Error('getstate timeout'))
      }, 5000)
      this.stateResolvers.push({ res, rej, timer })
      this.send({ type: 'getstate' })
    })
  }

  /** 开放到局域网：把世界状态装进房间（room 省略 = 新建随机房），结果经 onHosted 回调 */
  hostSave(state: WorldState, room?: string) {
    this.send({ type: 'hostsave', room, state })
  }

  /** 我是不是当前房间的房主（有主房里清空/切预设等是房主特权） */
  get isHost(): boolean {
    return this.hostId != null && this.you != null && this.hostId === this.you.id
  }

  /** 房主主动关闭房间 */
  closeRoom() {
    this.send({ type: 'closeRoom' })
  }

  /** 客户端补算是否启用：低/省电档退回线性插值 */
  get reSimEnabled(): boolean {
    return this.mirror.perf !== PERF_TIERS.low && this.mirror.perf !== PERF_TIERS.saver
  }

  /** 每个渲染帧调用：补算模式本地积分（step 内含特效老化），否则走插值降级 */
  tick(dt: number, zoom: number) {
    if (this.pendingEffects.length > 0) {
      this.mirror.effects.push(...this.pendingEffects)
      this.pendingEffects.length = 0
    }
    if (this.reSimEnabled) {
      this.mirror.step(dt, zoom)
    } else {
      this.interpolate(zoom)
    }
  }

  private onJson(msg: ServerMsg) {
    switch (msg.type) {
      case 'hello':
        this.tickMs = msg.tickMs
        this.adoptPreset(msg.preset)
        break
      case 'manifest':
        for (const b of msg.bodies) {
          this.manifest.set(b.id, { name: b.name, kind: b.kind as BodyKind, color: b.color, glow: b.glow, solid: b.solid, visBoost: b.visBoost })
          this.owners.set(b.id, b.owner ?? null)
          // 元数据可能晚于二进制帧到达：给已存在的镜像天体补齐外观（含视觉倍率）
          const existing = this.mirror.bodies.find((x) => x.id === b.id)
          if (existing) {
            existing.name = b.name
            existing.color = b.color
            existing.glow = b.glow
            existing.solid = b.solid
            existing.visBoost = b.visBoost
          }
        }
        break
      case 'room':
        this.room = msg.room
        this.you = msg.you
        this.players = msg.players
        this.hostId = msg.host ?? null
        this.onLobby?.()
        break
      case 'players':
        this.players = msg.players
        this.onLobby?.()
        break
      case 'bodyperms':
        this.bodyPerms = { bodyId: msg.bodyId, owner: msg.owner, grants: msg.grants }
        this.onLobby?.()
        break
      case 'vote':
        this.vote = msg.id >= 0 ? msg : null
        this.onLobby?.()
        break
      case 'meta':
        this.simTime = msg.simTime
        this.merges = msg.merges
        this.totalMass = msg.totalMass
        this.paused = msg.paused
        this.config = msg.config
        this.adoptPreset(msg.preset)
        // 镜像配置同步（G/timeScale 决定补算速率；trails 是渲染层行为）
        Object.assign(this.mirror.config, msg.config)
        this.mirror.config.paused = msg.paused // meta 的 paused 独立字段，step 据此停摆
        break
      case 'effects':
        this.pendingEffects.push(...msg.effects)
        break
      case 'worldstate': {
        const waiters = this.stateResolvers
        this.stateResolvers = []
        for (const w of waiters) {
          clearTimeout(w.timer)
          w.res(msg.state)
        }
        break
      }
      case 'hosted':
        this.onHosted?.(msg.room)
        break
      case 'roomClosed':
        // 房主走，房没：本地清空联机状态回到离线单机
        this.ws?.close()
        this.ws = null
        this.room = ''
        this.you = null
        this.players = []
        this.vote = null
        this.hostId = null
        this.owners.clear()
        this.setStatus('disconnected')
        this.onRoomClosed?.(msg.reason)
        break
    }
  }

  /** 权威帧到达：对账纠偏。本地控制中的天体（抓取/自己的飞船）只做软纠正。 */
  private onFrame(buf: ArrayBuffer) {
    const f = decodeFrame(buf)
    this.recvAt = performance.now()
    this.simTime = f.simTime
    this.merges = f.merges
    // 插值缓冲滚动（降级路径用）
    this.prev = this.curr
    this.curr = new Map()
    const seen = new Set<number>()
    for (const fb of f.bodies) {
      seen.add(fb.id)
      const kind = KIND_CODE[fb.kind] ?? 'asteroid'
      this.curr.set(fb.id, { x: fb.x, y: fb.y })
      let b = this.mirror.bodies.find((x) => x.id === fb.id)
      const meta = this.manifest.get(fb.id)
      if (!b) {
        b = this.mirror.addBody({
          id: fb.id, // 必须用服务器 id：本地自增 id 会让帧对账把它当未知体每帧删除重建
          kind,
          x: fb.x,
          y: fb.y,
          vx: fb.vx,
          vy: fb.vy,
          mass: fb.mass,
          radius: fb.radius,
          solid: meta?.solid ?? true,
          visBoost: meta?.visBoost,
        })
        if (meta) {
          b.name = meta.name
          b.color = meta.color
          b.glow = meta.glow
        }
        continue
      }
      // 本地控制中的天体：本地即时响应优先，权威帧只软纠（防手感被网络抖动抢走）
      const ownShip = b.kind === 'ship' && this.you != null && this.owners.get(b.id) === this.you.id
      const soft = b.held || ownShip
      const dx = fb.x - b.x
      const dy = fb.y - b.y
      const d2 = dx * dx + dy * dy
      // 偏差过大（并合重组/拖拽瞬移/补算发散）直接 snap，小偏差按比例收敛
      const snapD = Math.max(b.radius * 8, Math.hypot(fb.vx, fb.vy) * (this.tickMs / 1000) * 3)
      const kp = soft ? 0.12 : 0.35
      const kv = soft ? 0.3 : 0.6
      if (!soft && d2 > snapD * snapD) {
        b.x = fb.x
        b.y = fb.y
        b.vx = fb.vx
        b.vy = fb.vy
        b.trail.length = 0 // 大幅纠偏（瞬移）：旧轨迹连出的长线没有意义，直接清掉
      } else {
        b.x += dx * kp
        b.y += dy * kp
        b.vx += (fb.vx - b.vx) * kv
        b.vy += (fb.vy - b.vy) * kv
      }
      b.mass = fb.mass
      b.radius = fb.radius
      b.kind = kind
      b.alive = fb.alive
      if (!ownShip) b.thrust = fb.thrust
    }
    // 帧里没了的天体 = 已被合并/删除
    this.mirror.bodies = this.mirror.bodies.filter((b) => seen.has(b.id))
    this.mirror.simTime = f.simTime
    this.mirror.merges = f.merges
  }

  private lastInterpolate = 0

  /** 降级路径（低/省电档）：20Hz 网络帧线性插值 + 本地轨迹/特效维护 */
  private interpolate(zoom = 1) {
    const now = performance.now()
    const span = Math.max(this.tickMs, 30)
    const alpha = Math.min(Math.max((now - this.recvAt) / span, 0), 1.5) // 允许轻微外推
    const maxTrail = this.mirror.bodies.length > 200 ? 70 : 320
    const spacing2 = (Math.max(1.5 / zoom, 1e-6) * 1.5) ** 2
    for (const b of this.mirror.bodies) {
      if (!b.held) {
        const c = this.curr.get(b.id)
        const p = this.prev.get(b.id)
        if (c && p) {
          b.x = p.x + (c.x - p.x) * alpha
          b.y = p.y + (c.y - p.y) * alpha
        }
      }
      // 轨迹：本地追加（网络帧不携带轨迹）；开关读镜像本地配置（渲染层行为，不走服务器）
      if (this.mirror.config.trails) {
        const last = b.trail[b.trail.length - 1]
        const dx = b.x - (last?.x ?? Infinity)
        const dy = b.y - (last?.y ?? Infinity)
        if (dx * dx + dy * dy > spacing2) {
          b.trail.push({ x: b.x, y: b.y })
          if (!this.mirror.config.trailsForever && b.trail.length > maxTrail) b.trail.splice(0, 40)
        }
      }
    }
    const dt = this.lastInterpolate ? (now - this.lastInterpolate) / 1000 : 0
    this.lastInterpolate = now
    for (const e of this.mirror.effects) e.age += dt
    this.mirror.effects = this.mirror.effects.filter((e) => e.age < e.ttl)
  }
}
