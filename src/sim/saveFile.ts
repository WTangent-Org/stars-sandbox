/** 存档文件（.json）的导入导出——浏览器专用（依赖 document/下载）。纯校验见 save.ts。 */
import type { WorldState } from './types'
import { validateWorldState } from './save'

/** 触发浏览器下载 .json 存档文件 */
export function exportSaveFile(name: string, state: WorldState) {
  const blob = new Blob([JSON.stringify(state)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${name.replace(/[\\/:*?"<>|]/g, '_') || 'universe'}.json`
  a.click()
  URL.revokeObjectURL(url)
}

/** 弹出文件选择框读入 .json 存档；用户取消返回 null，格式错误抛异常 */
export function importSaveFile(): Promise<{ name: string; state: WorldState } | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return resolve(null)
      try {
        const state = validateWorldState(JSON.parse(await file.text()))
        if (!state) return reject(new Error('存档文件格式不正确'))
        resolve({ name: file.name.replace(/\.json$/i, ''), state })
      } catch (e) {
        reject(e instanceof SyntaxError ? new Error('存档文件不是合法 JSON') : e)
      }
    }
    input.click()
  })
}
