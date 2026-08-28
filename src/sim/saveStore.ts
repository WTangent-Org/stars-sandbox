/** 本地存档库：IndexedDB 多槽位存储（星系场景状态量大，localStorage 装不下）。 */
import type { WorldState } from './types'

export interface SaveMeta {
  id: string
  name: string
  savedAt: number
  bodies: number
  preset?: string
}

interface SaveRecord extends SaveMeta {
  state: WorldState
}

const DB_NAME = 'stars-sandbox-saves'
const STORE = 'saves'
const AUTOSAVE = 'autosave'
const AUTOSAVE_KEY = 'auto'

function openDb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, 2)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(AUTOSAVE)) db.createObjectStore(AUTOSAVE, { keyPath: 'id' })
    }
    req.onsuccess = () => res(req.result)
    req.onerror = () => rej(req.error)
  })
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((res, rej) => {
        const t = db.transaction(STORE, mode)
        const req = run(t.objectStore(STORE))
        req.onsuccess = () => res(req.result)
        req.onerror = () => rej(req.error)
        t.oncomplete = () => db.close()
      }),
  )
}

function txStore<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((res, rej) => {
        const t = db.transaction(store, mode)
        const req = run(t.objectStore(store))
        req.onsuccess = () => res(req.result)
        req.onerror = () => rej(req.error)
        t.oncomplete = () => db.close()
      }),
  )
}

export async function listSaves(): Promise<SaveMeta[]> {
  const all = await tx('readonly', (s) => s.getAll() as IDBRequest<SaveRecord[]>)
  return all
    .map(({ id, name, savedAt, bodies, preset }) => ({ id, name, savedAt, bodies, preset }))
    .sort((a, b) => b.savedAt - a.savedAt)
}

export async function putSave(name: string, state: WorldState): Promise<string> {
  const id = `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const rec: SaveRecord = { id, name, savedAt: Date.now(), bodies: state.bodies.length, preset: state.preset, state }
  await tx('readwrite', (s) => s.put(rec))
  return id
}

export function getSave(id: string): Promise<SaveRecord | undefined> {
  return tx('readonly', (s) => s.get(id) as IDBRequest<SaveRecord | undefined>)
}

export async function deleteSave(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id))
}

/** 自动存档：单一槽位，启动时恢复「上次离开时的宇宙」（存档为基础的启动体验） */
export async function putAutosave(state: WorldState): Promise<void> {
  await txStore(AUTOSAVE, 'readwrite', (s) => s.put({ id: AUTOSAVE_KEY, savedAt: Date.now(), state }))
}

export async function getAutosave(): Promise<{ savedAt: number; state: WorldState } | undefined> {
  const rec = await txStore(AUTOSAVE, 'readonly', (s) => s.get(AUTOSAVE_KEY) as IDBRequest<{ savedAt: number; state: WorldState } | undefined>)
  return rec && rec.state?.version === 1 ? rec : undefined
}
