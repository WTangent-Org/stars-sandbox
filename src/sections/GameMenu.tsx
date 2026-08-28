import type { PropsWithChildren } from 'react'

interface Props {
  online: boolean
  isHost: boolean
  room: string
  saveMsg: string
  onResume: () => void
  onSave: () => void
  onHostLan: () => void
  onExitToMenu: () => void
}

/** 游戏内菜单（Esc）：MC 语义——保存 / 对局域网开放 / 保存并退出到主菜单 */
export default function GameMenu(p: PropsWithChildren<Props>) {
  const btn =
    'w-full rounded-md border border-[#5b6b8c]/40 bg-[#0c1220]/80 px-4 py-2.5 text-[13px] text-[#dbe4f3] transition-all hover:border-[#22d3ee]/60 hover:bg-[#22d3ee]/10'

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-[#050810]/70 backdrop-blur-[2px]">
      <div className="glass mg-fadeup w-[min(340px,90vw)] rounded-xl p-5">
        <div className="text-center font-mono text-[10px] tracking-[0.3em] text-[#5b6b8c]">GAME MENU</div>
        <div className="mt-4 space-y-2.5">
          <button onClick={p.onResume} className={`${btn} border-[#22d3ee]/50 text-[#22d3ee]`}>
            ▶ 返回游戏
          </button>
          <button onClick={p.onSave} className={btn}>
            ⬇ 保存当前宇宙
            <span className="mt-0.5 block text-[10px] text-[#5b6b8c]">另有每 30 秒的自动保存</span>
          </button>
          <button onClick={p.onHostLan} disabled={!p.online} className={`${btn} disabled:opacity-40`}>
            ⇪ 对局域网开放
            <span className="mt-0.5 block text-[10px] text-[#5b6b8c]">
              {p.online ? (p.isHost ? `当前房间 ${p.room} · 你是房主` : '把当前宇宙装进新房间，生成房号邀请朋友') : '需要先连接服务器（多人游戏）'}
            </span>
          </button>
          <button onClick={p.onExitToMenu} className={`${btn} border-[#f87171]/30 text-[#f87171]/90 hover:border-[#f87171]/60`}>
            ⏏ 保存并退出到主菜单
            <span className="mt-0.5 block text-[10px] text-[#5b6b8c]/70">
              {p.online && p.isHost ? '你是房主：房间将解散，宇宙回到你的本地世界' : '宇宙自动保存到本机'}
            </span>
          </button>
        </div>
        {p.saveMsg && <p className="mt-3 text-center font-mono text-[10.5px] text-[#34d399]">{p.saveMsg}</p>}
      </div>
    </div>
  )
}
