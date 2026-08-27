// 构建后处理：生成 Kimi 发布平台需要的 dist/boot.js 入口
// 平台约定：WORKDIR=/code，启动命令 node dist/boot.js
// 我们把服务端打包产物也放进 dist/，单目录交付
import { copyFileSync, writeFileSync, mkdirSync } from 'node:fs'

mkdirSync('dist/server', { recursive: true })
copyFileSync('dist-server/server.js', 'dist/server/server.js')
writeFileSync(
  'dist/boot.js',
  `// Kimi 发布平台入口：物理模拟 + 静态托管，一体化
import './server/server.js'
`,
)
console.log('[postbuild] dist/boot.js + dist/server/server.js 已生成')
