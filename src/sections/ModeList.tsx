import type { RoomListMsg } from '../shared/protocol'
import type { SaveMeta } from '../sim/saveStore'

/**
 * 模式列表：公共大厅（固定首行）+ 活跃房间 + 本地存档，一个列表决定你进哪个宇宙。
 * Dock 的「世界」页与主菜单「多人游戏」共用。
 */
export default function ModeList(props: {
  rooms: RoomListMsg['rooms']
  saves: SaveMeta[]
  currentRoom?: string
  /** 本地存档行：进入 = 强制离线恢复该存档 */
  onLoadSave: (id: string) => void
  onDeleteSave?: (id: string) => void
  onJoinRoom: (id: string) => void
  /** 行内小按钮用：阻止冒泡后执行 */
  onExportSave?: (id: string) => void
}) {
  const row = 'flex w-full items-center gap-2 rounded border px-2 py-1.5 text-left text-[11.5px] transition-all'
  const tag = 'shrink-0 rounded px-1 py-0.5 font-mono text-[8.5px] tracking-wider'
  return (
    <div className="space-y-1">
      {/* 公共大厅：固定第一行 */}
      <button
        onClick={() => props.onJoinRoom('')}
        className={`${row} ${props.currentRoom === 'lobby' ? 'border-[#22d3ee]/60 bg-[#22d3ee]/10 text-[#dbe4f3]' : 'border-[#1a2540] text-[#dbe4f3]/80 hover:border-[#22d3ee]/35'}`}
      >
        <span className={`${tag} bg-[#34d399]/15 text-[#34d399]`}>大厅</span>
        <span className="flex-1 truncate">公共大厅</span>
      </button>
      {/* 活跃房间 */}
      {props.rooms.map((r) => (
        <button
          key={r.id}
          onClick={() => props.onJoinRoom(r.id)}
          className={`${row} ${props.currentRoom === r.id ? 'border-[#22d3ee]/60 bg-[#22d3ee]/10 text-[#dbe4f3]' : 'border-[#1a2540] text-[#dbe4f3]/80 hover:border-[#22d3ee]/35'}`}
        >
          <span className={`${tag} ${r.host ? 'bg-[#fbbf24]/15 text-[#fbbf24]' : 'bg-[#22d3ee]/10 text-[#22d3ee]'}`}>房间</span>
          <span className="flex-1 truncate">{r.id}</span>
          <span className="shrink-0 font-mono text-[9px] text-[#5b6b8c]">{r.players}人{r.host ? ' · 房主' : ''}</span>
        </button>
      ))}
      {/* 本地存档 */}
      {props.saves.map((s) => (
        <div
          key={s.id}
          className={`${row} cursor-pointer border-[#1a2540] text-[#dbe4f3]/80 hover:border-[#22d3ee]/35`}
          onClick={() => props.onLoadSave(s.id)}
          role="button"
        >
          <span className={`${tag} bg-[#5b6b8c]/20 text-[#5b6b8c]`}>本地</span>
          <span className="flex-1 truncate">{s.name}</span>
          <span className="shrink-0 font-mono text-[9px] text-[#5b6b8c]/60">
            {new Date(s.savedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
          </span>
          {(props.onDeleteSave || props.onExportSave) && (
            <span className="flex shrink-0 gap-1">
              {props.onExportSave && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    props.onExportSave!(s.id)
                  }}
                  className="rounded border border-[#1a2540] px-1 text-[9px] text-[#5b6b8c] hover:text-[#dbe4f3]"
                  title="导出"
                >
                  ⬇
                </button>
              )}
              {props.onDeleteSave && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    props.onDeleteSave!(s.id)
                  }}
                  className="rounded border border-[#f87171]/25 px-1 text-[9px] text-[#f87171]/70 hover:border-[#f87171]/50"
                  title="删除"
                >
                  ✕
                </button>
              )}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}
