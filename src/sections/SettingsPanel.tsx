import type { Prefs } from '../sim/prefs'

interface Props {
  open: boolean
  prefs: Prefs
  onChange: (patch: Partial<Prefs>) => void
  onClose: () => void
  /** 远程连接状态（仅 remote 模式显示） */
  remoteStatus?: string
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div>
        <div className="text-[12px] text-[#dbe4f3]/90">{label}</div>
        {hint && <div className="mt-0.5 text-[10px] leading-relaxed text-[#5b6b8c]/50">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
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

/** 设置抽屉：操作与预演偏好，localStorage 持久化 */
export default function SettingsPanel(p: Props) {
  if (!p.open) return null
  return (
    <div className="pointer-events-auto absolute inset-0 z-30" onClick={p.onClose}>
      <div
        className="glass mg-fadeup absolute bottom-0 left-0 right-0 rounded-t-2xl p-5 pb-8 sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[380px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between">
          <div>
            <div className="text-sm font-medium tracking-wide text-[#dbe4f3]">设置</div>
            <div className="text-[9px] tracking-[0.25em] text-[#5b6b8c]/60">PREFERENCES</div>
          </div>
          <button onClick={p.onClose} className="rounded-md border border-[#5b6b8c]/25 px-2 py-1 text-[11px] text-[#5b6b8c]/80 hover:bg-[#5b6b8c]/10">
            完成
          </button>
        </div>
        <div className="divide-y divide-[#5b6b8c]/10">
          <Row label="运行位置" hint="本地：物理在你的浏览器里跑；远程：物理在服务器上跑，浏览器只显示画面">
            <Seg
              value={p.prefs.runMode}
              options={[
                { v: 'local', label: '本地' },
                { v: 'remote', label: '远程' },
              ]}
              onPick={(v) => p.onChange({ runMode: v })}
            />
          </Row>
          {p.prefs.runMode === 'remote' && (
            <Row
              label="服务器地址"
              hint={`例：192.168.1.10:8321 · 留空 = 本页面所在服务器 · 状态：${
                { disconnected: '未连接', connecting: '连接中…', connected: '已连接', error: '连接失败' }[p.remoteStatus ?? 'disconnected'] ??
                p.remoteStatus
              }`}
            >
              <input
                className="w-40 rounded border border-[#1a2540] bg-[#0c1220] px-2 py-1 font-mono text-[11px] text-[#dbe4f3] outline-none focus:border-[#22d3ee]/50"
                placeholder="host:8321"
                defaultValue={p.prefs.serverAddr}
                onBlur={(e) => p.onChange({ serverAddr: e.target.value.trim() })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                }}
              />
            </Row>
          )}
          <Row label="摇杆模式" hint="固定：摇杆常驻角落；随手：手指落在哪摇杆就在哪">
            <Seg
              value={p.prefs.joyMode}
              options={[
                { v: 'fixed', label: '固定' },
                { v: 'float', label: '随手' },
              ]}
              onPick={(v) => p.onChange({ joyMode: v })}
            />
          </Row>
          <Row label="摇杆位置" hint="固定模式的停靠侧；随手模式的触发热区">
            <Seg
              value={p.prefs.joySide}
              options={[
                { v: 'left', label: '左侧' },
                { v: 'right', label: '右侧' },
              ]}
              onPick={(v) => p.onChange({ joySide: v })}
            />
          </Row>
          <Row label="未来预演时长" hint="影子模拟领先画面的秒数，决定飞船虚线画多远">
            <Seg
              value={p.prefs.leadSeconds}
              options={[
                { v: 3, label: '3s' },
                { v: 6, label: '6s' },
                { v: 10, label: '10s' },
                { v: 20, label: '20s' },
              ]}
              onPick={(v) => p.onChange({ leadSeconds: v })}
            />
          </Row>
        </div>
        <div className="mt-3 text-[10px] leading-relaxed text-[#5b6b8c]/40">
          偏好保存在本机浏览器，下次打开自动恢复。
        </div>
      </div>
    </div>
  )
}
