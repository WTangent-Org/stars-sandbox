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
  autosave: AutosaveInfo | null
  saves: SaveMeta[]
  /** 上次进入的房间号（localStorage 持久化）：多人页一键直达 */
  lastRoom?: string
  /** 新建房间：把当前宇宙开成联机房（离线时自动先连服务器） */
  onNewRoom: () => void
  onContinue: () => void
  onNewWorld: (preset: PresetId) => void
  onLoadSave: (id: string) => void
  onDeleteSave: (id: string) => void
  onExportSave: (id: string) => void
  onImportSave: () => void
  onJoinMultiplayer: (roomCode: string) => void
}

type Section = 'main' | 'worlds' | 'multi'

/** MC 风格主菜单：世界（存档）是一级入口，本地与多人分列 */
export default function MainMenu(p: Props) {
  const [section, setSection] = useState<Section>('main')
  const [newWorldOpen, setNewWorldOpen] = useState(false)
  const [roomInput, setRoomInput] = useState('')

  const back = () => {
    setSection('main')
    setNewWorldOpen(false)
  }

  const bigBtn =
    'w-full rounded-md border border-[#5b6b8c]/40 bg-[#0c1220]/80 px-4 py-3 text-left text-[14px] text-[#dbe4f3] transition-all hover:border-[#22d3ee]/60 hover:bg-[#22d3ee]/10'

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-[#050810]/70 backdrop-blur-[2px]">
      <div className="glass mg-fadeup w-[min(430px,92vw)] rounded-xl p-6">
        <div className="text-center">
          <div className="font-mono text-[10px] tracking-[0.35em] text-[#5b6b8c]">N-BODY GRAVITY SANDBOX</div>
          <h1 className="mt-1 text-[22px] font-bold tracking-wider text-[#dbe4f3]">星球物理模拟器</h1>
        </div>

        {section === 'main' && (
          <div className="mt-5 space-y-2.5">
            <button onClick={p.onContinue} className={`${bigBtn} border-[#22d3ee]/50`}>
              <span className="text-[#22d3ee]">▶ 继续游戏</span>
              <span className="mt-0.5 block text-[10px] text-[#5b6b8c]">
                {p.autosave
                  ? `上次的宇宙 · ${p.autosave.bodies} 天体 · ${new Date(p.autosave.savedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`
                  : '新建的宇宙（真实太阳系）'}
              </span>
            </button>
            <button onClick={() => setNewWorldOpen(!newWorldOpen)} className={bigBtn}>
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
            <button onClick={() => setSection('worlds')} className={bigBtn}>
              📁 本地世界
              <span className="mt-0.5 block text-[10px] text-[#5b6b8c]">
                {p.saves.length > 0 ? `${p.saves.length} 个存档` : '载入存档 / 导入导出 .json'}
              </span>
            </button>
            <button onClick={() => setSection('multi')} className={bigBtn}>
              ⇄ 多人游戏
              <span className="mt-0.5 block text-[10px] text-[#5b6b8c]">连接服务器 · 公共大厅或房号私房</span>
            </button>
          </div>
        )}

        {section === 'worlds' && (
          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between">
              <button onClick={back} className="font-mono text-[11px] text-[#5b6b8c] hover:text-[#dbe4f3]">
                ← 返回
              </button>
              <button
                onClick={p.onImportSave}
                className="rounded border border-[#1a2540] px-2 py-1 text-[10px] text-[#dbe4f3]/70 hover:border-[#22d3ee]/35"
              >
                导入 .json
              </button>
            </div>
            {p.saves.length === 0 ? (
              <p className="rounded-md border border-[#1a2540] px-3 py-6 text-center text-[11px] text-[#5b6b8c]/60">
                还没有本地世界。游戏内会每 30 秒自动保存；也可以在游戏菜单里手动保存。
              </p>
            ) : (
              <div className="mg-scroll max-h-[46vh] space-y-1.5 overflow-y-auto pr-1">
                {p.saves.map((s) => (
                  <div key={s.id} className="rounded border border-[#1a2540] px-2.5 py-2">
                    <div className="flex items-center justify-between">
                      <span className="truncate text-[12.5px] text-[#dbe4f3]/90">{s.name}</span>
                      <span className="ml-2 shrink-0 font-mono text-[9px] text-[#5b6b8c]/60">
                        {new Date(s.savedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <div className="mt-0.5 font-mono text-[9px] text-[#5b6b8c]/50">
                      {s.bodies} 天体{s.preset ? ` · ${PRESETS.find((pr) => pr.id === s.preset)?.label ?? s.preset}` : ''}
                    </div>
                    <div className="mt-1.5 flex gap-1.5">
                      <button
                        onClick={() => p.onLoadSave(s.id)}
                        className="flex-1 rounded border border-[#22d3ee]/40 px-1.5 py-1 text-[10.5px] text-[#22d3ee] hover:bg-[#22d3ee]/10"
                      >
                        进入世界
                      </button>
                      <button
                        onClick={() => p.onExportSave(s.id)}
                        className="flex-1 rounded border border-[#1a2540] px-1.5 py-1 text-[10.5px] text-[#dbe4f3]/70 hover:border-[#22d3ee]/35"
                      >
                        导出
                      </button>
                      <button
                        onClick={() => p.onDeleteSave(s.id)}
                        className="flex-1 rounded border border-[#f87171]/25 px-1.5 py-1 text-[10.5px] text-[#f87171]/80 hover:border-[#f87171]/50"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {section === 'multi' && (
          <div className="mt-5 space-y-3">
            <button onClick={back} className="font-mono text-[11px] text-[#5b6b8c] hover:text-[#dbe4f3]">
              ← 返回
            </button>
            <button
              onClick={() => p.onJoinMultiplayer('')}
              className="w-full rounded-md border border-[#34d399]/50 bg-[#34d399]/10 px-4 py-2.5 text-left text-[13px] text-[#34d399] hover:bg-[#34d399]/20"
            >
              🌐 进入公共大厅
            </button>
            <button
              onClick={p.onNewRoom}
              className="w-full rounded-md border border-[#22d3ee]/40 bg-[#22d3ee]/10 px-4 py-2.5 text-left text-[13px] text-[#22d3ee] hover:bg-[#22d3ee]/20"
            >
              ＋ 新建房间
              <span className="mt-0.5 block text-[10px] text-[#5b6b8c]">把当前宇宙开成联机房，你成为房主</span>
            </button>
            {p.lastRoom && (
              <button
                onClick={() => p.onJoinMultiplayer(p.lastRoom!)}
                className="w-full rounded-md border border-[#5b6b8c]/40 bg-[#0c1220]/60 px-4 py-2.5 text-left text-[12px] text-[#dbe4f3]/85 hover:border-[#22d3ee]/40"
              >
                ↩ 回到上次房间「{p.lastRoom}」
              </button>
            )}
            <div className="space-y-1.5">
              <span className="mg-label">房间号</span>
              <input
                className="w-full rounded border border-[#1a2540] bg-[#0c1220] px-3 py-2 font-mono text-[12px] text-[#dbe4f3] outline-none focus:border-[#22d3ee]/50"
                placeholder="留空 = 公共大厅"
                value={roomInput}
                onChange={(e) => setRoomInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') p.onJoinMultiplayer(roomInput.trim())
                }}
              />
            </div>
            <button
              onClick={() => p.onJoinMultiplayer(roomInput.trim())}
              className="w-full rounded-md border border-[#22d3ee]/50 bg-[#22d3ee]/10 px-4 py-2.5 text-[13px] text-[#22d3ee] hover:bg-[#22d3ee]/20"
            >
              ⇄ 连接服务器
            </button>
            <p className="text-[10px] leading-relaxed text-[#5b6b8c]">
              连接本网页同一服务器的联机大厅；朋友开放宇宙到局域网后，把房号填在这里即可加入。进房后你使用的宇宙以房间为准；退出后回到你自己的本地世界。
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
