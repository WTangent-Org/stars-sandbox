import type { UnitProfile } from '../sim/types'

/** 飞船遥测读数：油门/速度/相对当前宿主的逃逸比与高度（宿主为黑洞时附时间膨胀） */
export interface ShipTelInfo {
  throttle: number
  speed: number
  escRatio: number
  altitude: number
  host: string
  dilation?: number
}

export interface ShipTelemetryProps {
  tel: ShipTelInfo
  units?: UnitProfile
  isTouch: boolean
}

/** 飞船控制台：只管遥测与操控提示（轨道根数在选中面板里看） */
export default function ShipTelemetry({ tel, units, isTouch }: ShipTelemetryProps) {
  return (
    <div className="glass mg-fadeup pointer-events-none w-[180px] rounded-lg p-3 font-mono">
      <div className="flex items-center justify-between">
        <span className="text-[9px] tracking-[0.25em] text-[#34d399]/90">飞船遥测</span>
        <span className="h-1.5 w-1.5 rounded-full bg-[#34d399]" style={{ animation: 'mg-pulse 1.4s ease-in-out infinite' }} />
      </div>
      <div className="mt-2 space-y-1 text-[10.5px] text-[#dbe4f3]/90">
        <div className="flex justify-between"><span className="text-[#5b6b8c]">速度</span><span>{units ? `${((tel.speed * units.velMs) / 1000).toFixed(2)} km/s` : `${tel.speed.toFixed(2)} u/s`}</span></div>
        <div className="flex justify-between"><span className="text-[#5b6b8c]">高度</span><span>{units ? `${((tel.altitude * units.distM) / 1.496e11).toFixed(3)} AU` : tel.altitude.toFixed(1)}</span></div>
        <div className="flex justify-between">
          <span className="text-[#5b6b8c]">速度/逃逸</span>
          <span className={tel.escRatio >= 1 ? 'text-[#fbbf24]' : ''}>{tel.escRatio.toFixed(2)}×{tel.escRatio >= 1 ? ' 逃逸!' : ''}</span>
        </div>
        {tel.dilation != null && (
          <div className="flex justify-between">
            <span className="text-[#5b6b8c]">时间膨胀</span>
            <span className={tel.dilation < 0.85 ? 'text-[#fbbf24]' : ''}>dτ/dt = {tel.dilation.toFixed(3)}</span>
          </div>
        )}
      </div>
      {/* 油门条 */}
      <div className="mt-2.5">
        <div className="flex justify-between text-[9px] text-[#5b6b8c]"><span>油门</span><span>{Math.round(tel.throttle * 100)}%</span></div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-sm bg-[#1a2540]">
          <div
            className="h-full rounded-sm transition-all duration-100"
            style={{ width: `${tel.throttle * 100}%`, background: tel.throttle > 0.8 ? '#fbbf24' : '#34d399', boxShadow: '0 0 8px rgba(52,211,153,0.5)' }}
          />
        </div>
      </div>
      <div className="mt-2 border-t border-[#1a2540] pt-1.5 text-[9px] leading-relaxed text-[#5b6b8c]">
        {isTouch ? '摇杆 = 推力方向与油门（满推 50%）' : 'W/S 顺行/逆行 · A/D 侧移 · Shift 全推力'}
      </div>
    </div>
  )
}
