import { useState } from 'react'
import type { PresetId, SimConfig, SpawnSettings, ToolMode } from '../sim/types'
import { PRESETS } from '../sim/presets'
import { MASS_BANDS, kindForMass } from '../sim/engine'
import type { Prefs } from '../sim/prefs'
import type { PlayerInfo } from '../shared/protocol'
import type { NetStatus } from '../sim/net'
import type { SaveMeta } from '../sim/saveStore'
import ModeList from './ModeList'

/** 质量段滑杆量程（与引擎 MASS_BANDS 对齐） */
const MASS_MIN = 0.0001
const MASS_MAX = 2e6

export type DockTab = 'world' | 'create' | 'system'

const TABS: Array<{ id: DockTab; label: string }> = [
  { id: 'world', label: '世界' },
  { id: 'create', label: '创造' },
  { id: 'system', label: '系统' },
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
  onCloseRoom: () => void
  /** 联机中一键切回单机：宇宙存入本地并离线继续（无需回主菜单） */
  onBackToSingle: () => void
  // —— 存档（世界页内嵌） ——
  saves: SaveMeta[]
  saveMsg: string
  onSaveCurrent: () => void
  onLoadSave: (id: string) => void
  onDeleteSave: (id: string) => void
  onExportSave: (id: string) => void
  onImportSave: () => void
  // —— 模式切换：大厅 / 房间列表 / 新建房间 ——
  lastRoom?: string
  roomList: Array<{ id: string; players: number; host: boolean }>
  onJoinRoom: (id: string) => void
  onNewRoom: () => void
  onRefreshRooms: () => void
}

const PERF_META: Array<{ v: SimConfig['perfTier']; label: string; desc: string }> = [
  { v: 'auto', label: '自动', desc: '按实测帧率自动升降（上限「高」）' },
  { v: 'saver', label: '省电', desc: '线性插值不补算 · 最少子步 · 短轨迹' },
  { v: 'low', label: '低', desc: '线性插值不补算 · 较少子步' },
  { v: 'balanced', label: '均衡', desc: '客户端补算 · 标准子步与轨迹' },
  { v: 'high', label: '高', desc: '客户端补算 · 更多子步 · 长轨迹' },
  { v: 'ultra', label: '极致', desc: '手动专属：最大子步与特效，重负载场景慎用' },
]

function fmtMassSlider(m: number): string {
  if (m >= 10000) return (m / 1000).toFixed(1) + 'k'
  if (m >= 100) return m.toFixed(0)
  if (m >= 1) return m.toFixed(2)
  if (m >= 0.001) return m.toFixed(4)
  return m.toExponential(1)
}

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

/** 左侧停靠栏：世界 / 创造 / 系统 三页 */
export default function Dock(p: Props) {
  const [tab, setTab] = useState<DockTab>('world')
  const mass = p.spawn.mass
  const kind = p.spawn.kind === 'ship' ? 'ship' : kindForMass(mass)
  const band = MASS_BANDS.slice().reverse().find((b) => mass >= b.min) ?? MASS_BANDS[0]
  const massToSlider = (m: number) =>
    ((Math.log10(Math.max(m, MASS_MIN)) - Math.log10(MASS_MIN)) / (Math.log10(MASS_MAX) - Math.log10(MASS_MIN))) * 100
  const sliderToMass = (s: number) => {
    const v = Math.pow(10, Math.log10(MASS_MIN) + (s / 100) * (Math.log10(MASS_MAX) - Math.log10(MASS_MIN)))
    return Math.min(MASS_MAX, Math.max(MASS_MIN, parseFloat(v.toPrecision(3))))
  }

  return (
    <div className="glass mg-fadeup pointer-events-auto flex max-h-[calc(100dvh-140px)] w-[min(280px,88vw)] flex-col overflow-hidden rounded-lg">
      {/* Tab 头 */}
      <div className="grid grid-cols-3 border-b border-[#1a2540]">
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
      <div className="mg-scroll space-y-3 overflow-y-auto p-4">
        {/* ———— 世界：预设 + 存档 ———— */}
        {tab === 'world' && (
          <>
            <div className="flex items-center justify-between">
              <span className="mg-label">进入宇宙</span>
              <button onClick={p.onRefreshRooms} title="刷新房间列表" className="rounded border border-[#1a2540] px-1.5 py-0.5 font-mono text-[10px] text-[#5b6b8c] hover:text-[#dbe4f3]">
                ↻
              </button>
            </div>
            <ModeList
              rooms={p.roomList}
              saves={p.saves}
              currentRoom={p.net.online ? p.net.room : undefined}
              onLoadSave={p.onLoadSave}
              onDeleteSave={p.onDeleteSave}
              onExportSave={p.onExportSave}
              onJoinRoom={p.onJoinRoom}
            />
            <button
              onClick={p.onNewRoom}
              className="w-full rounded border border-[#34d399]/40 bg-[#34d399]/10 px-2 py-1.5 text-[11.5px] text-[#34d399] transition-all hover:bg-[#34d399]/20"
            >
              ＋ 新建房间（把当前宇宙开成联机房）
            </button>
            {p.saveMsg && <p className="font-mono text-[10px] text-[#34d399]">{p.saveMsg}</p>}
            <button
              onClick={p.onSaveCurrent}
              className="w-full rounded border border-[#22d3ee]/40 bg-[#22d3ee]/10 px-2 py-1.5 text-[11.5px] text-[#dbe4f3] transition-all hover:bg-[#22d3ee]/20"
            >
              ⬇ 保存当前宇宙到本地
            </button>
            <div className="flex items-center justify-between border-t border-[#1a2540] pt-2">
              <span className="mg-label">场景模板</span>
              <button onClick={p.onImportSave} className="rounded border border-[#1a2540] px-2 py-1 text-[10px] text-[#dbe4f3]/70 hover:border-[#22d3ee]/35">
                导入 .json
              </button>
            </div>
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
          </>
        )}

        {tab === 'create' && (
          <>
            <div className="flex gap-1.5">
              <button
                onClick={() => p.onMode('pan')}
                className={`flex-1 rounded border px-2 py-1.5 text-[12px] transition-all ${
                  p.mode === 'pan' ? 'border-[#22d3ee]/60 bg-[#22d3ee]/10 text-[#dbe4f3]' : 'border-[#1a2540] text-[#dbe4f3]/55 hover:border-[#22d3ee]/35'
                }`}
              >
                ✥ 观察
              </button>
              <button
                onClick={() => p.onMode('spawn')}
                className={`flex-1 rounded border px-2 py-1.5 text-[12px] transition-all ${
                  p.mode === 'spawn' ? 'border-[#22d3ee]/60 bg-[#22d3ee]/10 text-[#dbe4f3]' : 'border-[#1a2540] text-[#dbe4f3]/55 hover:border-[#22d3ee]/35'
                }`}
              >
                ✦ 创建
              </button>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between">
                <span className="mg-label">天体质量</span>
                <span className="font-mono text-[11px] text-[#dbe4f3]">{fmtMassSlider(mass)} M*</span>
              </div>
              <input
                type="range"
                className="mg-slider"
                style={{ ['--fill' as string]: `${massToSlider(mass)}%` }}
                min={0}
                max={100}
                step={0.5}
                value={massToSlider(mass)}
                onChange={(e) => {
                  const m = sliderToMass(parseFloat(e.target.value))
                  p.onSpawn({ kind: kindForMass(m), mass: m })
                }}
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
            </p>
            <ToggleRow label="自动圆轨道（绕最近主星）" on={p.spawn.autoOrbit} onChange={(v) => p.onSpawn({ autoOrbit: v })} />
            <div className="border-t border-[#1a2540] pt-2">
              <button
                onClick={p.onDeployShip}
                className={`w-full rounded border px-2 py-2 text-[12px] transition-all ${
                  p.mode === 'spawn' && p.spawn.kind === 'ship'
                    ? 'border-[#34d399]/60 bg-[#34d399]/10 text-[#34d399]'
                    : 'border-[#1a2540] text-[#dbe4f3]/70 hover:border-[#34d399]/40 hover:text-[#dbe4f3]'
                }`}
              >
                {p.hasShip ? '⇢ 重新部署飞船' : '⇢ 部署飞船'}
              </button>
              <p className="mt-1.5 text-[10px] leading-relaxed text-[#5b6b8c]">
                {p.net.online ? '联机每人一艘，点选部署位置。' : p.hasShip ? '部署新船会替换旧船。' : '点击按钮后在画布上放置。'}
              </p>
            </div>
          </>
        )}

        {/* ———— 系统：性能 / 轨迹 / 摇杆 / 联机 ———— */}
        {tab === 'system' && (
          <>
            <div className="space-y-1">
              <span className="mg-label">性能档位</span>
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
            </div>
            <ToggleRow label="轨道轨迹" on={p.config.trails} onChange={(v) => p.onConfig({ trails: v })} />
            <ToggleRow label="永久轨迹（不裁剪）" on={p.config.trailsForever} onChange={(v) => p.onConfig({ trailsForever: v })} />
            <div className="flex items-center justify-between py-0.5">
              <span className="text-[12px] text-[#dbe4f3]/85">预演时长</span>
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
            </div>
            <div className="flex items-center justify-between py-0.5">
              <span className="text-[12px] text-[#dbe4f3]/85">摇杆</span>
              <Seg
                value={p.prefs.joyMode}
                options={[
                  { v: 'fixed', label: '固定' },
                  { v: 'float', label: '随手' },
                ]}
                onPick={(v) => p.onPrefs({ joyMode: v })}
              />
            </div>
            <div className="flex items-center justify-between py-0.5">
              <span className="text-[12px] text-[#dbe4f3]/85">摇杆位置</span>
              <Seg
                value={p.prefs.joySide}
                options={[
                  { v: 'left', label: '左' },
                  { v: 'right', label: '右' },
                ]}
                onPick={(v) => p.onPrefs({ joySide: v })}
              />
            </div>
            {/* —— 联机状态（只读展示；加入在主菜单，开放在游戏菜单） —— */}
            <div className="border-t border-[#1a2540] pt-2">
              <div className="flex items-center justify-between">
                <span className="mg-label">联机</span>
                <span
                  className={`font-mono text-[10px] ${
                    p.net.online ? 'text-[#34d399]' : p.net.status === 'connecting' ? 'text-[#fbbf24]' : 'text-[#f87171]'
                  }`}
                >
                  {p.net.online ? (p.net.room === 'lobby' ? '公共大厅' : `房间 ${p.net.room}`) : '离线单机'}
                </span>
              </div>
              {p.net.online && (
                <>
                  <div className="mt-1.5 space-y-1">
                    {p.net.players.map((pl) => (
                      <div key={pl.id} className="flex items-center gap-2 text-[11px]">
                        <span className="h-2 w-2 rounded-full" style={{ background: pl.color, boxShadow: `0 0 5px ${pl.color}` }} />
                        <span className="text-[#dbe4f3]/85">{pl.name}</span>
                        {pl.id === p.net.youId && <span className="text-[9px] text-[#22d3ee]/70">（你）</span>}
                        {pl.id === p.net.hostName && <span className="text-[9px] text-[#fbbf24]/80">（房主）</span>}
                      </div>
                    ))}
                  </div>
                  {p.net.isHost ? (
                    <>
                      <p className="mt-1.5 text-[10px] text-[#fbbf24]/85">你是房主：暂停/回退/清空/切预设由你直接执行。</p>
                      <button
                        onClick={p.onCloseRoom}
                        className="mt-1.5 w-full rounded border border-[#f87171]/30 px-2 py-1.5 text-[11px] text-[#f87171]/85 hover:border-[#f87171]/60"
                      >
                        ✕ 关闭房间
                      </button>
                    </>
                  ) : p.net.hostName ? (
                    <p className="mt-1.5 text-[10px] leading-relaxed text-[#5b6b8c]">房主：{p.net.hostName}。全局操作由房主执行。</p>
                  ) : (
                    <p className="mt-1.5 text-[10px] leading-relaxed text-[#5b6b8c]">公共大厅：全局操作由全员投票决定。</p>
                  )}
                </>
              )}
              {p.net.online && (
                <button
                  onClick={p.onBackToSingle}
                  className="mt-2 w-full rounded border border-[#22d3ee]/40 bg-[#22d3ee]/10 px-2 py-1.5 text-[11px] text-[#dbe4f3] hover:bg-[#22d3ee]/20"
                >
                  ⏏ 保存并回到单机
                </button>
              )}
              {!p.net.online && (
                <p className="mt-1.5 text-[10px] leading-relaxed text-[#5b6b8c]/70">
                  当前已是单机模式。要联机：点上方「公共大厅 / 房间」进入，或「＋新建房间」开放自己的宇宙。
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
