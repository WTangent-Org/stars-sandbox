import { useState } from 'react'
import type { PresetId, SimConfig, SpawnSettings, ToolMode } from '../sim/types'
import { PRESETS } from '../sim/presets'
import { MASS_BANDS, kindForMass } from '../sim/engine'
import { fmtMass } from '../sim/format'
import type { Prefs } from '../sim/prefs'
import type { PlayerInfo } from '../shared/protocol'
import type { NetStatus } from '../sim/net'

/** 质量段上限（与引擎 MASS_BANDS 对齐，用于滑杆量程） */
const MASS_MIN = 0.0001
const MASS_MAX = 2e6

/** 性能档位：描述行为而不是硬件档次（自动档上限「高」，「极致」手动专属） */
const PERF_META: Array<{ v: SimConfig['perfTier']; label: string; desc: string }> = [
  { v: 'auto', label: '自动', desc: '按实测帧率自动升降（上限「高」）' },
  { v: 'saver', label: '省电', desc: '线性插值不补算 · 最少子步 · 短轨迹' },
  { v: 'low', label: '低', desc: '线性插值不补算 · 较少子步' },
  { v: 'balanced', label: '均衡', desc: '客户端补算 · 标准子步与轨迹' },
  { v: 'high', label: '高', desc: '客户端补算 · 更多子步 · 长轨迹' },
  { v: 'ultra', label: '极致', desc: '手动专属：最大子步与特效，重负载场景慎用' },
]

function ToggleRow(props: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-[12px] text-[#dbe4f3]/85">{props.label}</span>
      <button className="mg-toggle" data-on={props.on} onClick={() => props.onChange(!props.on)} aria-label={props.label} />
    </div>
  )
}

function Seg<T extends string | number>({ value, options, onPick }: { value: T; options: Array<{ v: T; label: string }>; onPick: (v: T) => void }) {
  return (
    <div className="flex overflow-hidden rounded-md border border-[#5b6b8c]/25">
      {options.map((o) => (
        <button
          key={String(o.v)}
          onClick={() => onPick(o.v)}
          className={`px-2.5 py-1 text-[11px] transition-all ${
            value === o.v ? 'bg-[#5b6b8c]/30 text-[#dbe4f3]' : 'text-[#5b6b8c]/60 hover:bg-[#5b6b8c]/10'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div>
        <div className="text-[12px] text-[#dbe4f3]/90">{label}</div>
        {hint && <div className="mt-0.5 text-[10px] leading-relaxed text-[#5b6b8c]/50">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

export type DockTab = 'scene' | 'create' | 'ship' | 'net' | 'settings'

const TABS: Array<{ id: DockTab; label: string }> = [
  { id: 'scene', label: '场景' },
  { id: 'create', label: '创建' },
  { id: 'ship', label: '飞船' },
  { id: 'net', label: '联机' },
  { id: 'settings', label: '设置' },
]

export interface DockNetInfo {
  status: NetStatus
  online: boolean
  room: string
  players: PlayerInfo[]
  youId?: string
  /** 房主玩家名；null = 公共大厅等无主房间 */
  hostName: string | null
  isHost: boolean
}

interface Props {
  config: SimConfig
  onConfig: (patch: Partial<SimConfig>) => void
  mode: ToolMode
  onMode: (m: ToolMode) => void
  spawn: SpawnSettings
  onSpawn: (patch: Partial<SpawnSettings>) => void
  currentPreset: PresetId
  onPreset: (id: PresetId) => void
  onResetScene: () => void
  onClear: () => void
  hasShip: boolean
  onDeployShip: () => void
  prefs: Prefs
  onPrefs: (patch: Partial<Prefs>) => void
  net: DockNetInfo
  onReconnect: () => void
  onCloseRoom: () => void
  /** 抽屉把手：点击后收起整个停靠栏（由父级切换） */
  onCollapse?: () => void
  /** 初始 tab（进入游戏后跳指定页等场景用） */
  tab?: DockTab
}

/** 左侧停靠栏：场景/创建/飞船/联机/设置 五页合一 */
export default function Dock(p: Props) {
  const [tab, setTab] = useState<DockTab>(p.tab ?? 'scene')
  // 类型由质量唯一决定（与引擎同一张质量段表）；滑杆在对数质量轴上滑动
  const mass = p.spawn.mass
  const kind = p.spawn.kind === 'ship' ? 'ship' : kindForMass(mass)
  const band = MASS_BANDS.slice().reverse().find((b) => mass >= b.min) ?? MASS_BANDS[0]
  const massToSlider = (m: number) =>
    ((Math.log10(Math.max(m, MASS_MIN)) - Math.log10(MASS_MIN)) / (Math.log10(MASS_MAX) - Math.log10(MASS_MIN))) * 100
  const sliderToMass = (s: number) => {
    const v = Math.pow(10, Math.log10(MASS_MIN) + (s / 100) * (Math.log10(MASS_MAX) - Math.log10(MASS_MIN)))
    return Math.min(MASS_MAX, Math.max(MASS_MIN, parseFloat(v.toPrecision(3))))
  }

  const netStatusLabel = p.net.online
    ? '已连接'
    : { disconnected: '离线 · 单机', connecting: '连接中…', error: '连接失败' }[p.net.status as Exclude<NetStatus, 'connected'>]

  return (
    <div className="glass mg-fadeup pointer-events-auto flex max-h-[calc(100dvh-96px)] w-[min(300px,88vw)] flex-col overflow-hidden rounded-lg">
      {/* Tab 头 + 抽屉把手 */}
      <div className="flex items-stretch border-b border-[#1a2540]">
        <div className="grid flex-1 grid-cols-5">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`py-2 text-[11px] transition-colors ${
                tab === t.id ? 'bg-[#22d3ee]/10 text-[#22d3ee]' : 'text-[#5b6b8c] hover:text-[#dbe4f3]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {p.onCollapse && (
          <button
            onClick={p.onCollapse}
            title="收起面板"
            className="px-3 font-mono text-[12px] text-[#5b6b8c] transition-colors hover:text-[#dbe4f3]"
          >
            −
          </button>
        )}
      </div>
      <div className="mg-scroll space-y-3 overflow-y-auto p-4">
        {tab === 'scene' && (
          <>
            <div className="grid grid-cols-2 gap-1.5">
              {PRESETS.map((pr) => (
                <button
                  key={pr.id}
                  onClick={() => p.onPreset(pr.id)}
                  title={pr.desc}
                  className={`rounded border px-2 py-1.5 text-left text-[12px] transition-all duration-150 ${
                    p.currentPreset === pr.id
                      ? 'border-[#22d3ee]/60 bg-[#22d3ee]/10 text-[#dbe4f3] shadow-[0_0_12px_rgba(34,211,238,0.18)]'
                      : 'border-[#1a2540] bg-transparent text-[#dbe4f3]/55 hover:border-[#22d3ee]/35 hover:text-[#dbe4f3]'
                  }`}
                >
                  {pr.label}
                </button>
              ))}
            </div>
            <div className="flex gap-1.5">
              <button
                onClick={p.onResetScene}
                className="flex-1 rounded border border-[#1a2540] px-2 py-1.5 text-[12px] text-[#dbe4f3]/70 transition-all hover:border-[#22d3ee]/35 hover:text-[#dbe4f3]"
              >
                重置场景
              </button>
              <button
                onClick={p.onClear}
                className="rounded border border-[#f87171]/25 px-2 py-1.5 text-[12px] text-[#f87171]/80 transition-all hover:border-[#f87171]/50 hover:text-[#f87171]"
              >
                清空
              </button>
            </div>
            <p className="text-[10px] leading-relaxed text-[#5b6b8c]">
              {p.net.online ? '联机中：切换预设/清空需全员投票过半同意。' : '离线单机中，操作直接生效。'}
            </p>
            <div className="border-t border-[#1a2540] pt-2">
              <ToggleRow label="轨道轨迹" on={p.config.trails} onChange={(v) => p.onConfig({ trails: v })} />
              <ToggleRow label="永久轨迹（不裁剪）" on={p.config.trailsForever} onChange={(v) => p.onConfig({ trailsForever: v })} />
            </div>
          </>
        )}

        {tab === 'create' && (
          <>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                onClick={() => p.onMode('pan')}
                className={`rounded border px-2 py-1.5 text-[12px] transition-all ${
                  p.mode === 'pan'
                    ? 'border-[#22d3ee]/60 bg-[#22d3ee]/10 text-[#dbe4f3]'
                    : 'border-[#1a2540] text-[#dbe4f3]/55 hover:border-[#22d3ee]/35'
                }`}
              >
                ✥ 观察 / 拖动
              </button>
              <button
                onClick={() => p.onMode('spawn')}
                className={`rounded border px-2 py-1.5 text-[12px] transition-all ${
                  p.mode === 'spawn'
                    ? 'border-[#22d3ee]/60 bg-[#22d3ee]/10 text-[#dbe4f3]'
                    : 'border-[#1a2540] text-[#dbe4f3]/55 hover:border-[#22d3ee]/35'
                }`}
              >
                ✦ 创建天体
              </button>
            </div>
            {/* 类型 = 质量段：一个滑杆定生死，各质量段边界一目了然 */}
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between">
                <span className="mg-label">天体质量</span>
                <span className="font-mono text-[11px] text-[#dbe4f3]">{fmtMass(mass)} M*</span>
              </div>
              <input
                type="range"
                className="mg-slider"
                style={{ ['--fill' as string]: `${massToSlider(mass)}%` }}
                min={0}
                max={100}
                step={0.5}
                value={massToSlider(mass)}
                onChange={(e) => p.onSpawn({ kind: kindForMass(sliderToMass(parseFloat(e.target.value))), mass: sliderToMass(parseFloat(e.target.value)) })}
              />
              <div className="flex justify-between font-mono text-[8px] text-[#5b6b8c]/50">
                {MASS_BANDS.map((b) => (
                  <span key={b.kind} className={b.kind === kind ? 'text-[#22d3ee]' : undefined}>
                    {b.label}
                  </span>
                ))}
              </div>
            </div>
            <p className="rounded border border-[#1a2540] px-2 py-1.5 text-[10.5px] leading-relaxed text-[#5b6b8c]">
              <span className="text-[#dbe4f3]/90">{band.label}</span> · {band.desc}
              {kind === 'star' && mass < 800 ? '（红矮星）' : kind === 'star' && mass < 4000 ? '（类日）' : kind === 'star' && mass < 16000 ? '（蓝白巨星）' : kind === 'star' ? '（超巨星）' : ''}
            </p>
            <ToggleRow label="自动圆轨道（绕最近主星）" on={p.spawn.autoOrbit} onChange={(v) => p.onSpawn({ autoOrbit: v })} />
            <p className="text-[10.5px] leading-relaxed text-[#5b6b8c]">
              {p.mode === 'spawn'
                ? '点击放置（自动圆轨道开启时获得环绕速度）；按住拖拽则拉出虚线，拖拽方向 = 初速度（优先于圆轨道）。'
                : '切换到「创建天体」后，在画布上点击或拖拽即可放置新天体。'}
            </p>
          </>
        )}

        {tab === 'ship' && (
          <>
            <button
              onClick={p.onDeployShip}
              className={`w-full rounded border px-2 py-2 text-[12px] transition-all ${
                p.mode === 'spawn' && p.spawn.kind === 'ship'
                  ? 'border-[#34d399]/60 bg-[#34d399]/10 text-[#34d399]'
                  : 'border-[#1a2540] text-[#dbe4f3]/70 hover:border-[#34d399]/40 hover:text-[#dbe4f3]'
              }`}
            >
              {p.hasShip ? '⇢ 重新部署飞船（替换现有）' : '⇢ 部署飞船'}
            </button>
            <p className="text-[10.5px] leading-relaxed text-[#5b6b8c]">
              {p.net.online
                ? '联机中每人一艘飞船：点击按钮后在画布上点选部署位置。'
                : p.hasShip
                  ? '全场只允许一艘飞船。点击按钮后在画布上点选新位置，旧飞船将退役。'
                  : '点击按钮进入部署模式，在画布上点击放置飞船（自动进入环绕轨道）。'}
            </p>
            <div className="border-t border-[#1a2540] pt-2">
              <Row label="摇杆模式" hint="固定：摇杆常驻角落；随手：手指落在哪摇杆就在哪">
                <Seg
                  value={p.prefs.joyMode}
                  options={[
                    { v: 'fixed', label: '固定' },
                    { v: 'float', label: '随手' },
                  ]}
                  onPick={(v) => p.onPrefs({ joyMode: v })}
                />
              </Row>
              <Row label="摇杆位置" hint="固定模式的停靠侧；随手模式的触发热区">
                <Seg
                  value={p.prefs.joySide}
                  options={[
                    { v: 'left', label: '左侧' },
                    { v: 'right', label: '右侧' },
                  ]}
                  onPick={(v) => p.onPrefs({ joySide: v })}
                />
              </Row>
            </div>
          </>
        )}

        {tab === 'net' && (
          <>
            <div className="flex items-center justify-between">
              <span className="text-[12px] text-[#dbe4f3]/90">连接状态</span>
              <span
                className={`font-mono text-[10px] ${
                  p.net.online ? 'text-[#34d399]' : p.net.status === 'connecting' ? 'text-[#fbbf24]' : 'text-[#f87171]'
                }`}
              >
                {netStatusLabel}
              </span>
            </div>
            {!p.net.online && (
              <p className="rounded border border-[#1a2540] px-2.5 py-2 text-[10.5px] leading-relaxed text-[#5b6b8c]">
                {p.net.status === 'connecting' ? (
                  <span className="text-[#fbbf24]">连接中…</span>
                ) : (
                  <>
                    当前是本地单机宇宙。要联机：回主菜单选「多人游戏」加入大厅/房号；或在游戏菜单（右上 ☰）把当前宇宙「对局域网开放」给朋友。
                  </>
                )}
              </p>
            )}
            {p.net.online && (
              <>
                <Row label="房间" hint="留空 = 公共大厅；填房号 = 加入/创建私房（把房号发给朋友即可一起玩）">
                  <input
                    className="w-36 rounded border border-[#1a2540] bg-[#0c1220] px-2 py-1 font-mono text-[11px] text-[#dbe4f3] outline-none focus:border-[#22d3ee]/50"
                    placeholder="公共大厅"
                    defaultValue={p.prefs.roomCode}
                    onBlur={(e) => p.onPrefs({ roomCode: e.target.value.trim() })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                    }}
                  />
                </Row>
                <div className="border-t border-[#1a2540] pt-2">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-[12px] text-[#dbe4f3]/90">在线玩家</span>
                    <span className="font-mono text-[10px] text-[#5b6b8c]/60">{p.net.room === 'lobby' ? '公共大厅' : `房间 ${p.net.room}`}</span>
                  </div>
                  <div className="space-y-1">
                    {p.net.players.map((pl) => (
                      <div key={pl.id} className="flex items-center gap-2 text-[11px]">
                        <span className="h-2 w-2 rounded-full" style={{ background: pl.color, boxShadow: `0 0 5px ${pl.color}` }} />
                        <span className="text-[#dbe4f3]/85">{pl.name}</span>
                        {pl.id === p.net.youId && <span className="text-[9px] text-[#22d3ee]/70">（你）</span>}
                        {pl.id === p.net.hostName && <span className="text-[9px] text-[#fbbf24]/80">（房主）</span>}
                      </div>
                    ))}
                  </div>
                </div>
                {p.net.hostName && (
                  <div className="border-t border-[#1a2540] pt-2">
                    {p.net.isHost ? (
                      <>
                        <p className="text-[10.5px] text-[#fbbf24]/85">你是本房间房主：暂停 / 回退 / 清空 / 切预设由你直接执行。</p>
                        <button
                          onClick={p.onCloseRoom}
                          className="mt-1.5 w-full rounded border border-[#f87171]/30 px-2 py-1.5 text-[11px] text-[#f87171]/85 hover:border-[#f87171]/60"
                        >
                          ✕ 关闭房间（客人将回到大厅/离线）
                        </button>
                      </>
                    ) : (
                      <p className="text-[10.5px] leading-relaxed text-[#5b6b8c]">
                        房主：{p.net.hostName}。全局操作（暂停/回退/清空/切预设）由房主执行；你的星球与飞船归你管。
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
            <p className="text-[10px] leading-relaxed text-[#5b6b8c]/50">
              默认以本地存档离线单机。连接服务器后进入大厅/房间联机：物理由服务器统一运算，客户端按性能档位补算帧间物理；断线自动回到离线单机。「对局域网开放」在游戏菜单（Esc）里。
            </p>
          </>
        )}

        {tab === 'settings' && (
          <>
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between">
                <span className="mg-label">性能档位</span>
                <span className="font-mono text-[11px] text-[#22d3ee]">{PERF_META.find((t) => t.v === p.config.perfTier)?.label}</span>
              </div>
              <div className="grid grid-cols-3 gap-1">
                {PERF_META.map((t) => (
                  <button
                    key={t.v}
                    onClick={() => p.onConfig({ perfTier: t.v })}
                    title={t.desc}
                    className={`rounded border px-1 py-1 font-mono text-[10px] transition-all ${
                      p.config.perfTier === t.v
                        ? 'border-[#22d3ee]/60 bg-[#22d3ee]/15 text-[#22d3ee]'
                        : 'border-[#1a2540] text-[#dbe4f3]/55 hover:border-[#22d3ee]/35'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <p className="text-[10px] leading-relaxed text-[#5b6b8c]">
                {PERF_META.find((t) => t.v === p.config.perfTier)?.desc} · 档位控制客户端补算精度、轨迹长度与特效数量。
              </p>
            </div>
            <div className="border-t border-[#1a2540] pt-2">
              <Row label="未来预演时长" hint="影子模拟领先画面的秒数，决定飞船虚线画多远（离线单机时生效）">
                <Seg
                  value={p.prefs.leadSeconds}
                  options={[
                    { v: 3, label: '3s' },
                    { v: 6, label: '6s' },
                    { v: 10, label: '10s' },
                    { v: 20, label: '20s' },
                  ]}
                  onPick={(v) => p.onPrefs({ leadSeconds: v })}
                />
              </Row>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
