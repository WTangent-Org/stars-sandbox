import { PRESETS } from '../sim/presets'
import type { AutosaveMeta, SaveMeta } from '../sim/saveStore'

function fmt(t: number): string {
  return new Date(t).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

interface Props {
  autosave: AutosaveMeta | null
  onLoadAutosave: () => void
  saves: SaveMeta[]
  /** 载入按钮文案（主菜单「进入」/ Dock「载入」） */
  loadLabel: string
  onLoadSave: (id: string) => void
  onDeleteSave: (id: string) => void
  onExportSave: (id: string) => void
}

const rowBtn = 'flex-1 rounded border px-1 py-0.5 text-[10px]'

/** 存档列表（主菜单与 Dock 世界页共用）：自动存档绿色首行 + 手动存档 */
export default function SaveList(p: Props) {
  return (
    <>
      {p.autosave && (
        <div className="rounded border border-[#34d399]/30 px-2 py-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-[11.5px] text-[#34d399]">
              自动存档 · {p.autosave.bodies} 天体
              {p.autosave.preset ? ` · ${PRESETS.find((pr) => pr.id === p.autosave?.preset)?.label ?? p.autosave.preset}` : ''}
            </span>
            <span className="shrink-0 font-mono text-[9px] text-[#5b6b8c]/60">{fmt(p.autosave.savedAt)}</span>
          </div>
          <button
            onClick={p.onLoadAutosave}
            className={`mt-1 w-full rounded border border-[#34d399]/40 px-1 py-0.5 text-[10px] text-[#34d399] hover:bg-[#34d399]/10`}
          >
            {p.loadLabel}
          </button>
        </div>
      )}
      {p.saves.map((s) => (
        <div key={s.id} className="rounded border border-[#1a2540] px-2 py-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-[11.5px] text-[#dbe4f3]/90">{s.name}</span>
            <span className="shrink-0 font-mono text-[9px] text-[#5b6b8c]/60">{fmt(s.savedAt)}</span>
          </div>
          <div className="mt-0.5 font-mono text-[9px] text-[#5b6b8c]/50">
            {s.bodies} 天体{s.preset ? ` · ${PRESETS.find((pr) => pr.id === s.preset)?.label ?? s.preset}` : ''}
          </div>
          <div className="mt-1 flex gap-1">
            <button onClick={() => p.onLoadSave(s.id)} className={`${rowBtn} border-[#22d3ee]/40 text-[#22d3ee] hover:bg-[#22d3ee]/10`}>
              {p.loadLabel}
            </button>
            <button onClick={() => p.onExportSave(s.id)} className={`${rowBtn} border-[#1a2540] text-[#dbe4f3]/70 hover:border-[#22d3ee]/35`}>
              导出
            </button>
            <button onClick={() => p.onDeleteSave(s.id)} className={`${rowBtn} border-[#f87171]/25 text-[#f87171]/80 hover:border-[#f87171]/50`}>
              删除
            </button>
          </div>
        </div>
      ))}
    </>
  )
}
