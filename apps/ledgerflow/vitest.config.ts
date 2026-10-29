import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Screen tests: the real React screens in a simulated browser (jsdom). Logic tests stay on node --test (tests/*.test.ts).
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['tests/ui/**/*.test.tsx'],
    setupFiles: ['tests/ui/setup.ts'],
  },
})
