/**
 * 星球物理模拟器 —— 联机模拟服务器
 * 房间制：公共大厅 'lobby' + 私房（房号加入，不存在即创建），每个房间一个独立宇宙。
 * 每个玩家：随机呼号 + 颜色，进房自动分配一艘飞船（离开即收回）。
 * 星球权限：创建者拥有，可给其他玩家授 admin / move / read（默认 read）。
 * 全局操作（暂停/回退/清空/切预设）：发起投票，过半同意执行；单人房间直接执行。
 * 可选：存在 dist/index.html 时用 HTTP 静态托管，单端口交付。
 *
 * 运行：node dist-server/server.js  （默认端口 8321，环境变量 PORT 覆盖）
 */
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { join, extname, resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { WebSocketServer, WebSocket } from 'ws'
import { Simulation } from '../src/sim/engine'
import { loadPreset, PRESETS } from '../src/sim/presets'
import { validateWorldState } from '../src/sim/save'
import type { BodyKind } from '../src/sim/types'

const PRESET_IDS = PRESETS.map((p) => p.id) as string[]
const PRESET_KINDS: BodyKind[] = ['star', 'planet', 'moon', 'asteroid', 'blackhole']
import {
  encodeFrame,
  KIND_CODE,
  type BodyPerm,
  type ClientCmd,
  type PlayerInfo,
  type ServerMsg,
} from '../src/shared/protocol'

const PORT = Number(process.env.PORT ?? 8321)
const DIST = resolve(process.env.DIST_DIR ?? 'dist')
const HAS_STATIC = existsSync(join(DIST, 'index.html'))
/** 权威物理频率（Hz）。客户端会做帧间补算，30Hz 足够精确且省一半 CPU */
const PHYS_HZ = Number(process.env.PHYS_HZ ?? 30)
/** 推流频率（Hz）：客户端在权威帧之间本地补算到 60fps，无需高频推流 */
const STREAM_HZ = Number(process.env.STREAM_HZ ?? 12)
const TICK_MS = 1000 / STREAM_HZ
/** 单房间人数上限 */
const MAX_PER_ROOM = Number(process.env.MAX_PER_ROOM ?? 16)
/** 投票时长（秒） */
const VOTE_TTL = 15

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

// ———— 随机呼号与配色 ————
const CALLSIGNS = [
  '旅者', '夸父', '织女', '参宿', '天狼', '北落', '荧惑', '岁星',
  '望舒', '羲和', '烛龙', '青鸟', '玄鸟', '白泽', '毕方', '重明',
]
const PLAYER_COLORS = ['#22d3ee', '#34d399', '#fbbf24', '#f87171', '#a78bfa', '#f472b6', '#60a5fa', '#fb923c']

function randomName(taken: Set<string>): string {
  for (let i = 0; i < 64; i++) {
    const n = `${CALLSIGNS[Math.floor(Math.random() * CALLSIGNS.length)]}-${Math.floor(1000 + Math.random() * 9000)}`
    if (!taken.has(n)) return n
  }
  return `旅者-${randomUUID().slice(0, 4)}`
}

function randomColor(taken: Set<string>): string {
  const free = PLAYER_COLORS.filter((c) => !taken.has(c))
  return free.length > 0 ? free[Math.floor(Math.random() * free.length)] : `#${randomUUID().slice(0, 6)}`
}

// ———— 房间模型 ————
interface Player extends PlayerInfo {
  ws: WebSocket
  shipId: number | null
}

interface Vote {
  id: number
  action: 'pause' | 'rewind' | 'clear' | 'preset'
  preset?: string
  paused?: boolean
  initiator: string
  votes: Map<string, boolean>
  deadline: number
}

interface Room {
  id: string
  sim: Simulation
  /** 当前宇宙对应的预设 id（getstate 存档用） */
  preset: string
  players: Map<WebSocket, Player>
  /** 房主玩家 id；null = 公共大厅等无主常驻房间（全局操作走投票） */
  hostId: string | null
  /** 天体 id → 拥有者玩家 id */
  owners: Map<number, string>
  /** 天体 id → (玩家 id → 权限) */
  grants: Map<number, Map<string, BodyPerm>>
  vote: Vote | null
  physicsTimer: ReturnType<typeof setInterval> | null
  streamTimer: ReturnType<typeof setInterval> | null
  /** 每玩家生成时间戳（限速用） */
  spawnTimes: Map<string, number[]>
  /** 最近活跃时间（空闲回收用） */
  lastActive: number
}

/** 房间总数上限与空闲回收时限（每个房间一个 30Hz 模拟，无上限会拖垮整机） */
const MAX_ROOMS = 32
const ROOM_IDLE_MS = 10 * 60 * 1000

const rooms = new Map<string, Room>()
let voteSeq = 1

function getRoom(id: string): Room {
  let r = rooms.get(id)
  if (!r) {
    evictIdleRooms()
    if (rooms.size >= MAX_ROOMS && id !== 'lobby') {
      // 房间满：让最老的空闲房让位（有人房间不动）
      const idle = [...rooms.values()].filter((x) => x.id !== 'lobby' && x.players.size === 0).sort((a, b) => a.lastActive - b.lastActive)[0]
      if (idle) {
        stopRoomLoops(idle)
        rooms.delete(idle.id)
      }
    }
  }
  if (!r) {
    const sim = new Simulation()
    sim.config.perfTier = 'ultra'
    sim.resolvePerf(60) // perfTier 非 auto 时需解析一次让 ultra 生效
    loadPreset(sim, 'real')
    // 联机模式：剥掉预设自带的飞船，飞船由服务器按玩家分配
    for (const b of sim.bodies.filter((x) => x.kind === 'ship')) sim.removeBody(b.id)
    r = {
      id,
      sim,
      preset: 'real',
      hostId: null,
      players: new Map(),
      owners: new Map(),
      grants: new Map(),
      vote: null,
      physicsTimer: null,
      streamTimer: null,
      spawnTimes: new Map(),
      lastActive: Date.now(),
    }
    rooms.set(id, r)
  }
  r.lastActive = Date.now()
  return r
}

/** 回收超时空闲房（有人房间永不回收） */
function evictIdleRooms() {
  const now = Date.now()
  for (const [id, room] of rooms) {
    if (id === 'lobby' || room.players.size > 0) continue
    if (now - room.lastActive > ROOM_IDLE_MS) {
      stopRoomLoops(room)
      rooms.delete(id)
      console.log(`[room ${id}] 空闲回收`)
    }
  }
}

function send(ws: WebSocket, msg: ServerMsg) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
}

function broadcast(room: Room, msg: ServerMsg) {
  for (const p of room.players.values()) send(p.ws, msg)
}

function manifestBody(room: Room, b: { id: number; name: string; kind: (typeof KIND_CODE)[number]; color: string; glow: string; solid: boolean; visBoost?: number }) {
  return { id: b.id, name: b.name, kind: b.kind, color: b.color, glow: b.glow, solid: b.solid, visBoost: b.visBoost, owner: room.owners.get(b.id) ?? null }
}

function playersMsg(room: Room): ServerMsg {
  return { type: 'players', players: [...room.players.values()].map((p) => ({ id: p.id, name: p.name, color: p.color })) }
}

// ———— 权限判定 ————
function permOf(room: Room, playerId: string, bodyId: number): BodyPerm | 'owner' {
  if (room.owners.get(bodyId) === playerId) return 'owner'
  return room.grants.get(bodyId)?.get(playerId) ?? 'read'
}

function canMove(room: Room, playerId: string, bodyId: number): boolean {
  const p = permOf(room, playerId, bodyId)
  return p === 'owner' || p === 'admin' || p === 'move'
}

function canAdmin(room: Room, playerId: string, bodyId: number): boolean {
  const p = permOf(room, playerId, bodyId)
  return p === 'owner' || p === 'admin'
}

function startRoomLoops(room: Room) {
  if (room.physicsTimer) return
  room.physicsTimer = setInterval(() => {
    // 用 step 而不是 advance：step 内部才做快照（回退用）与特效老化——
    // 直接 advance 会让回退永远失效、effects 无限累积并每 tick 全量广播
    room.sim.step(1 / PHYS_HZ, 1)
  }, 1000 / PHYS_HZ)

  let metaTimer = 0
  room.streamTimer = setInterval(() => {
    const sim = room.sim
    const frame = encodeFrame(
      sim.simTime,
      sim.merges,
      sim.bodies.map((b) => ({
        id: b.id,
        kind: KIND_CODE.indexOf(b.kind),
        alive: b.alive,
        x: b.x,
        y: b.y,
        vx: b.vx,
        vy: b.vy,
        mass: b.mass,
        radius: b.radius,
        thrust: b.thrust ?? 0,
      })),
    )
    for (const p of room.players.values()) if (p.ws.readyState === WebSocket.OPEN) p.ws.send(frame)
    // 特效
    if (sim.effects.length > 0) {
      broadcast(room, {
        type: 'effects',
        effects: sim.effects.map((e) => ({ x: e.x, y: e.y, age: e.age, ttl: e.ttl, size: e.size, color: e.color, kind: e.kind })),
      })
    }
    // 元信息 ~4Hz
    metaTimer++
    if (metaTimer % 5 === 0) {
      broadcast(room, {
        type: 'meta',
        simTime: sim.simTime,
        merges: sim.merges,
        totalMass: sim.totalMass,
        paused: sim.config.paused,
        preset: room.preset,
        config: {
          G: sim.config.G,
          timeScale: sim.config.timeScale,
          softening: sim.config.softening,
          trails: sim.config.trails,
          trailsForever: sim.config.trailsForever,
        },
      })
      // 新天体清单（含 owner）增量下发 + 原地变身天体的元数据重发（超新星/升级不改 id）
      for (const p of room.players.values()) {
        const known = knownMap.get(p.ws)
        if (!known) continue
        const fresh = sim.bodies.filter((b) => !known.has(b.id))
        const dirty = [...sim.dirtyMeta].map((id) => sim.bodies.find((b) => b.id === id)).filter((b) => b != null)
        if (fresh.length === 0 && dirty.length === 0) continue
        for (const b of fresh) known.add(b.id)
        for (const b of dirty) known.add(b.id)
        sim.dirtyMeta.clear()
        const alive = new Set(sim.bodies.map((b) => b.id))
        for (const id of known) if (!alive.has(id)) known.delete(id)
        send(p.ws, { type: 'manifest', bodies: [...fresh, ...dirty].map((b) => manifestBody(room, b)) })
      }
    }
    // 投票结算
    if (room.vote) tickVote(room)
  }, TICK_MS)
}

function stopRoomLoops(room: Room) {
  if (room.physicsTimer) clearInterval(room.physicsTimer)
  if (room.streamTimer) clearInterval(room.streamTimer)
  room.physicsTimer = null
  room.streamTimer = null
}

// ———— 投票 ————
function voteMsg(room: Room): ServerMsg {
  const v = room.vote
  if (!v) return { type: 'vote', id: -1, action: 'pause', initiator: '', yes: 0, no: 0, total: room.players.size, ttl: 0 }
  let yes = 0
  let no = 0
  for (const val of v.votes.values()) {
    if (val) yes++
    else no++
  }
  return {
    type: 'vote',
    id: v.id,
    action: v.action,
    preset: v.preset,
    paused: v.paused,
    initiator: v.initiator,
    yes,
    no,
    total: room.players.size,
    ttl: Math.max(0, Math.round((v.deadline - Date.now()) / 1000)),
  }
}

function tickVote(room: Room) {
  const v = room.vote!
  const total = room.players.size
  let yes = 0
  let no = 0
  for (const val of v.votes.values()) {
    if (val) yes++
    else no++
  }
  const pass = yes > total / 2
  const fail = no >= total / 2 || Date.now() > v.deadline
  if (pass) {
    executeVote(room, v)
    room.vote = null
    broadcast(room, voteMsg(room))
  } else if (fail) {
    room.vote = null
    broadcast(room, voteMsg(room))
  } else {
    broadcast(room, voteMsg(room))
  }
}

function executeVote(room: Room, v: Vote) {
  const sim = room.sim
  switch (v.action) {
    case 'pause':
      sim.config.paused = v.paused ?? true
      break
    case 'rewind':
      sim.rewind()
      break
    case 'clear':
      sim.reset()
      room.owners.clear()
      room.grants.clear()
      // 重新给每人发船
      for (const p of room.players.values()) spawnShip(room, p)
      break
    case 'preset':
      if (v.preset) {
        loadPreset(sim, v.preset as Parameters<typeof loadPreset>[1])
        room.preset = v.preset
        for (const b of sim.bodies.filter((x) => x.kind === 'ship')) sim.removeBody(b.id)
        room.owners.clear()
        room.grants.clear()
        for (const p of room.players.values()) spawnShip(room, p)
        for (const p of room.players.values()) {
          knownMap.set(p.ws, new Set(sim.bodies.map((b) => b.id)))
          send(p.ws, { type: 'manifest', bodies: sim.bodies.map((b) => manifestBody(room, b)) })
        }
      }
      break
  }
}

function callVote(room: Room, player: Player, action: Vote['action'], preset?: string, paused?: boolean) {
  // 单人房间：直接执行，不投票
  if (room.players.size <= 1) {
    executeVote(room, { id: 0, action, preset, paused, initiator: player.id, votes: new Map(), deadline: 0 })
    return
  }
  if (room.vote) return // 已有进行中的投票
  room.vote = {
    id: voteSeq++,
    action,
    preset,
    paused,
    initiator: player.name,
    votes: new Map([[player.id, true]]),
    deadline: Date.now() + VOTE_TTL * 1000,
  }
  tickVote(room)
}

// ———— 飞船：每人一艘 ————
/** pos 提供时按客户端点选的位置/速度部署；否则在宿主附近随机撒一个环绕轨道 */
function spawnShip(room: Room, p: Player, pos?: { x: number; y: number; vx: number; vy: number }) {
  const sim = room.sim
  if (p.shipId != null) sim.removeBody(p.shipId)
  let x = 200 + Math.random() * 80
  let y = 0
  let vx = 0
  let vy = 0
  if (pos) {
    x = pos.x
    y = pos.y
    vx = pos.vx
    vy = pos.vy
  } else {
    const host = sim.bodies.find((b) => b.kind === 'star' || b.kind === 'blackhole')
    if (host) {
      x = host.x + 150 + Math.random() * 100
      y = host.y + 150 + Math.random() * 100
      const dx = x - host.x
      const dy = y - host.y
      const r = Math.hypot(dx, dy) || 1
      const v = Math.sqrt((sim.config.G * host.mass) / r)
      vx = host.vx - (dy / r) * v
      vy = host.vy + (dx / r) * v
    } else {
      // 空宇宙：沿黄金角环带散开，避免所有人挤在一条线上互相干扰
      const idx = room.players.size
      const ang = idx * 2.399963
      const r = 220 + (idx % 5) * 36
      x = Math.cos(ang) * r
      y = Math.sin(ang) * r
    }
  }
  const ship = sim.addBody({ kind: 'ship', x, y, vx, vy, mass: 1e-8 })
  ship.name = `${p.name} 的飞船`
  ship.color = p.color
  ship.glow = p.color
  p.shipId = ship.id
  room.owners.set(ship.id, p.id)
}

// ———— 指令处理 ————
/** 全局操作（暂停/回退/清空/切预设/时间流速）的许可：有主房=房主直接执行、客人无权；无主房（大厅）=投票 */
function globalOpMode(room: Room, p: Player): 'direct' | 'vote' | 'denied' {
  if (room.hostId == null) return 'vote'
  return room.hostId === p.id ? 'direct' : 'denied'
}

// ———— 客户端输入校验 ————
/** 有限数且在范围内；联机的权威物理不能吃 NaN/1e308——一个坏值会永久污染整房模拟 */
function finiteIn(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
}
/** config patch 白名单：客户端只允许改这几项，且必须在值域内（paused/G/timeScale 是全局操作，另有权限门） */
const CONFIG_LIMITS: Record<string, [number, number]> = {
  timeScale: [0, 5000],
  G: [0, 100],
  softening: [0, 1000],
}
/** 每玩家生成限速：10 秒内最多 40 次（防刷屏拖垮 O(n²)） */
const SPAWN_BUDGET = { windowMs: 10_000, max: 40 }

function checkSpawnBudget(room: Room, p: Player): boolean {
  const now = Date.now()
  let t = room.spawnTimes.get(p.id)
  if (!t) {
    t = []
    room.spawnTimes.set(p.id, t)
  }
  while (t.length > 0 && now - t[0] > SPAWN_BUDGET.windowMs) t.shift()
  if (t.length >= SPAWN_BUDGET.max) return false
  t.push(now)
  return true
}

function applyCmd(room: Room, p: Player, cmd: ClientCmd) {
  const sim = room.sim
  switch (cmd.type) {
    case 'config': {
      // 白名单 + 值域过滤；timeScale 影响全房节奏，额外归房主管
      const patch = cmd.patch ?? {}
      const clean: Record<string, number | boolean> = {}
      for (const [k, v] of Object.entries(patch)) {
        const lim = CONFIG_LIMITS[k]
        if (!lim) continue
        if (!finiteIn(v, lim[0], lim[1])) continue
        if (k === 'timeScale' && globalOpMode(room, p) === 'denied') continue
        clean[k] = v
      }
      Object.assign(sim.config, clean)
      break
    }
    case 'preset': {
      const mode = globalOpMode(room, p)
      if (mode === 'denied') break
      if (!cmd.id || !PRESET_IDS.includes(cmd.id as never)) break
      if (mode === 'direct') {
        executeVote(room, { id: 0, action: 'preset', preset: cmd.id, initiator: p.id, votes: new Map(), deadline: 0 })
      } else {
        callVote(room, p, 'preset', cmd.id)
      }
      break
    }
    case 'spawn': {
      // 飞船：每人一艘，由服务器统一分配；客户端点选的坐标/速度直接采用
      if (cmd.kind === 'ship') {
        if (!finiteIn(cmd.x, -1e7, 1e7) || !finiteIn(cmd.y, -1e7, 1e7) || !finiteIn(cmd.vx, -1e4, 1e4) || !finiteIn(cmd.vy, -1e4, 1e4)) break
        spawnShip(room, p, { x: cmd.x, y: cmd.y, vx: cmd.vx, vy: cmd.vy })
        break
      }
      if (!finiteIn(cmd.x, -1e7, 1e7) || !finiteIn(cmd.y, -1e7, 1e7) || !finiteIn(cmd.vx, -1e4, 1e4) || !finiteIn(cmd.vy, -1e4, 1e4)) break
      if (!finiteIn(cmd.mass, 1e-6, 2e6)) break
      if (!PRESET_KINDS.includes(cmd.kind as never)) break
      if (!checkSpawnBudget(room, p)) break
      if (sim.bodies.length >= 2500) break // 全房总量保险丝（与引擎碎片保险丝一致）
      const b = sim.addBody({
        kind: cmd.kind,
        x: cmd.x,
        y: cmd.y,
        vx: cmd.vx,
        vy: cmd.vy,
        mass: cmd.mass,
        visBoost: cmd.visBoost,
      })
      room.owners.set(b.id, p.id)
      break
    }
    case 'thrust': {
      // 只能推自己的飞船
      if (!finiteIn(cmd.throttle, 0, 1) || !finiteIn(cmd.x, -1, 1) || !finiteIn(cmd.y, -1, 1)) break
      const ship = sim.bodies.find((b) => b.id === p.shipId && b.alive)
      if (ship) {
        ship.thrust = cmd.throttle
        ship.thrustX = cmd.x
        ship.thrustY = cmd.y
      }
      break
    }
    case 'grab':
    case 'drag': {
      if (!canMove(room, p.id, cmd.id)) break
      if (cmd.type === 'drag' && (!finiteIn(cmd.x, -1e7, 1e7) || !finiteIn(cmd.y, -1e7, 1e7))) break
      const b = sim.bodies.find((x) => x.id === cmd.id)
      if (b) {
        b.held = true
        if (cmd.type === 'drag') {
          b.x = cmd.x
          b.y = cmd.y
          b.vx = 0
          b.vy = 0
        }
      }
      break
    }
    case 'release': {
      if (!canMove(room, p.id, cmd.id)) break
      if (!finiteIn(cmd.vx, -1e4, 1e4) || !finiteIn(cmd.vy, -1e4, 1e4)) break
      const b = sim.bodies.find((x) => x.id === cmd.id)
      if (b) {
        b.held = false
        b.vx = cmd.vx
        b.vy = cmd.vy
      }
      break
    }
    case 'remove': {
      if (!canAdmin(room, p.id, cmd.id)) break
      if (p.shipId === cmd.id) p.shipId = null
      sim.removeBody(cmd.id)
      room.owners.delete(cmd.id)
      room.grants.delete(cmd.id)
      break
    }
    case 'clear': {
      const mode = globalOpMode(room, p)
      if (mode === 'denied') break
      if (mode === 'direct') executeVote(room, { id: 0, action: 'clear', initiator: p.id, votes: new Map(), deadline: 0 })
      else callVote(room, p, 'clear')
      break
    }
    case 'rewind': {
      const mode = globalOpMode(room, p)
      if (mode === 'denied') break
      if (mode === 'direct') executeVote(room, { id: 0, action: 'rewind', initiator: p.id, votes: new Map(), deadline: 0 })
      else callVote(room, p, 'rewind')
      break
    }
    case 'pause': {
      const mode = globalOpMode(room, p)
      if (mode === 'denied') break
      if (mode === 'direct') executeVote(room, { id: 0, action: 'pause', paused: cmd.paused, initiator: p.id, votes: new Map(), deadline: 0 })
      else callVote(room, p, 'pause', undefined, cmd.paused)
      break
    }
    case 'closeRoom': {
      // 房主主动关闭：房解散，客人收到 roomClosed
      if (room.hostId === p.id && room.id !== 'lobby') dissolveRoom(room, 'host_closed')
      break
    }
    case 'perm': {
      if (!canAdmin(room, p.id, cmd.bodyId)) break
      // 不能动 owner 的权限
      if (room.owners.get(cmd.bodyId) === cmd.target) break
      let g = room.grants.get(cmd.bodyId)
      if (!g) {
        g = new Map()
        room.grants.set(cmd.bodyId, g)
      }
      if (cmd.perm === 'revoke') g.delete(cmd.target)
      else g.set(cmd.target, cmd.perm)
      // 下发最新权限表给全房间
      sendPerms(room, cmd.bodyId)
      break
    }
    case 'permquery':
      sendPerms(room, cmd.bodyId, p.ws)
      break
    case 'votecall': {
      // action 白名单：垃圾 action 会空占投票槽（room.vote 非空时新投票全部被拒）
      const actions = ['pause', 'rewind', 'clear', 'preset'] as const
      if (!actions.includes(cmd.action)) break
      callVote(room, p, cmd.action, cmd.preset, cmd.paused)
      break
    }
    case 'votecast':
      if (room.vote) {
        room.vote.votes.set(p.id, cmd.yes)
        tickVote(room)
      }
      break
    case 'getstate':
      // 存档「保存当前」：把房间宇宙的权威快照发给请求者
      send(p.ws, { type: 'worldstate', state: sim.serialize(room.preset) })
      break
    case 'hostsave': {
      // 开放到局域网：把上传的世界状态装进目标房间（省略房号 = 新建随机房），
      // 自己移入该房并成为房主（MC 语义：房主走，房没）。等价于「用存档开服」。
      // 只允许新房或无人房间——不能接管别人正在玩的房间
      const state = cmd.state
      if (!validateWorldState(state)) break
      const requested = (cmd.room ?? '').trim().slice(0, 24)
      const roomId = requested && requested !== 'lobby' ? requested : `w-${randomUUID().slice(0, 6)}` // 防呆：大厅不可被接管
      const existing = rooms.get(roomId)
      if (existing && existing.players.size > 0 && existing !== room) {
        send(p.ws, { type: 'hosted', room: '' }) // 目标房有人，拒绝接管
        break
      }
      leaveRoom(p.ws)
      const target = getRoom(roomId)
      target.sim.restoreWorld(state)
      target.preset = state.preset ?? 'empty'
      target.owners.clear()
      target.grants.clear()
      // 房间里已有的其他玩家：重发船 + 全量清单同步新世界
      for (const q of target.players.values()) {
        spawnShip(target, q)
        knownMap.set(q.ws, new Set(target.sim.bodies.map((b) => b.id)))
        send(q.ws, { type: 'manifest', bodies: target.sim.bodies.map((b) => manifestBody(target, b)) })
      }
      const me = joinRoom(p.ws, roomId)
      if (me) target.hostId = me.id // 开房人 = 房主（joinRoom 会分配新 id，必须取新的）
      send(p.ws, { type: 'hosted', room: roomId })
      break
    }
  }
}

function sendPerms(room: Room, bodyId: number, onlyWs?: WebSocket) {
  const msg: ServerMsg = {
    type: 'bodyperms',
    bodyId,
    owner: room.owners.get(bodyId) ?? null,
    grants: Object.fromEntries(room.grants.get(bodyId) ?? new Map()),
  }
  if (onlyWs) send(onlyWs, msg)
  else broadcast(room, msg)
}

// ———— 连接与房间进出 ————
const playerRoom = new Map<WebSocket, Room>()
const knownMap = new Map<WebSocket, Set<number>>()

function joinRoom(ws: WebSocket, roomId: string): Player | null {
  leaveRoom(ws)
  const room = getRoom(roomId)
  if (room.players.size >= MAX_PER_ROOM) {
    ws.close(1013, 'room full')
    return null
  }
  const names = new Set([...room.players.values()].map((p) => p.name))
  const colors = new Set([...room.players.values()].map((p) => p.color))
  const player: Player = {
    id: randomUUID().slice(0, 8),
    name: randomName(names),
    color: randomColor(colors),
    ws,
    shipId: null,
  }
  room.players.set(ws, player)
  playerRoom.set(ws, room)
  knownMap.set(ws, new Set(room.sim.bodies.map((b) => b.id)))

  send(ws, { type: 'hello', preset: room.preset, tickMs: TICK_MS })
  send(ws, { type: 'manifest', bodies: room.sim.bodies.map((b) => manifestBody(room, b)) })
  send(ws, {
    type: 'room',
    room: roomId,
    you: { id: player.id, name: player.name, color: player.color },
    players: [...room.players.values()].map((q) => ({ id: q.id, name: q.name, color: q.color })),
    host: room.hostId,
  })
  send(ws, voteMsg(room))
  broadcast(room, playersMsg(room))
  spawnShip(room, player)
  startRoomLoops(room)
  console.log(`[room ${roomId}] ${player.name} 加入（${room.players.size} 人）`)
  return player
}

function leaveRoom(ws: WebSocket) {
  const room = playerRoom.get(ws)
  if (!room) return
  const p = room.players.get(ws)
  if (p) {
    // 收回飞船；他正拖着的天体松手（否则 held 天体永远冻结）；他创造的星球保留但失去主人（变成只读）
    if (p.shipId != null) {
      room.sim.removeBody(p.shipId)
      room.owners.delete(p.shipId)
    }
    for (const b of room.sim.bodies) {
      if (room.owners.get(b.id) === p.id) b.held = false
    }
    // 他参与的投票票作废
    room.vote?.votes.delete(p.id)
    room.players.delete(ws)
    console.log(`[room ${room.id}] ${p.name} 离开（剩 ${room.players.size} 人）`)
    // MC 语义：房主走，房没——宇宙随房主消失（客人事先收到 roomClosed 可自行保存）
    if (room.hostId === p.id && room.id !== 'lobby') {
      dissolveRoom(room, 'host_left')
      playerRoom.delete(ws)
      knownMap.delete(ws)
      return
    }
  }
  playerRoom.delete(ws)
  knownMap.delete(ws)
  if (room.players.size === 0) {
    stopRoomLoops(room)
    if (room.id !== 'lobby') rooms.delete(room.id) // 私房销毁；大厅保留宇宙
  } else {
    broadcast(room, playersMsg(room))
  }
}

/** 解散房间：广播 roomClosed，断开所有玩家与该房的关联，销毁房间 */
function dissolveRoom(room: Room, reason: 'host_left' | 'host_closed') {
  broadcast(room, { type: 'roomClosed', reason })
  for (const ws of room.players.keys()) {
    playerRoom.delete(ws)
    knownMap.delete(ws)
  }
  room.players.clear()
  room.vote = null
  stopRoomLoops(room)
  rooms.delete(room.id)
  console.log(`[room ${room.id}] 已解散（${reason}）`)
}

const http = createServer((req, res) => {
  if (!HAS_STATIC) {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('stars-sandbox sim-server running. WebSocket endpoint: /ws')
    return
  }
  const url = (req.url ?? '/').split('?')[0]
  const path = url === '/' ? '/index.html' : url
  const file = join(DIST, path)
  stat(file)
    .then((s) => (s.isFile() ? readFile(file) : readFile(join(DIST, 'index.html'))))
    .then((data) => {
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
      res.end(data)
    })
    .catch(() => {
      res.writeHead(404)
      res.end('not found')
    })
})

const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: 2 * 1024 * 1024 })

wss.on('connection', (ws) => {
  ws.on('error', () => leaveRoom(ws)) // socket 级错误（含 maxPayload 超限）按断线处理，不能让进程崩
  ws.on('message', (raw) => {
    let cmd: ClientCmd
    try {
      cmd = JSON.parse(String(raw))
    } catch {
      return
    }
    // "null"/"42"/字符串都能过 JSON.parse——没有对象形状就丢弃，否则下方取属性直接崩进程
    if (!cmd || typeof cmd !== 'object' || typeof cmd.type !== 'string') return
    if (cmd.type === 'join') {
      const roomId = (cmd.room ?? 'lobby').trim().slice(0, 24) || 'lobby'
      joinRoom(ws, roomId)
      return
    }
    const room = playerRoom.get(ws)
    const p = room?.players.get(ws)
    if (!room || !p) return
    applyCmd(room, p, cmd)
  })
  ws.on('close', () => leaveRoom(ws))
})

http.listen(PORT, () => {
  console.log(`[sim-server] 联机模拟服务器已启动: 0.0.0.0:${PORT} (WebSocket: /ws, 房间制)`)
})
