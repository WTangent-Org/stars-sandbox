/** 游戏内菜单（右上 ☰）：只管「会话级」动作——保存/开放都在 Dock 世界页，不重复。 */
interface Props {
  online: boolean
  isHost: boolean
  room: string
  saveMsg: string
  onResume: () => void
  onExitToMenu: () => void
}

export default function GameMenu(p: Props) {
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
          <button onClick={p.onExitToMenu} className={`${btn} border-[#f87171]/30 text-[#f87171]/90 hover:border-[#f87171]/60`}>
            ⏏ 保存并退出到主菜单
            <span className="mt-0.5 block text-[10px] text-[#5b6b8c]/70">
              {p.online && p.isHost ? `你是房主（房间 ${p.room}）：房间将解散，宇宙回到你的本地世界` : '宇宙自动保存到本机'}
            </span>
          </button>
        </div>
        <p className="mt-3 text-center font-mono text-[10px] text-[#5b6b8c]/70">
          保存 / 新建房间（开放局域网）在左侧「世界」页 · 每分钟自动保存
        </p>
        {p.saveMsg && <p className="mt-2 text-center font-mono text-[10.5px] text-[#34d399]">{p.saveMsg}</p>}
      </div>
    </div>
  )
}
