/**
 * Home 页面的共享可变运行时：全部 ref 集中一处创建，各 hooks 共享同一组引用。
 * 这是把 1600 行 Home 拆开而不改变行为的关键——所有突变模式保持原样，只挪代码位置。
 */
import type { RefObject } from 'react'
import { Simulation } from '../sim/engine'
import { FutureBuffer } from '../sim/future'
import { NetSim } from '../sim/net'
import { makeStarfield, type SpawnPreview } from '../sim/renderer'
import type { Camera, PresetId, SpawnSettings, ToolMode, UnitProfile } from '../sim/types'
import type { Prefs } from '../sim/prefs'

export interface GrabState {
  id: number
  lastX: number
  lastY: number
  lastT: number
  vx: number
  vy: number
  origVx: number
  origVy: number
  moved: boolean
  /** 拖动阈值：按下后先记录屏幕/世界坐标，指针移动超过 6px 才真正抓起天体，避免「点击选中」手抖挪歪天体 */
  armed: boolean
  sx: number
  sy: number
  origX: number
  origY: number
}

export interface Rt {
  localSim: Simulation
  net: NetSim
  future: FutureBuffer
  canvasRef: RefObject<HTMLCanvasElement | null>
  camRef: RefObject<Camera>
  starfieldRef: RefObject<ReturnType<typeof makeStarfield>>
  spawnPreviewRef: RefObject<SpawnPreview | null>
  dragRef: RefObject<{ active: boolean; sx: number; sy: number; moved: boolean }>
  grabRef: RefObject<GrabState | null>
  fpsRef: RefObject<number>
  /** 飞船操控：键盘按键集合 + 触屏虚拟摇杆 */
  keysRef: RefObject<Set<string>>
  joystickRef: RefObject<{ active: boolean; x: number; y: number }>
  joyAnchorRef: RefObject<{ x: number; y: number } | null>
  pointersRef: RefObject<Map<number, { x: number; y: number }>>
  pinchRef: RefObject<{ d0: number; zoom0: number; wx: number; wy: number } | null>
  modeRef: RefObject<ToolMode>
  spawnCfgRef: RefObject<SpawnSettings>
  selectedRef: RefObject<number | null>
  followRef: RefObject<boolean>
  prefsRef: RefObject<Prefs>
  unitsRef: RefObject<UnitProfile | undefined>
  warpRef: RefObject<number>
  baseTimeScaleRef: RefObject<number>
  currentPresetRef: RefObject<PresetId>
  onlineRef: RefObject<boolean>
  activeSimRef: RefObject<Simulation>
  /** 显式连接过服务器才自动重连（默认离线，不自动连） */
  netDesiredRef: RefObject<boolean>
  /** 启动恢复存档是一次异步过程：用户先动了预设/存档就放弃恢复 */
  userTouchedRef: RefObject<boolean>
  lastThrottleRef: RefObject<number>
  lastThrustDirRef: RefObject<{ x: number; y: number }>
}

export function createRt(): Rt {
  const localSim = new Simulation()
  const net = new NetSim()
  const future = new FutureBuffer()
  return {
    localSim,
    net,
    future,
    canvasRef: { current: null },
    camRef: { current: { x: 0, y: 0, zoom: 1 } },
    starfieldRef: { current: makeStarfield(1600, 900) },
    spawnPreviewRef: { current: null },
    dragRef: { current: { active: false, sx: 0, sy: 0, moved: false } },
    grabRef: { current: null },
    fpsRef: { current: 60 },
    keysRef: { current: new Set<string>() },
    joystickRef: { current: { active: false, x: 0, y: 0 } },
    joyAnchorRef: { current: null },
    pointersRef: { current: new Map() },
    pinchRef: { current: null },
    modeRef: { current: 'pan' },
    spawnCfgRef: { current: { kind: 'planet', mass: 20, autoOrbit: false } },
    selectedRef: { current: null },
    followRef: { current: false },
    prefsRef: { current: undefined as unknown as Prefs },
    unitsRef: { current: undefined },
    warpRef: { current: 1 },
    baseTimeScaleRef: { current: 40 },
    currentPresetRef: { current: 'real' },
    onlineRef: { current: false },
    activeSimRef: { current: localSim },
    netDesiredRef: { current: false },
    userTouchedRef: { current: false },
    lastThrottleRef: { current: 0 },
    lastThrustDirRef: { current: { x: 0, y: 0 } },
  }
}
