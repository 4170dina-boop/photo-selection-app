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
    // בלי זה, כל worktree זמני שנוצר תחת .claude/worktrees (עבודה מקבילה של
    // סוכנים) מכיל עותק מלא של הריפו כולל קבצי הבדיקות שלו - vitest מריץ
    // את כולם ביחד עם הבדיקות האמיתיות, מה שמכפיל את הזמן ובעומס גבוה (הרבה
    // worktrees בבת אחת) גם גורם לתהליכי הבדיקה עצמם ליפול (spawn ENOENT/UNKNOWN).
    exclude: ['**/node_modules/**', '**/.claude/worktrees/**'],
  },
});
