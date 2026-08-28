import type { Body, UnitProfile } from '../sim/types'
import type { NetSim } from '../sim/net'

const KIND_LABEL: Record<Body['kind'], string> = { star: '恒星', planet: '行星', moon: '卫星', asteroid: '小行星', blackhole: '黑洞', ship: '飞船' }

/** 选中天体的轨道根数（相对引力主导者的二体解；宿主为黑洞时附视界/时间膨胀） */
export interface SelOrbitInfo {
  host: string
  rp: number
  ra: number
  T: number
  ecc: number
  esc: number
  vr: number
  rNow: number
  dilation?: number
  rsRatio?: number
}

export interface SelectedCardProps {
  selected: Body
  orbit: SelOrbitInfo | null
  units?: UnitProfile
  follow: boolean
  onToggleFollow: () => void
  onDelete: () => void
  net: NetSim | null
}

export default function SelectedCard({ selected, orbit, units, follow, onToggleFollow, onDelete, net }: SelectedCardProps) {
  // 真实比例场景下，用真实单位显示选中天体信息
  const selMass = units
    ? (() => {
        const kg = selected.mass * units.massKg
        const exp = Math.floor(Math.log10(Math.max(kg, 1e-30)))
        return `${(kg / 10 ** exp).toFixed(2)}×10^${exp} kg`
      })()
    : null
  const selVel = units ? `${((Math.hypot(selected.vx, selected.vy) * units.velMs) / 1000).toFixed(2)} km/s` : null
  const selRad = units ? `${((selected.radius * units.distM) / 1000).toFixed(0)} km` : null
  const selDist = units
    ? (() => {
        const au = (Math.hypot(selected.x, selected.y) * units.distM) / 1.496e11
        if (au >= 3000) return `${(au / 63241).toFixed(2)} 光年`
        if (au >= 10) return `${au.toFixed(1)} AU`
        return `${au.toFixed(3)} AU`
      })()
    : null

  return (
    <div className="glass mg-fadeup pointer-events-auto w-[min(250px,72vw)] rounded-lg p-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[13px] font-medium text-[#dbe4f3]">{selected.name}</div>
          <div className="mt-0.5 font-mono text-[9px] tracking-[0.25em] text-[#5b6b8c]">
            {KIND_LABEL[selected.kind].toUpperCase()} · ID {selected.id}
          </div>
        </div>
        <div className="h-3 w-3 rounded-full" style={{ background: selected.color, boxShadow: `0 0 10px ${selected.glow}` }} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 font-mono text-[11px]">
        <div>
          <div className="text-[9px] tracking-[0.15em] text-[#5b6b8c]">质量{units ? '' : ' M*'}</div>
          <div className="text-[#dbe4f3]">{selMass ?? selected.mass.toPrecision(4)}</div>
        </div>
        <div>
          <div className="text-[9px] tracking-[0.15em] text-[#5b6b8c]">速度</div>
          <div className="text-[#dbe4f3]">{selVel ?? `${Math.hypot(selected.vx, selected.vy).toFixed(2)} u/s`}</div>
        </div>
        <div>
          <div className="text-[9px] tracking-[0.15em] text-[#5b6b8c]">半径</div>
          <div className="text-[#dbe4f3]">{selRad ?? `${selected.radius.toFixed(1)} u`}</div>
        </div>
        <div>
          <div className="text-[9px] tracking-[0.15em] text-[#5b6b8c]">距原点</div>
          <div className="text-[#dbe4f3]">{selDist ?? `${Math.hypot(selected.x, selected.y).toFixed(0)} u`}</div>
        </div>
      </div>
      {/* 轨道根数：相对引力主导者的二体解 */}
      {orbit && (
        <div className="mt-3 space-y-1 border-t border-[#1a2540] pt-2 font-mono text-[10.5px]">
          <div className="text-[9px] tracking-[0.2em] text-[#5b6b8c]">轨道 · 绕{orbit.host}</div>
          {orbit.rp > 0 ? (
            <>
              <div className="flex justify-between"><span className="text-[#5b6b8c]">近拱点</span><span className="text-[#dbe4f3]">{units ? (orbit.rp * units.distM / 1.496e11).toFixed(3) + ' AU' : orbit.rp.toFixed(1)}</span></div>
              <div className="flex justify-between"><span className="text-[#5b6b8c]">远拱点</span><span className="text-[#dbe4f3]">{units ? (orbit.ra * units.distM / 1.496e11).toFixed(3) + ' AU' : orbit.ra.toFixed(1)}</span></div>
              <div className="flex justify-between"><span className="text-[#5b6b8c]">偏心率</span><span className="text-[#dbe4f3]">{orbit.ecc.toFixed(3)}</span></div>
              <div className="flex justify-between"><span className="text-[#5b6b8c]">周期</span><span className="text-[#dbe4f3]">{units ? (orbit.T * units.timeDays / 365.25).toFixed(2) + ' 年' : orbit.T.toFixed(0)}</span></div>
            </>
          ) : (
            <div className="flex justify-between"><span className="text-[#fbbf24]/80">轨道</span><span className="text-[#fbbf24]">双曲线 · 逃逸中</span></div>
          )}
          <div className="flex justify-between"><span className="text-[#5b6b8c]">速度/逃逸</span><span className="text-[#dbe4f3]">{(orbit.vr / orbit.esc).toFixed(2)}×</span></div>
          {orbit.rsRatio != null && (
            <>
              <div className="flex justify-between">
                <span className="text-[#5b6b8c]">距视界</span>
                <span className={orbit.rsRatio < 6 ? 'text-[#f87171]' : 'text-[#dbe4f3]'}>{orbit.rsRatio.toFixed(1)} r_s{orbit.rsRatio < 6 ? ' · ISCO内!' : ''}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#5b6b8c]">时间膨胀</span>
                <span className={(orbit.dilation ?? 1) < 0.85 ? 'text-[#fbbf24]' : 'text-[#dbe4f3]'}>dτ/dt = {(orbit.dilation ?? 1).toFixed(3)}</span>
              </div>
            </>
          )}
        </div>
      )}
      {/* 联机权限：拥有者与授权管理 */}
      {net && net.you && (() => {
        const ownerId = net.owners.get(selected.id) ?? (net.bodyPerms?.bodyId === selected.id ? net.bodyPerms.owner : null)
        const owner = net.players.find((pl) => pl.id === ownerId)
        const myPerm = ownerId === net.you!.id ? 'owner' : (net.bodyPerms?.bodyId === selected.id ? net.bodyPerms.grants[net.you!.id] : undefined) ?? 'read'
        const canManage = myPerm === 'owner' || myPerm === 'admin'
        return (
          <div className="mt-3 border-t border-[#1a2540] pt-2">
            <div className="flex items-center justify-between font-mono text-[10px]">
              <span className="tracking-[0.15em] text-[#5b6b8c]">归属</span>
              <span style={{ color: owner?.color ?? '#5b6b8c' }}>{owner ? owner.name : '无主'}</span>
            </div>
            {canManage && (
              <div className="mt-2 space-y-1">
                <div className="text-[9px] tracking-[0.15em] text-[#5b6b8c]">授权其他玩家</div>
                {net.players
                  .filter((pl) => pl.id !== net.you!.id)
                  .map((pl) => {
                    const cur = (net.bodyPerms?.bodyId === selected.id ? net.bodyPerms.grants[pl.id] : undefined) ?? 'read'
                    return (
                      <div key={pl.id} className="flex items-center gap-1.5">
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: pl.color }} />
                        <span className="flex-1 truncate text-[10px] text-[#dbe4f3]/80">{pl.name}</span>
                        {(['read', 'move', 'admin'] as const).map((perm) => (
                          <button
                            key={perm}
                            onClick={() => net.setPerm(selected.id, pl.id, cur === perm ? 'revoke' : perm)}
                            className={`rounded border px-1.5 py-0.5 text-[9px] transition-all ${
                              cur === perm
                                ? 'border-[#22d3ee]/50 bg-[#22d3ee]/15 text-[#22d3ee]'
                                : 'border-[#1a2540] text-[#5b6b8c]/60 hover:text-[#dbe4f3]'
                            }`}
                          >
                            {{ read: '看', move: '动', admin: '管' }[perm]}
                          </button>
                        ))}
                      </div>
                    )
                  })}
              </div>
            )}
            {!canManage && (
              <div className="mt-1 font-mono text-[9px] text-[#5b6b8c]/60">
                你的权限：{{ read: '只读', move: '可移动', admin: '可管理' }[myPerm as 'read' | 'move' | 'admin'] ?? myPerm}
              </div>
            )}
          </div>
        )
      })()}
      <div className="mt-3 flex gap-1.5">
        <button
          onClick={onToggleFollow}
          className={`flex-1 rounded border px-2 py-1 text-[11px] transition-all ${
            follow
              ? 'border-[#22d3ee]/60 bg-[#22d3ee]/15 text-[#22d3ee]'
              : 'border-[#1a2540] text-[#dbe4f3]/70 hover:border-[#22d3ee]/40'
          }`}
        >
          {follow ? '◉ 追踪中' : '◎ 追踪'}
        </button>
        <button
          onClick={onDelete}
          className="flex-1 rounded border border-[#f87171]/25 px-2 py-1 text-[11px] text-[#f87171]/80 transition-all hover:border-[#f87171]/50"
        >
          删除
        </button>
      </div>
    </div>
  )
}
