import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // 빌드 게이트는 '진짜 버그'(no-undef/no-unused-vars 등)에서만 실패시키고,
      // 정상 로딩 패턴까지 잡는 성능 힌트는 경고로 (배포를 막지 않음).
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
])
