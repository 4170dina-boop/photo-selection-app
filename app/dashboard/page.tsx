import { redirect } from 'next/navigation';

// /dashboard עצמו (בלי תת-נתיב) - מסך "היום" הוא דף הבית של הצלמת
export default function DashboardIndex() {
  redirect('/dashboard/today');
}
