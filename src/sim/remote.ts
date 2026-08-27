/**
 * 远程模拟客户端：连接服务器 WebSocket，把收到的帧灌注进一个本地「傀儡」Simulation，
 * 渲染层完全不用改——它看到的仍是一个 Simulation 实例，只是物理不在本地跑。
 * 用户操作（推力/拖拽/生成/配置）序列化为指令发给服务器。
 */
import { Simulation } from './engine'
import type { BodyKind } from './types'
import { decodeFrame, KIND_CODE, type ClientCmd, type ServerMsg } from '../shared/protocol'

export type RemoteStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export class RemoteSim {
  /** 傀儡模拟：渲染层直接读它 */
  readonly puppet = new Simulation()
  status: RemoteStatus = 'disconnected'
  onStatus: ((s: RemoteStatus) => void) | null = null
  /** 服务器时钟（帧里带的 simTime，用于 HUD） */
  simTime = 0
  merges = 0
  totalMass = 0
  paused = false
  /** 服务器端配置（面板显示用） */
  config = { G: 1, timeScale: 30, softening: 3, trails: true, trailsForever: false }
  private ws: WebSocket | null = null
  private manifest = new Map<number, { name: string; kind: BodyKind; color: string; glow: string; solid: boolean }>()
  /** 未渲染的特效（服务器帧推来，本地按真实时间老化） */
  pendingEffects: Array<{ x: number; y: number; age: number; ttl: number; size: number; color: string; kind: 'merge' | 'spawn' }> = []
  /** 帧插值：上一帧/当前帧天体位置（渲染时按时间线性插值，消除 20Hz 抖动） */
  private prev = new Map<number, { x: number; y: number; t: number }>()
  private curr = new Map<number, { x: number; y: number; t: number }>()
  private recvAt = 0
  private tickMs = 50

  connect(addr: string) {
    this.disconnect()
    this.setStatus('connecting')
    const url = addr.startsWith('ws') ? addr : `ws://${addr.replace(/^https?:\/\//, '')}/ws`
    const ws = new WebSocket(url)
    ws.binaryType = 'arraybuffer'
    this.ws = ws
    ws.onopen = () => this.setStatus('connected')
    ws.onerror = () => this.setStatus('error')
    ws.onclose = () => this.setStatus('disconnected')
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') this.onJson(JSON.parse(ev.data) as ServerMsg)
      else this.onFrame(ev.data as ArrayBuffer)
    }
  }

  disconnect() {
    this.ws?.close()
    this.ws = null
    this.setStatus('disconnected')
  }

  send(cmd: ClientCmd) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(cmd))
  }

  private setStatus(s: RemoteStatus) {
    this.status = s
    this.onStatus?.(s)
  }

  private onJson(msg: ServerMsg) {
    switch (msg.type) {
      case 'hello':
        this.tickMs = msg.tickMs
        break
      case 'manifest':
        for (const b of msg.bodies) {
          this.manifest.set(b.id, { name: b.name, kind: b.kind as BodyKind, color: b.color, glow: b.glow, solid: b.solid })
        }
        break
      case 'meta':
        this.simTime = msg.simTime
        this.merges = msg.merges
        this.totalMass = msg.totalMass
        this.paused = msg.paused
        this.config = msg.config
        // 傀儡配置同步（渲染层读它决定轨迹等）
        Object.assign(this.puppet.config, msg.config, { perfTier: 'high' })
        break
      case 'effects':
        this.pendingEffects.push(...msg.effects)
        break
    }
  }

  private onFrame(buf: ArrayBuffer) {
    const f = decodeFrame(buf)
    this.recvAt = performance.now()
    this.simTime = f.simTime
    this.merges = f.merges
    // 插值缓冲滚动
    this.prev = this.curr
    this.curr = new Map()
    const seen = new Set<number>()
    for (const fb of f.bodies) {
      seen.add(fb.id)
      this.curr.set(fb.id, { x: fb.x, y: fb.y, t: this.recvAt })
      let b = this.puppet.bodies.find((x) => x.id === fb.id)
      const meta = this.manifest.get(fb.id)
      const kind = KIND_CODE[fb.kind] ?? 'asteroid'
      if (!b) {
        b = this.puppet.addBody({
          kind,
          x: fb.x,
          y: fb.y,
          vx: fb.vx,
          vy: fb.vy,
          mass: fb.mass,
          radius: fb.radius,
          solid: meta?.solid ?? true,
        })
        if (meta) {
          b.name = meta.name
          b.color = meta.color
          b.glow = meta.glow
        }
      } else {
        b.x = fb.x
        b.y = fb.y
        b.vx = fb.vx
        b.vy = fb.vy
        b.mass = fb.mass
        b.radius = fb.radius
        b.kind = kind
        b.alive = fb.alive
        b.thrust = fb.thrust
      }
    }
    // 帧里没了的天体 = 已被合并/删除
    this.puppet.bodies = this.puppet.bodies.filter((b) => seen.has(b.id))
    this.puppet.simTime = f.simTime
    this.puppet.merges = f.merges
  }

  private lastInterpolate = 0

  /** 渲染前调用：按接收时间线性插值，把 20Hz 网络帧补成 60Hz 平滑画面；
   *  顺带维护轨迹与特效老化（傀儡不跑 step，这些得本地补） */
  interpolate(zoom = 1) {
    const now = performance.now()
    const span = Math.max(this.tickMs, 30)
    const alpha = Math.min(Math.max((now - this.recvAt) / span, 0), 1.5) // 允许轻微外推
    const maxTrail = this.puppet.bodies.length > 200 ? 70 : 320
    const spacing2 = (Math.max(1.5 / zoom, 1e-6) * 1.5) ** 2
    for (const b of this.puppet.bodies) {
      const c = this.curr.get(b.id)
      const p = this.prev.get(b.id)
      if (c && p) {
        b.x = p.x + (c.x - p.x) * alpha
        b.y = p.y + (c.y - p.y) * alpha
      }
      // 轨迹：本地追加（网络帧不携带轨迹）
      if (this.config.trails) {
        const last = b.trail[b.trail.length - 1]
        const dx = b.x - (last?.x ?? Infinity)
        const dy = b.y - (last?.y ?? Infinity)
        if (dx * dx + dy * dy > spacing2) {
          b.trail.push({ x: b.x, y: b.y })
          if (!this.config.trailsForever && b.trail.length > maxTrail) b.trail.splice(0, 40)
        }
      }
    }
    // 特效：服务器推来的并入傀儡，按真实时间老化
    if (this.pendingEffects.length > 0) {
      this.puppet.effects.push(...this.pendingEffects)
      this.pendingEffects.length = 0
    }
    const dt = this.lastInterpolate ? (now - this.lastInterpolate) / 1000 : 0
    this.lastInterpolate = now
    for (const e of this.puppet.effects) e.age += dt
    this.puppet.effects = this.puppet.effects.filter((e) => e.age < e.ttl)
  }
}
