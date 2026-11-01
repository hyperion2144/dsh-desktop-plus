import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // 与迁移前的 `node --test --test-timeout=60000` 对齐：WS 保活/大帧用例的等待窗口较长。
    testTimeout: 60000,
  },
})
