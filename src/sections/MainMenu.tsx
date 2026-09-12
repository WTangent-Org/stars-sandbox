import { useState } from 'react'
import { PRESETS } from '../sim/presets'
import type { PresetId } from '../sim/types'
import type { AutosaveMeta, SaveMeta } from '../sim/saveStore'
import SaveList from './SaveList'

interface Props {
  autosave: AutosaveMeta | null
  onLoadAutosave: () => void
  saves: SaveMeta[]
  onNewWorld: (preset: PresetId) => void
  onLoadSave: (id: string) => void
  onDeleteSave: (id: string) => void
  onExportSave: (id: string) => void
  onImportSave: () => void
}

const btn =
  'w-full rounded-md border border-[#5b6b8c]/40 bg-[#0c1220]/80 px-4 py-3 text-left text-[14px] text-[#dbe4f3] transition-all hover:border-[#22d3ee]/60 hover:bg-[#22d3ee]/10'
const smallBtn = 'rounded border border-[#1a2540] px-2 py-1 text-[10px] text-[#dbe4f3]/70 hover:border-[#22d3ee]/35'

/** MC 风格主菜单：存档列表直接展开（自动存档为绿色首行）+ 新的世界 */
export default function MainMenu(p: Props) {
  const [newWorldOpen, setNewWorldOpen] = useState(false)
  const empty = !p.autosave && p.saves.length === 0

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-[#050810]/70 backdrop-blur-[2px]">
      <div className="glass mg-fadeup w-[min(430px,92vw)] rounded-xl p-6">
        <div className="text-center">
          <div className="font-mono text-[10px] tracking-[0.35em] text-[#5b6b8c]">N-BODY GRAVITY SANDBOX</div>
          <h1 className="mt-1 text-[22px] font-bold tracking-wider text-[#dbe4f3]">星球物理模拟器</h1>
        </div>

        <div className="mt-5 space-y-2.5">
          <button onClick={() => setNewWorldOpen(!newWorldOpen)} className={`${btn} border-[#22d3ee]/50`}>
            <span className="text-[#22d3ee]">✦ 新的世界</span>
            <span className="mt-0.5 block text-[10px] text-[#5b6b8c]">从预设开始（真实太阳系 / 空白宇宙 / 星系…）</span>
          </button>
          {newWorldOpen && (
            <div className="grid grid-cols-2 gap-1.5 rounded-md border border-[#1a2540] bg-[#0c1220]/60 p-2">
              {PRESETS.map((pr) => (
                <button
                  key={pr.id}
                  onClick={() => p.onNewWorld(pr.id)}
                  title={pr.desc}
                  className="rounded border border-[#1a2540] px-2 py-1.5 text-left text-[12px] text-[#dbe4f3]/75 transition-all hover:border-[#22d3ee]/50 hover:text-[#dbe4f3]"
                >
                  {pr.label}
                </button>
              ))}
            </div>
          )}

          {/* 存档列表：自动存档（上次离开时的宇宙）+ 手动存档，直接展开 */}
          <div className="rounded-md border border-[#5b6b8c]/40 bg-[#0c1220]/80 px-3 py-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-[#dbe4f3]">📁 存档</span>
              <button onClick={p.onImportSave} className={smallBtn}>
                导入 .json
              </button>
            </div>
            {empty ? (
              <p className="mt-2 text-[10px] leading-relaxed text-[#5b6b8c]/70">
                还没有世界。从「新的世界」开始；游戏内每 30 秒自动保存进度。
              </p>
            ) : (
              <div className="mg-scroll mt-2 max-h-[34vh] space-y-1.5 overflow-y-auto pr-1">
                <SaveList
                  autosave={p.autosave}
                  onLoadAutosave={p.onLoadAutosave}
                  saves={p.saves}
                  loadLabel="进入"
                  onLoadSave={p.onLoadSave}
                  onDeleteSave={p.onDeleteSave}
                  onExportSave={p.onExportSave}
                />
              </div>
            )}
          </div>

          <p className="text-center font-mono text-[9px] leading-relaxed text-[#5b6b8c]/60">
            存档保存在浏览器本地（IndexedDB）· 游戏内每 30 秒自动保存
          </p>
        </div>
      </div>
    </div>
  )
}
