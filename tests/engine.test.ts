/**
 * 引擎单元测试（node:test，npx tsx --test 运行）。
 * 覆盖：质量段、并合重新定级、恒星生命周期、碰撞三结局、存档往返。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  Simulation,
  kindForMass,
  MASS_BANDS,
  starStageFor,
  starEvolutionRate,
} from '../src/sim/engine.ts'
import type { WorldState } from '../src/sim/types.ts'

// ———— 质量段 ————

test('kindForMass：五段边界', () => {
  assert.equal(kindForMass(0.05), 'asteroid')
  assert.equal(kindForMass(0.1), 'moon') // 段边界归上段
  assert.equal(kindForMass(5), 'moon')
  assert.equal(kindForMass(10), 'planet')
  assert.equal(kindForMass(23999), 'planet')
  assert.equal(kindForMass(24000), 'star')
  assert.equal(kindForMass(499999), 'star')
  assert.equal(kindForMass(500000), 'blackhole')
})

test('MASS_BANDS：min 单调递增且覆盖到 0', () => {
  for (let i = 1; i < MASS_BANDS.length; i++) {
    assert.ok(MASS_BANDS[i].min > MASS_BANDS[i - 1].min)
  }
  assert.equal(MASS_BANDS[0].min, 0)
})

// ———— 并合重新定级 ————

function settle(frames: number, setup: (s: Simulation) => void): Simulation {
  const s = new Simulation()
  setup(s)
  for (let i = 0; i < frames; i++) s.advance(1 / 60, 1)
  return s
}

test('低速卫星对撞 → 并合升级为行星', () => {
  const s = settle(900, (sim) => {
    sim.addBody({ kind: 'moon', x: -5, y: 0, mass: 8, vx: 1 })
    sim.addBody({ kind: 'moon', x: 5, y: 0, mass: 8, vx: -1 })
  })
  const big = s.bodies.find((b) => b.mass >= 15)
  assert.ok(big, '应存在 16 质量的并合体')
  assert.equal(big.kind, 'planet')
})

test('行星并合跨越点燃线 → 恒星', () => {
  // 贴脸低速：必然并合；12000+13000=25000 > 24000
  const s = settle(600, (sim) => {
    sim.addBody({ kind: 'planet', x: -6, y: 0, mass: 12000 })
    sim.addBody({ kind: 'planet', x: 6, y: 0, mass: 13000 })
  })
  const star = s.bodies.find((b) => b.kind === 'star' && b.mass >= 24000)
  assert.ok(star, '应点燃为恒星')
})

// ———— 恒星生命周期 ————

test('starStageFor：白矮星路径（低质量+高吞并）', () => {
  const st = starStageFor(5000, 0.5 * 5000)
  assert.equal(st.stage, 'whitedwarf')
  const giant = starStageFor(5000, 0.2 * 5000)
  assert.equal(giant.stage, 'giant')
})

test('starStageFor：超新星路径（高质量+高吞并）→ blackhole', () => {
  const st = starStageFor(90000, 0.3 * 90000)
  assert.equal(st.stage, 'blackhole')
})

test('岁月演化：大质量恒星随模拟时间衰老 → 超新星塌缩为黑洞', () => {
  const s = new Simulation()
  const star = s.addBody({ kind: 'star', x: 0, y: 0, mass: 85000 })
  assert.equal(star.lifeStage, 'main')
  let collapsed = false
  for (let i = 0; i < 60 * 600; i++) {
    s.advance(1 / 60, 1)
    if (star.kind === 'blackhole') {
      collapsed = true
      break
    }
  }
  assert.ok(collapsed, '85000 质量恒星应在 600 模拟秒内塌缩')
})

test('岁月演化速率：质量越大越快', () => {
  assert.ok(starEvolutionRate(85000) > starEvolutionRate(30000))
  assert.ok(starEvolutionRate(30000) > 0)
})

test('小质量恒星长期不塌缩（红矮星寿命长）', () => {
  const s = new Simulation()
  const star = s.addBody({ kind: 'star', x: 0, y: 0, mass: 25000 })
  for (let i = 0; i < 60 * 60; i++) s.advance(1 / 60, 1)
  assert.equal(star.kind, 'star', '25000 质量恒星 60 模拟秒内不应塌缩')
})

// ———— 碰撞三结局 ————

test('高速对撞 → 碎裂（碎片群）', () => {
  const s = settle(240, (sim) => {
    sim.addBody({ kind: 'planet', x: -40, y: 0, mass: 800, vx: 40 })
    sim.addBody({ kind: 'planet', x: 40, y: 0, mass: 800, vx: -40 })
  })
  assert.ok(s.bodies.length > 2, `碎片群应多于 2 体，实际 ${s.bodies.length}`)
  assert.ok(s.bodies.some((b) => b.kind === 'asteroid'), '应产生小行星碎片')
})

test('中速对撞 → 反弹溅屑后吸积为一颗（不碎裂成群）', () => {
  const s = new Simulation()
  // relV≈25 ≈ 0.8 vEsc → 反弹分支：溅屑但弹不开（反弹速度 < 当地逃逸），最终吸积
  s.addBody({ kind: 'planet', x: -7, y: 0, mass: 3000, vx: 12.5 })
  s.addBody({ kind: 'planet', x: 7, y: 0, mass: 3000, vx: -12.5 })
  for (let i = 0; i < 10; i++) s.advance(1 / 60, 1)
  const planets = s.bodies.filter((b) => b.kind === 'planet')
  const asteroids = s.bodies.filter((b) => b.kind === 'asteroid')
  assert.equal(planets.length, 1, '中速对撞最终吸积为一颗')
  const total = s.bodies.reduce((a, b) => a + b.mass, 0)
  assert.ok(Math.abs(total - 6000) < 1, `质量守恒（碎屑在外），实际 ${total.toFixed(2)}`)
  assert.ok(asteroids.length <= 6, `碎屑少量（溅射非碎裂），实际 ${asteroids.length}`)
})

test('黑洞接触必吞噬（卫星从外部坠入）', () => {
  const s = new Simulation()
  // 从视界外 3 倍半径处坠入（初始置于视界内会被 PW 势第一步踢飞——数值虫洞）
  const bh = s.addBody({ kind: 'blackhole', x: 0, y: 0, mass: 20000 })
  const moon = s.addBody({ kind: 'moon', x: 20, y: 0, mass: 8, vx: -30 })
  let swallowed = false
  for (let i = 0; i < 1800; i++) {
    s.advance(1 / 60, 1)
    if (!s.bodies.includes(moon)) {
      swallowed = true
      break
    }
  }
  void bh
  assert.ok(swallowed, '卫星坠入应被黑洞吞噬')
  assert.ok(s.bodies.some((b) => b.kind === 'blackhole'), '黑洞存活')
})

test('黑洞并合恒星：结果必为黑洞', () => {
  const s = new Simulation()
  s.addBody({ kind: 'blackhole', x: -20, y: 0, mass: 5000, vx: 5 })
  s.addBody({ kind: 'star', x: 20, y: 0, mass: 40000, vx: -5 })
  for (let i = 0; i < 900; i++) s.advance(1 / 60, 1)
  const merged = s.bodies.find((b) => b.mass >= 40000)
  assert.ok(merged, '并合体存在')
  assert.equal(merged.kind, 'blackhole', '恒星质量再大也坠入黑洞')
})

// ———— 存档往返 ————

test('serialize → restoreWorld 往返保持状态', () => {
  const s = new Simulation()
  s.addBody({ kind: 'star', x: 0, y: 0, mass: 2000, name: '测试星' })
  s.addBody({ kind: 'planet', x: 100, y: 0, mass: 50, vx: 3, vy: 1 })
  s.simTime = 123.45
  s.merges = 7
  const state: WorldState = s.serialize('solar')

  const s2 = new Simulation()
  s2.restoreWorld(state)
  assert.equal(s2.bodies.length, 2)
  assert.equal(s2.simTime, 123.45)
  assert.equal(s2.merges, 7)
  assert.equal(s2.bodies[0].name, '测试星')
  assert.equal(s2.bodies[0].kind, 'star')
  assert.equal(s2.bodies[1].mass, 50)
  assert.equal(s2.bodies[1].vx, 3)
  assert.equal(s2.config.timeScale, state.config.timeScale)
})

test('restoreWorld 后 nextId 正确（新天体 id 不冲突）', () => {
  const s = new Simulation()
  s.addBody({ kind: 'star', x: 0, y: 0, mass: 2000 })
  s.addBody({ kind: 'planet', x: 100, y: 0, mass: 50 })
  const state = s.serialize()
  const s2 = new Simulation()
  s2.restoreWorld(state)
  s2.addBody({ kind: 'moon', x: 0, y: 50, mass: 1 })
  const ids = new Set(s2.bodies.map((b) => b.id))
  assert.equal(ids.size, s2.bodies.length, 'id 不得重复')
})
