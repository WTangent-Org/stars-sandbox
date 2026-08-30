// E2E 冒烟测试：联机协议全流程（进房/收帧/生成/存档/开放局域网/回退）
import WebSocket from 'ws'

const PORT = process.env.TEST_PORT ?? 8399
const url = `ws://127.0.0.1:${PORT}/ws`
let failures = 0
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`)
  if (!ok) failures++
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function connect(room) {
  const ws = new WebSocket(url)
  const msgs = []
  const frames = []
  ws.on('message', (data, isBinary) => {
    if (isBinary) frames.push(data)
    else msgs.push(JSON.parse(data.toString()))
  })
  await new Promise((res, rej) => {
    ws.on('open', res)
    ws.on('error', rej)
  })
  ws.send(JSON.stringify({ type: 'join', room }))
  await sleep(600)
  return { ws, msgs, frames }
}

// —— 客户端 1：进大厅 ——
const c1 = await connect('e2e-test')
const hello = c1.msgs.find((m) => m.type === 'hello')
const room = c1.msgs.find((m) => m.type === 'room')
const manifest = c1.msgs.find((m) => m.type === 'manifest')
check('hello 含 tickMs', hello && hello.tickMs > 80, `tickMs=${hello?.tickMs}`)
check('进房成功', room && room.room === 'e2e-test' && room.you?.name?.length > 0, room?.you?.name)
check('初始清单含天体（真实太阳系预设）', manifest && manifest.bodies.length > 5, `${manifest?.bodies.length} 天体`)
check('收到二进制帧流', c1.frames.length >= 3, `${c1.frames.length} 帧/600ms`)
const myId = room.you.id

// 进房自动发船
await sleep(300)
const manifest2 = c1.msgs.filter((m) => m.type === 'manifest').pop()
const shipEntry = c1.msgs.flatMap((m) => (m.type === 'manifest' ? m.bodies : [])).find((b) => b.kind === 'ship')
check('进房自动分配飞船', !!shipEntry, shipEntry?.name)

// —— 生成天体 + getstate 存档 ——
c1.ws.send(JSON.stringify({ type: 'spawn', kind: 'planet', x: 300, y: 0, vx: 0, vy: 0, mass: 5 }))
await sleep(400)
c1.ws.send(JSON.stringify({ type: 'getstate' }))
await sleep(400)
const world = c1.msgs.find((m) => m.type === 'worldstate')
check('getstate 返回权威世界状态', world && world.state.version === 1 && world.state.bodies.length > 5, `${world?.state.bodies.length} 天体`)
const spawned = world?.state.bodies.find((b) => Math.abs(b.x - 300) < 50 && b.kind === 'planet')
check('spawn 的行星进入权威状态', !!spawned, spawned?.name)

// —— 飞船部署到点选位置（bug#3 回归） ——
c1.ws.send(JSON.stringify({ type: 'spawn', kind: 'ship', x: -500, y: -500, vx: 0.1, vy: 0.2, mass: 0.001 }))
await sleep(400)
c1.ws.send(JSON.stringify({ type: 'getstate' }))
await sleep(400)
const world2 = c1.msgs.filter((m) => m.type === 'worldstate').pop()
const myShip = world2?.state.bodies.find((b) => b.kind === 'ship' && Math.abs(b.x + 500) < 60 && Math.abs(b.y + 500) < 60)
check('飞船部署在点选位置（非随机）', !!myShip, myShip ? `(${myShip.x.toFixed(0)}, ${myShip.y.toFixed(0)})` : '未找到')

// —— hostsave 开放到局域网 ——
const tiny = {
  version: 1,
  preset: 'empty',
  config: { G: 1, timeScale: 30, softening: 3, trails: true, trailsForever: false, paused: false },
  simTime: 0,
  merges: 0,
  bodies: [
    { id: 1, name: '测试恒星', kind: 'star', x: 0, y: 0, vx: 0, vy: 0, mass: 2000, radius: 10, color: '#ffe9b8', glow: 'rgba(255,225,160,0.6)', solid: true },
    { id: 2, name: '测试行星', kind: 'planet', x: 100, y: 0, vx: 0, vy: 4.47, mass: 1, radius: 2, color: '#7fb5d9', glow: 'rgba(127,181,217,0.35)', solid: true },
  ],
}
c1.ws.send(JSON.stringify({ type: 'hostsave', room: 'e2e-hosted', state: tiny }))
await sleep(600)
const hosted = c1.msgs.find((m) => m.type === 'hosted')
check('hostsave 返回房号', hosted && hosted.room === 'e2e-hosted', hosted?.room)
const room2 = c1.msgs.filter((m) => m.type === 'room').pop()
check('已被移入新房间', room2 && room2.room === 'e2e-hosted')

// —— 客户端 2：加入被开放的房间，应看到存档里的天体 ——
const c2 = await connect('e2e-hosted')
const manifest3 = c2.msgs.filter((m) => m.type === 'manifest').flatMap((m) => m.bodies)
check('第二个玩家看到存档天体', manifest3.some((b) => b.name === '测试恒星') && manifest3.some((b) => b.name === '测试行星'))
const roomMsg2 = c2.msgs.find((m) => m.type === 'room')
check('房间内 2 名玩家', roomMsg2 && roomMsg2.players.length === 2, roomMsg2?.players.map((p) => p.name).join(', '))

// —— 双人房（c1 是 hostsave 开房的房主）暂停：房主直接执行，不发投票 ——
// 先让房间跑 2.5s：快照每 1.5s 存一帧，攒出快照后面的回退测试才有东西可退
await sleep(2500)
c1.ws.send(JSON.stringify({ type: 'pause', paused: true }))
await sleep(400)
const vote = c2.msgs.find((m) => m.type === 'vote' && m.id >= 0)
const metaDirect = c1.msgs.filter((m) => m.type === 'meta').pop()
check('房主房间暂停由房主直接执行（无投票）', !vote && metaDirect?.paused === true, `paused=${metaDirect?.paused} vote=${!!vote}`)
// 非房主发 pause → 应被拒绝（不产生投票也不改暂停态）
c2.ws.send(JSON.stringify({ type: 'pause', paused: false }))
await sleep(400)
const vote2 = c2.msgs.find((m) => m.type === 'vote' && m.id >= 0)
const metaDenied = c1.msgs.filter((m) => m.type === 'meta').pop()
check('非房主暂停被拒绝（MC 房主语义）', !vote2 && metaDenied?.paused === true, `paused=${metaDenied?.paused}`)
// 恢复运行交给后续「投票过半」检查：房主先恢复，再由客人视角验证不受影响
c1.ws.send(JSON.stringify({ type: 'pause', paused: false }))
await sleep(300)

// —— 回退（bug#2 回归：服务器 step 现在有快照了）。c1 是房主，rewind 直接执行 ——
// 恢复运行 2s 攒快照，再暂停精确对比（暂停下 simTime 不漂移）
c1.ws.send(JSON.stringify({ type: 'pause', paused: false }))
await sleep(2000)
c1.ws.send(JSON.stringify({ type: 'pause', paused: true }))
await sleep(400)
const beforeRewind = c1.msgs.filter((m) => m.type === 'meta').pop()?.simTime ?? 0
c1.ws.send(JSON.stringify({ type: 'rewind' }))
await sleep(800)
const meta2 = c1.msgs.filter((m) => m.type === 'meta').pop()
check(
  '联机回退生效（simTime 回退）',
  meta2 && meta2.simTime < beforeRewind - 10,
  `回退前 T=${beforeRewind.toFixed(1)} → 回退后 T=${meta2?.simTime.toFixed(1)}`,
)

// —— 特效不泄漏（bug#2 回归：effects 应被老化清空而不是无限累积） ——
const effMsgs = c1.msgs.filter((m) => m.type === 'effects')
const maxEff = Math.max(0, ...effMsgs.map((m) => m.effects.length))
check('特效广播有界（无累积泄漏）', maxEff < 50, `单批最大 ${maxEff} 条 / 共 ${effMsgs.length} 批`)

c1.ws.close()
c2.ws.close()
await sleep(200)

// —— 健壮性：null 包不崩服 + NaN/1e308 spawn 被拒 + 接管有人房间被拒 ——
{
  const evil = new WebSocket(url)
  const evilMsgs = []
  evil.on('message', (d, bin) => {
    if (!bin) evilMsgs.push(JSON.parse(d.toString()))
  })
  await new Promise((r) => evil.on('open', r))
  evil.send('null') // JSON.parse → null：旧版会崩掉整个进程
  evil.send('{"type":"spawn","kind":"planet","x":NaN,"y":0,"vx":0,"vy":0,"mass":50}')
  evil.send('{"type":"spawn","kind":"planet","x":0,"y":0,"vx":0,"vy":0,"mass":1e308}')
  evil.send(JSON.stringify({ type: 'join', room: 'rob-' + Date.now() }))
  await sleep(500)
  const roomOk = evilMsgs.some((m) => m.type === 'room')
  check('null 包与 NaN/1e308 spawn 不崩服且进房正常', roomOk, `room=${roomOk}`)

  // 用另一个连接先占住一个房，evil 再尝试 hostsave 接管 → 应被拒（hosted.room 为空）
  const holder = new WebSocket(url)
  await new Promise((r) => holder.on('open', r))
  const holdRoom = 'hold-' + Date.now()
  holder.send(JSON.stringify({ type: 'join', room: holdRoom }))
  await sleep(400)
  evil.send(
    JSON.stringify({
      type: 'hostsave',
      room: holdRoom,
      state: { version: 1, config: { G: 1, timeScale: 30, softening: 3, trails: true, trailsForever: false, paused: false }, simTime: 0, merges: 0, bodies: [] },
    }),
  )
  await sleep(600)
  const hosted = evilMsgs.filter((m) => m.type === 'hosted').pop()
  check('hostsave 不能接管有人房间', hosted && hosted.room === '', `hosted.room=${hosted?.room}`)
  evil.close()
  holder.close()
}

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`)
process.exit(failures === 0 ? 0 : 1)
