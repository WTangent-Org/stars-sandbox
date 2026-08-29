import type { SimStats, UnitProfile } from '../sim/types'

function fmtTime(t: number): string {
  if (t < 1000) return t.toFixed(1)
  if (t < 100000) return t.toFixed(0)
  return t.toExponential(2)
}

function fmtMass(m: number): string {
  if (m < 1000) return m.toPrecision(3)
  if (m < 1000000) return (m / 1000).toPrecision(3) + 'k'
  return (m / 1000000).toPrecision(3) + 'M'
}

function fmtRealTime(days: number): string {
  if (days < 730) return days.toFixed(0) + ' 天'
  return (days / 365.25).toFixed(2) + ' 年'
}

function fmtRealMass(kg: number): string {
  if (!(kg > 0)) return '0kg'
  const e = Math.floor(Math.log10(kg))
  const m = kg / Math.pow(10, e)
  return `${m.toFixed(2)}e${e}kg`
}

function fmtZoom(z: number): string {
  if (z >= 100) return z.toFixed(0) + '×'
  if (z >= 1) return z.toFixed(2) + '×'
  return z.toFixed(3) + '×'
}

export default function StatsBar(props: { stats: SimStats; zoom: number; running: boolean; units?: UnitProfile }) {
  const s = props.stats
  const u = props.units
  const items: Array<[string, string]> = [
    ['天体', String(s.bodies)],
    ['恒星', String(s.stars)],
    ['合并', String(s.merges)],
    ['总质量', u ? fmtRealMass(s.totalMass * u.massKg) : fmtMass(s.totalMass)],
    [u ? 'T+（真实时间）' : 'T+', u ? fmtRealTime(s.simTime * u.timeDays) : fmtTime(s.simTime)],
    ['缩放', fmtZoom(props.zoom)],
    ['FPS', String(s.fps)],
  ]
  return (
    <div className="pointer-events-none select-none">
      {/* 标题区 */}
      <div className="mg-fadeup flex items-center gap-3">
        <div className="relative flex h-9 w-9 items-center justify-center">
          <div className="absolute inset-0 rounded-full border border-[#22d3ee]/35" style={{ animation: 'spin 12s linear infinite' }}>
            <div className="absolute -top-[2.5px] left-1/2 h-[5px] w-[5px] -translate-x-1/2 rounded-full bg-[#22d3ee] shadow-[0_0_6px_rgba(34,211,238,0.9)]" />
          </div>
          <div className="mg-dot" />
        </div>
        <div>
          <h1 className="text-[15px] font-semibold tracking-[0.22em] text-[#dbe4f3]">星球物理模拟器</h1>
          <p className="font-mono text-[9.5px] tracking-[0.28em] text-[#5b6b8c]/80">N-BODY GRAVITY ENGINE</p>
        </div>
        <div
          className={`ml-2 flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[9px] tracking-[0.2em] ${
            props.running ? 'border-[#34d399]/40 text-[#34d399]' : 'border-[#fbbf24]/40 text-[#fbbf24]'
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${props.running ? 'bg-[#34d399]' : 'bg-[#fbbf24]'}`} style={{ animation: 'mg-pulse 1.4s ease-in-out infinite' }} />
          {props.running ? 'RUNNING' : 'PAUSED'}
        </div>
      </div>
      {/* 数据读数 */}
      <div className="glass mg-fadeup mt-3 inline-flex divide-x divide-[#5b6b8c]/10 rounded-lg px-1 py-1.5">
        {items.map(([k, v]) => (
          <div key={k} className="px-3 text-center first:pl-2 last:pr-2">
            <div className="font-mono text-[12px] font-medium text-[#dbe4f3]">{v}</div>
            <div className="mt-0.5 text-[9px] tracking-[0.15em] text-[#5b6b8c]/70">{k}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
