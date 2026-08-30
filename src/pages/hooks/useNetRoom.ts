/**
 * 联机房间接线：net 事件回调（此前在 render 体里每帧重赋值）收进一个 effect，
 * 加上显式连接 / 断线重连 / 房号变化 / 权限表拉取。
 */
import { useEffect, useCallback, useRef, useState } from 'react'
import type { NetStatus } from '../../sim/net'
import type { RoomListMsg } from '../../shared/protocol'
import { loadPreset, PRESETS } from '../../sim/presets'
import { Simulation } from '../../sim/engine'
import type { PresetId, UnitProfile } from '../../sim/types'
import type { Rt } from '../rt'

interface Params {
  rt: Rt
  netStatus: NetStatus
  selectedId: number | null
  setNetStatus: (s: NetStatus) => void
  bumpLobby: () => void
  showSaveMsg: (m: string) => void
  rerender: () => void
  setUnits: (u: UnitProfile | undefined) => void
  setCurrentPreset: (id: PresetId) => void
  setSelectedId: (id: number | null) => void
  setFollow: (v: boolean) => void
}

export function useNetRoom(p: Params) {
  const { rt } = p
  const { net } = rt
  const [roomList, setRoomList] = useState<RoomListMsg['rooms']>([])
  /** 「新建房间」在离线时的挂起目标：连上后自动 hostsave 到该房并成为房主 */
  const pendingHostRef = useRef('')

  /** 进入指定房间（房号留空 = 公共大厅）。离线则先连服务器，连上自动进房 */
  const joinRoomId = useCallback(
    (id: string) => {
      rt.userTouchedRef.current = true
      rt.netDesiredRef.current = true
      net.pendingRoom = id
      p.setSelectedId(null)
      p.setFollow(false)
      if (net.status === 'connected') net.joinRoom(id)
      else net.connect()
    },
    [net, rt, p],
  )

  /** 新建房间：把当前宇宙装进一个全新房间并成为房主（MC：用你的世界开服） */
  const hostNewRoom = useCallback(() => {
    rt.userTouchedRef.current = true
    rt.netDesiredRef.current = true
    if (rt.onlineRef.current) {
      void (async () => {
        try {
          const st = await net.requestState()
          const id = `w-${Math.random().toString(36).slice(2, 8)}`
          net.hostSave(st, id)
          p.showSaveMsg(`已创建房间 ${id}`)
        } catch {
          p.showSaveMsg('创建房间失败')
        }
      })()
    } else {
      pendingHostRef.current = `w-${Math.random().toString(36).slice(2, 8)}`
      net.pendingRoom = 'lobby'
      net.connect()
      p.showSaveMsg('正在连接服务器…')
    }
  }, [net, rt, p])

  const refreshRooms = useCallback(() => net.requestRoomList(), [net])

  // 连上服务器后：执行挂起的新建房间，并刷新房间列表
  useEffect(() => {
    if (p.netStatus !== 'connected') return
    net.requestRoomList()
    const id = pendingHostRef.current
    if (!id) return
    pendingHostRef.current = ''
    void (async () => {
      try {
        const st = await net.requestState()
        net.hostSave(st, id)
        p.showSaveMsg(`已创建房间 ${id}，把房号发给朋友即可加入`)
      } catch {
        p.showSaveMsg('创建房间失败')
      }
    })()
  }, [p.netStatus, net, p])

  const connectNet = useCallback(() => {
    rt.netDesiredRef.current = true
    net.pendingRoom = rt.prefsRef.current.roomCode
    net.connect()
  }, [net, rt])

  // —— net 事件统一接线（回调依赖的全是稳定 setState/rt 引用，挂载一次即可） ——
  useEffect(() => {
    net.onStatus = p.setNetStatus
    net.onLobby = p.bumpLobby
    net.onRoomList = setRoomList
    // hostsave 结果：开房成功给出房号提示
    net.onHosted = (room) => {
      if (room) p.showSaveMsg(`已开放到局域网 · 房号 ${room}，朋友打开本页面填房号即可加入`)
      p.bumpLobby()
    }
    // 房主解散房间（MC：房主走，房没）：回到离线单机
    net.onRoomClosed = (reason) => {
      rt.netDesiredRef.current = false
      p.showSaveMsg(reason === 'host_closed' ? '房主已关闭房间，回到单机模式' : '房主已离开，房间解散，回到单机模式')
      p.bumpLobby()
    }
    // 房间预设（进房/房内投票切换）：客户端采用房间的呈现（相机/单位/流速）
    net.onPreset = (preset) => {
      const id = (PRESETS.some((pr) => pr.id === preset) ? preset : 'empty') as PresetId
      const probe = new Simulation()
      const { zoom, units: u } = loadPreset(probe, id)
      rt.camRef.current = { x: 0, y: 0, zoom }
      rt.baseTimeScaleRef.current = probe.config.timeScale
      rt.unitsRef.current = u
      p.setUnits(u)
      p.setCurrentPreset(id)
      p.setSelectedId(null)
      p.setFollow(false)
      p.rerender()
    }
    return () => {
      net.onStatus = null
      net.onLobby = null
      net.onRoomList = null
      net.onHosted = null
      net.onRoomClosed = null
      net.onPreset = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [net])

  // —— 显式连接后的断线自动重试（默认离线，不自动连） ——
  useEffect(() => {
    const t = setInterval(() => {
      if (rt.netDesiredRef.current && (net.status === 'disconnected' || net.status === 'error')) net.connect()
    }, 15000)
    return () => clearInterval(t)
  }, [net, rt])

  // —— 房间号变化：换房（在线时立即加入，离线记为待进房） ——
  useEffect(() => {
    net.pendingRoom = rt.prefsRef.current.roomCode
    if (net.status === 'connected') {
      net.joinRoom(rt.prefsRef.current.roomCode || undefined)
      p.setSelectedId(null)
      p.setFollow(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rt.prefsRef.current.roomCode])

  // —— 联机点选天体：拉取权限表（选中卡片显示归属/授权用） ——
  useEffect(() => {
    if (net.status === 'connected' && p.selectedId != null) net.queryPerms(p.selectedId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.selectedId, p.netStatus])

  return { connectNet, joinRoomId, hostNewRoom, roomList, refreshRooms }
}
