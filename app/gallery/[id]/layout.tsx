import type { Metadata } from 'next';

// manifest נטען רק בתת-הנתיב gallery/[id] (מסך הלקוחה) ולא בדשבורד הצלמת -
// שם אין טעם ב"התקנה למסך הבית" או במטמון תמונות אופליין.
export const metadata: Metadata = {
  manifest: '/manifest.json',
};

export default function GalleryLayout({ children }: { children: React.ReactNode }) {
  return children;
}
