import type { SimStats, UnitProfile } from '../sim/types'
import { fmtTime, fmtRealTime } from '../sim/format'

/** 精简 HUD：只留 天体 / T+ / FPS 三个读数（其余细节都在 ☰ 菜单或不需要展示） */
export default function StatsBar(props: { stats: SimStats; running: boolean; units?: UnitProfile }) {
  const s = props.stats
  const t = props.units ? fmtRealTime(s.simTime * props.units.timeDays) : fmtTime(s.simTime)
  const items: Array<[string, string]> = [
    ['天体', String(s.bodies)],
    ['T+', t],
    ['FPS', String(s.fps)],
  ]
  return (
    <div className="glass mg-fadeup pointer-events-none inline-flex select-none items-center divide-x divide-[#5b6b8c]/10 rounded-lg px-1 py-1">
      <div
        className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[9px] tracking-[0.2em] ${
          props.running ? 'text-[#34d399]' : 'text-[#fbbf24]'
        }`}
        title={props.running ? '运行中' : '已暂停'}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${props.running ? 'bg-[#34d399]' : 'bg-[#fbbf24]'}`} style={{ animation: 'mg-pulse 1.4s ease-in-out infinite' }} />
        {props.running ? 'RUN' : 'PAUSE'}
      </div>
      {items.map(([k, v]) => (
        <div key={k} className="flex items-baseline gap-1.5 px-3">
          <span className="font-mono text-[12px] font-medium text-[#dbe4f3]">{v}</span>
          <span className="text-[9px] tracking-[0.15em] text-[#5b6b8c]/70">{k}</span>
        </div>
      ))}
    </div>
  )
}
