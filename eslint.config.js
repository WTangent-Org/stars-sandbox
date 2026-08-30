import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // 本项目是 ref-heavy 的 canvas 游戏架构：pages/rt.ts 运行时容器在 rAF 循环
      // 与 React 渲染层之间共享可变引用，hooks 内的 ref 突变与挂载期异步存档加载
      // 是有意设计。React Compiler 的静态规则无法理解这种模式，按项目决策关闭。
      'react-hooks/immutability': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/globals': 'off',
      'react-hooks/react-compiler': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      // exhaustive-deps 保留 warn 级别（见下 'warn' 默认），此处不重复配置
    },
  },
])
