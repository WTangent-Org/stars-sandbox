import { useState } from 'react'
import { PRESETS } from '../sim/presets'
import type { PresetId } from '../sim/types'
import type { SaveMeta } from '../sim/saveStore'

/** 自动存档摘要（主菜单「继续游戏」副标题） */
export interface AutosaveInfo {
  savedAt: number
  bodies: number
  preset?: string
}

interface Props {
  /** 自动存档摘要（=「继续游戏」；null 时进入默认场景） */
  autosave: AutosaveInfo | null
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

function fmt(t: number): string {
  return new Date(t).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

/** MC 风格主菜单：存档列表直接展开——继续游戏（自动存档）+ 手动存档 + 新的世界 */
export default function MainMenu(p: Props) {
  const [newWorldOpen, setNewWorldOpen] = useState(false)

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-[#050810]/70 backdrop-blur-[2px]">
      <div className="glass mg-fadeup w-[min(430px,92vw)] rounded-xl p-6">
        <div className="text-center">
          <div className="font-mono text-[10px] tracking-[0.35em] text-[#5b6b8c]">N-BODY GRAVITY SANDBOX</div>
          <h1 className="mt-1 text-[22px] font-bold tracking-wider text-[#dbe4f3]">星球物理模拟器</h1>
        </div>

        <div className="mt-5 space-y-2.5">
          {/* 继续游戏 = 载入自动存档（就是列表里那个自动存档，不再单列重复） */}
          <button onClick={p.onLoadAutosave} className={`${btn} border-[#22d3ee]/50`}>
            <span className="text-[#22d3ee]">▶ 继续游戏</span>
            <span className="mt-0.5 block text-[10px] text-[#5b6b8c]">
              {p.autosave
                ? `上次的宇宙 · ${p.autosave.bodies} 天体 · ${fmt(p.autosave.savedAt)}`
                : '开始新的旅程（真实太阳系）'}
            </span>
          </button>

          <button onClick={() => setNewWorldOpen(!newWorldOpen)} className={btn}>
            ✦ 新的世界
            <span className="mt-0.5 block text-[10px] text-[#5b6b8c]">从预设开始创造（真实太阳系 / 空白宇宙 / 星系…）</span>
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

          {/* 手动存档列表（直接展开） */}
          <div className="rounded-md border border-[#5b6b8c]/40 bg-[#0c1220]/80 px-3 py-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-[#dbe4f3]">📁 存档</span>
              <button onClick={p.onImportSave} className={smallBtn}>
                导入 .json
              </button>
            </div>
            {p.saves.length === 0 ? (
              <p className="mt-2 text-[10px] leading-relaxed text-[#5b6b8c]/70">
                暂无手动存档。游戏内每 30 秒自动保存当前进度；「⬇」按钮可另存为固定存档。
              </p>
            ) : (
              <div className="mg-scroll mt-2 max-h-[34vh] space-y-1.5 overflow-y-auto pr-1">
                {p.saves.map((s) => (
                  <div key={s.id} className="rounded border border-[#1a2540] px-2 py-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[12px] text-[#dbe4f3]/90">{s.name}</span>
                      <span className="shrink-0 font-mono text-[9px] text-[#5b6b8c]/60">{fmt(s.savedAt)}</span>
                    </div>
                    <div className="mt-0.5 font-mono text-[9px] text-[#5b6b8c]/50">
                      {s.bodies} 天体{s.preset ? ` · ${PRESETS.find((pr) => pr.id === s.preset)?.label ?? s.preset}` : ''}
                    </div>
                    <div className="mt-1 flex gap-1">
                      <button
                        onClick={() => p.onLoadSave(s.id)}
                        className="flex-1 rounded border border-[#22d3ee]/40 px-1 py-0.5 text-[10px] text-[#22d3ee] hover:bg-[#22d3ee]/10"
                      >
                        进入
                      </button>
                      <button
                        onClick={() => p.onExportSave(s.id)}
                        className="flex-1 rounded border border-[#1a2540] px-1 py-0.5 text-[10px] text-[#dbe4f3]/70 hover:border-[#22d3ee]/35"
                      >
                        导出
                      </button>
                      <button
                        onClick={() => p.onDeleteSave(s.id)}
                        className="flex-1 rounded border border-[#f87171]/25 px-1 py-0.5 text-[10px] text-[#f87171]/80 hover:border-[#f87171]/50"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                ))}
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
