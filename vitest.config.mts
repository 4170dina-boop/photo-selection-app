import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    // תואם ל-"paths": { "@/*": ["./*"] } ב-tsconfig.json - vitest לא קורא
    // את זה אוטומטית (זה tsc/Next.js בלבד), אז צריך גם כאן.
    alias: {
      '@': path.resolve(import.meta.dirname, '.'),
    },
  },
  test: {
    environment: 'node',
    env: {
      SESSION_SECRET: 'test-session-secret-for-vitest-only',
    },
  },
});
