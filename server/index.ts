/**
 * 星球物理模拟器 —— 远程模拟服务器
 * 物理引擎在服务端 60Hz 运行，浏览器只是「显示器 + 遥控器」：
 * - 服务端 → 客户端：二进制天体帧（默认 20Hz）、天体清单、元信息、特效
 * - 客户端 → 服务端：JSON 指令（配置/生成/推力/拖拽/预设/回退）
 * 同时用 HTTP 托管 dist/ 静态文件，单端口交付。
 *
 * 运行：node dist-server/server.js  （默认端口 8321，环境变量 PORT 覆盖）
 */
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { join, extname, resolve } from 'node:path'
import { WebSocketServer, WebSocket } from 'ws'
import { Simulation } from '../src/sim/engine'
import { loadPreset } from '../src/sim/presets'
import { encodeFrame, KIND_CODE, type ClientCmd, type ServerMsg } from '../src/shared/protocol'

const PORT = Number(process.env.PORT ?? 8321)
const DIST = resolve(process.env.DIST_DIR ?? 'dist')
// 大场景降低推流频率，省带宽
const TICK_SMALL_MS = 50 // ≤120 天体：20Hz
const TICK_LARGE_MS = 80 // 大场景：12.5Hz

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

// ———— 模拟实例（单房间：所有连入的客户端共享同一个宇宙）————
const sim = new Simulation()
sim.config.perfTier = 'ultra' // 服务器性能放开跑
loadPreset(sim, 'real')

const http = createServer((req, res) => {
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

const wss = new WebSocketServer({ server: http, path: '/ws' })

/** 每个客户端已知晓的天体 id（增量下发清单） */
const known = new Map<WebSocket, Set<number>>()

function send(ws: WebSocket, msg: ServerMsg) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
}

wss.on('connection', (ws) => {
  known.set(ws, new Set())
  send(ws, { type: 'hello', preset: 'real', tickMs: TICK_SMALL_MS })
  // 全量清单
  send(ws, {
    type: 'manifest',
    bodies: sim.bodies.map((b) => ({ id: b.id, name: b.name, kind: b.kind, color: b.color, glow: b.glow, solid: b.solid })),
  })

  ws.on('message', (raw) => {
    let cmd: ClientCmd
    try {
      cmd = JSON.parse(String(raw))
    } catch {
      return
    }
    applyCmd(cmd)
  })
  ws.on('close', () => known.delete(ws))
})

function applyCmd(cmd: ClientCmd) {
  switch (cmd.type) {
    case 'config':
      Object.assign(sim.config, cmd.patch)
      break
    case 'preset':
      loadPreset(sim, cmd.id as Parameters<typeof loadPreset>[1])
      broadcastManifest(true)
      break
    case 'spawn': {
      // 飞船唯一：放置前退役旧飞船
      if (cmd.kind === 'ship') {
        for (const s of sim.bodies.filter((b) => b.kind === 'ship')) sim.removeBody(s.id)
      }
      sim.addBody({
        kind: cmd.kind,
        x: cmd.x,
        y: cmd.y,
        vx: cmd.vx,
        vy: cmd.vy,
        mass: cmd.mass,
        visBoost: cmd.visBoost,
      })
      break
    }
    case 'thrust': {
      const ship = sim.bodies.find((b) => b.kind === 'ship' && b.alive)
      if (ship) {
        ship.thrust = cmd.throttle
        ship.thrustX = cmd.x
        ship.thrustY = cmd.y
      }
      break
    }
    case 'grab': {
      const b = sim.bodies.find((x) => x.id === cmd.id)
      if (b) b.held = true
      break
    }
    case 'drag': {
      const b = sim.bodies.find((x) => x.id === cmd.id)
      if (b) {
        b.held = true
        b.x = cmd.x
        b.y = cmd.y
        b.vx = 0
        b.vy = 0
      }
      break
    }
    case 'release': {
      const b = sim.bodies.find((x) => x.id === cmd.id)
      if (b) {
        b.held = false
        b.vx = cmd.vx
        b.vy = cmd.vy
      }
      break
    }
    case 'remove':
      sim.removeBody(cmd.id)
      break
    case 'clear':
      sim.reset()
      break
    case 'rewind':
      sim.rewind()
      break
    case 'pause':
      sim.config.paused = cmd.paused
      break
  }
}

/** 增量下发新天体的清单 */
function broadcastManifest(full = false) {
  for (const [ws, ids] of known) {
    const fresh = sim.bodies.filter((b) => full || !ids.has(b.id))
    if (fresh.length === 0) continue
    for (const b of fresh) ids.add(b.id)
    // 清理已消失 id
    if (full) {
      const alive = new Set(sim.bodies.map((b) => b.id))
      for (const id of ids) if (!alive.has(id)) ids.delete(id)
    }
    send(ws, {
      type: 'manifest',
      bodies: fresh.map((b) => ({ id: b.id, name: b.name, kind: b.kind, color: b.color, glow: b.glow, solid: b.solid })),
    })
  }
}

// ———— 主循环：物理 60Hz 恒定推进 ————
const FRAME = 1000 / 60
let last = process.hrtime.bigint()
setInterval(() => {
  const now = process.hrtime.bigint()
  const elapsed = Number(now - last) / 1e9
  last = now
  if (!sim.config.paused && wss.clients.size > 0) {
    sim.resolvePerf(60) // 服务器不关心本地 FPS，按 ultra 跑
    sim.advance(Math.min(elapsed, 1 / 30), 1)
  }
}, FRAME)

// ———— 广播循环：按场景规模节流 ————
let metaTimer = 0
setInterval(() => {
  if (wss.clients.size === 0) return
  const large = sim.bodies.length > 120
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
  for (const ws of wss.clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(frame)
  }
  broadcastManifest()
  // 特效（合并/新生闪光）
  if (sim.effects.length > 0) {
    const msg: ServerMsg = {
      type: 'effects',
      effects: sim.effects.map((e) => ({ x: e.x, y: e.y, age: e.age, ttl: e.ttl, size: e.size, color: e.color, kind: e.kind })),
    }
    for (const ws of wss.clients) send(ws, msg)
  }
  // 元信息 2Hz
  metaTimer++
  if (metaTimer % (large ? 8 : 5) === 0) {
    const msg: ServerMsg = {
      type: 'meta',
      simTime: sim.simTime,
      merges: sim.merges,
      totalMass: sim.totalMass,
      paused: sim.config.paused,
      config: {
        G: sim.config.G,
        timeScale: sim.config.timeScale,
        softening: sim.config.softening,
        trails: sim.config.trails,
        trailsForever: sim.config.trailsForever,
      },
    }
    for (const ws of wss.clients) send(ws, msg)
  }
}, TICK_SMALL_MS)

http.listen(PORT, () => {
  console.log(`[sim-server] 模拟服务器已启动: http://0.0.0.0:${PORT}  (WebSocket: /ws)`)
})
