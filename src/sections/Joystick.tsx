import type { Prefs } from '../sim/prefs'
import type { Rt } from '../pages/rt'

interface Props {
  rt: Rt
  prefs: Prefs
  /** 渲染用状态镜像（rt.joystickRef 的同步副本） */
  joy: { active: boolean; x: number; y: number }
  setJoy: (v: { active: boolean; x: number; y: number }) => void
  /** 随手模式锚点（null = 固定模式） */
  anchor: { x: number; y: number } | null
}

/** 触屏虚拟摇杆：固定（joySide 左/右）与随手（anchor）两模式共用一套渲染 */
export default function Joystick({ rt, prefs, joy, setJoy, anchor }: Props) {
  const setFromEvent = (e: React.PointerEvent) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const nx = ((e.clientX - rect.left) / rect.width - 0.5) * 2
    const ny = ((e.clientY - rect.top) / rect.height - 0.5) * 2
    const m = Math.min(1, Math.hypot(nx, ny))
    const a = Math.atan2(ny, nx)
    rt.joystickRef.current = { active: true, x: Math.cos(a) * m, y: Math.sin(a) * m }
    setJoy({ ...rt.joystickRef.current })
  }

  return (
    <div
      className="glass pointer-events-auto absolute z-20 h-28 w-28 touch-none rounded-full"
      style={
        prefs.joyMode === 'float' && anchor
          ? { left: anchor.x - 56, top: anchor.y - 56, opacity: 0.85 }
          : prefs.joySide === 'left'
            ? { bottom: 80, left: 16 }
            : { bottom: 80, right: 16 }
      }
      onPointerDown={(e) => {
        if (prefs.joyMode === 'float') return
        ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
        setFromEvent(e)
      }}
      onPointerMove={(e) => {
        if (!rt.joystickRef.current.active || prefs.joyMode === 'float') return
        setFromEvent(e)
      }}
      onPointerUp={() => {
        rt.joystickRef.current = { active: false, x: 0, y: 0 }
        setJoy({ active: false, x: 0, y: 0 })
      }}
      onPointerCancel={() => {
        rt.joystickRef.current = { active: false, x: 0, y: 0 }
        setJoy({ active: false, x: 0, y: 0 })
      }}
    >
      <div className="absolute inset-0 rounded-full border border-[#22d3ee]/25" />
      <div className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#22d3ee]/40" />
      <div
        className="absolute h-9 w-9 rounded-full border border-[#22d3ee]/50 bg-[#22d3ee]/20 shadow-[0_0_14px_rgba(34,211,238,0.35)]"
        style={{ left: `calc(50% + ${joy.x * 36}px)`, top: `calc(50% + ${joy.y * 36}px)`, transform: 'translate(-50%,-50%)' }}
      />
      <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap font-mono text-[9px] tracking-[0.2em] text-[#5b6b8c]">
        推进器摇杆
      </div>
    </div>
  )
}
