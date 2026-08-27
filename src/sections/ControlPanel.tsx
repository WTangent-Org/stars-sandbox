import { useState } from 'react'
import type { BodyKind, PresetId, SimConfig, SpawnSettings, ToolMode } from '../sim/types'
import { PRESETS } from '../sim/presets'

const KIND_META: Record<Exclude<BodyKind, 'ship'>, { label: string; min: number; max: number; hint: string }> = {
  star: { label: '恒星', min: 100, max: 60000, hint: '发光发热 · 质量决定颜色与归宿' },
  planet: { label: '行星', min: 0.05, max: 24000, hint: '绕着恒星旋转的世界 · 超24000 点燃成恒星' },
  moon: { label: '卫星', min: 0.0001, max: 0.5, hint: '环绕行星的小世界' },
  asteroid: { label: '小行星', min: 0.0001, max: 0.1, hint: '轻如尘埃的碎块' },
  blackhole: { label: '黑洞', min: 4000, max: 2e6, hint: '吞噬一切的深渊' },
}

function fmtMass(m: number): string {
  if (m >= 10000) return (m / 1000).toFixed(1) + 'k'
  if (m >= 100) return m.toFixed(0)
  if (m >= 1) return m.toFixed(2)
  if (m >= 0.001) return m.toFixed(4)
  return m.toExponential(1)
}

function SliderRow(props: {
  label: string
  value: number
  display: string
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
}) {
  const fill = ((props.value - props.min) / (props.max - props.min)) * 100
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <span className="mg-label">{props.label}</span>
        <span className="font-mono text-[11px] text-[#dbe4f3]">{props.display}</span>
      </div>
      <input
        type="range"
        className="mg-slider"
        style={{ ['--fill' as string]: `${fill}%` }}
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        value={props.value}
        onChange={(e) => props.onChange(parseFloat(e.target.value))}
      />
    </div>
  )
}

function ToggleRow(props: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-[12px] text-[#dbe4f3]/85">{props.label}</span>
      <button
        className="mg-toggle"
        data-on={props.on}
        onClick={() => props.onChange(!props.on)}
        aria-label={props.label}
      />
    </div>
  )
}

function Section(props: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(props.defaultOpen ?? true)
  return (
    <div className="border-b border-[#1a2540] last:border-0">
      <button
        className="flex w-full items-center justify-between px-4 py-2.5 text-left transition-colors hover:bg-[#22d3ee]/5"
        onClick={() => setOpen(!open)}
      >
        <span className="mg-label">{props.title}</span>
        <span className="font-mono text-[13px] leading-none text-[#22d3ee]">{open ? '−' : '+'}</span>
      </button>
      <div
        className="overflow-hidden transition-[max-height,opacity] duration-300"
        style={{ maxHeight: open ? 600 : 0, opacity: open ? 1 : 0 }}
      >
        <div className="space-y-3 px-4 pb-4 pt-1">{props.children}</div>
      </div>
    </div>
  )
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
  onResetView: () => void
  /** 是否已有飞船在飞 */
  hasShip: boolean
  /** 进入飞船部署模式（点击画布放置，自动替换旧飞船） */
  onDeployShip: () => void
}

export default function ControlPanel(p: Props) {
  const kind = p.spawn.kind === 'ship' ? null : KIND_META[p.spawn.kind as Exclude<BodyKind, 'ship'>]
  // 质量滑杆使用对数刻度 0–100
  const massToSlider = (m: number) => {
    const k = kind ?? KIND_META.planet
    return ((Math.log10(Math.max(m, k.min)) - Math.log10(k.min)) / (Math.log10(k.max) - Math.log10(k.min))) * 100
  }
  const sliderToMass = (s: number) => {
    const k = kind ?? KIND_META.planet
    const v = Math.pow(10, Math.log10(k.min) + (s / 100) * (Math.log10(k.max) - Math.log10(k.min)))
    return parseFloat(v.toPrecision(3))
  }

  return (
    <div className="glass mg-fadeup pointer-events-auto w-[min(290px,88vw)] overflow-hidden rounded-lg">
      <div className="mg-scroll max-h-[calc(100vh-140px)] overflow-y-auto">
        {/* 场景 */}
        <Section title="场景 SCENE">
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
        </Section>

        {/* 模拟 */}
        <Section title="模拟 SIMULATION">
          <div className="flex gap-1.5">
            <button
              onClick={() => p.onConfig({ paused: !p.config.paused })}
              className="flex-1 rounded border border-[#22d3ee]/40 bg-[#22d3ee]/10 px-2 py-1.5 font-mono text-[12px] text-[#dbe4f3] transition-all hover:bg-[#22d3ee]/20"
            >
              {p.config.paused ? '▶ 继续' : '❚❚ 暂停'}
            </button>
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
          <ToggleRow label="轨道轨迹" on={p.config.trails} onChange={(v) => p.onConfig({ trails: v })} />
          <ToggleRow
            label="永久轨迹（不裁剪）"
            on={p.config.trailsForever}
            onChange={(v) => p.onConfig({ trailsForever: v })}
          />
          {/* 性能档位 */}
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between">
              <span className="mg-label">性能档位</span>
              <span className="font-mono text-[11px] text-[#22d3ee]">
                {p.config.perfTier === 'auto' ? '自动' : { ultra: '极致', high: '高', balanced: '均衡', low: '低', saver: '省电' }[p.config.perfTier]}
              </span>
            </div>
            <div className="grid grid-cols-5 gap-1">
              {(['auto', 'ultra', 'high', 'balanced', 'low', 'saver'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => p.onConfig({ perfTier: t })}
                  className={`rounded border px-1 py-1 font-mono text-[9px] transition-all ${
                    p.config.perfTier === t
                      ? 'border-[#22d3ee]/60 bg-[#22d3ee]/15 text-[#22d3ee]'
                      : 'border-[#1a2540] text-[#dbe4f3]/55 hover:border-[#22d3ee]/35'
                  }`}
                >
                  {t === 'auto' ? '自动' : t === 'ultra' ? '极致' : t === 'high' ? '高' : t === 'balanced' ? '均衡' : t === 'low' ? '低' : '省电'}
                </button>
              ))}
            </div>
            <p className="text-[10px] leading-relaxed text-[#5b6b8c]">
              极致：服务器/工作站级 · 高：游戏本 · 均衡：普通笔记本 · 低：轻薄本 · 省电：手机/老旧设备
            </p>
          </div>
        </Section>

        {/* 创建天体 */}
        <Section title="创建天体 CREATE">
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
          <div className="grid grid-cols-3 gap-1">
            {(Object.keys(KIND_META) as Array<Exclude<BodyKind, 'ship'>>).map((k) => (
              <button
                key={k}
                onClick={() => p.onSpawn({ kind: k, mass: sliderToMass(50) })}
                className={`rounded border px-1 py-1 text-[11px] transition-all ${
                  p.spawn.kind === k
                    ? 'border-[#22d3ee]/60 bg-[#22d3ee]/15 text-[#dbe4f3]'
                    : 'border-[#1a2540] text-[#dbe4f3]/55 hover:border-[#22d3ee]/35'
                }`}
              >
                {KIND_META[k].label}
              </button>
            ))}
          </div>
          {kind && (
            <>
              <SliderRow
                label="质量"
                value={massToSlider(p.spawn.mass)}
                display={`${fmtMass(p.spawn.mass)} M*`}
                min={0}
                max={100}
                step={0.5}
                onChange={(v) => p.onSpawn({ mass: sliderToMass(v) })}
              />
              <ToggleRow
                label="自动圆轨道（绕最近主星）"
                on={p.spawn.autoOrbit}
                onChange={(v) => p.onSpawn({ autoOrbit: v })}
              />
              <p className="text-[10.5px] leading-relaxed text-[#5b6b8c]">
                {p.mode === 'spawn'
                  ? p.spawn.autoOrbit
                    ? '在画布上点击放置，自动获得环绕最近大质量天体的圆轨道速度。'
                    : '在画布上按住并拖拽：落点即天体位置，拖拽方向与长度决定初速度。'
                  : '切换到「创建天体」后，在画布上点击或拖拽即可放置新天体。'}
              </p>
            </>
          )}
        </Section>

        {/* 飞船：唯一飞行器，单独部署入口 */}
        <Section title="飞船 SHIP">
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
            {p.hasShip
              ? '全场只允许一艘飞船。点击按钮后在画布上点选新位置，旧飞船将退役。'
              : '点击按钮进入部署模式，在画布上点击放置飞船（自动进入环绕轨道）。'}
          </p>
        </Section>
      </div>
    </div>
  )
}
