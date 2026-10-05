import type { Metadata } from 'next';

// manifest נטען רק בתת-הנתיב gallery/[id] (מסך הלקוחה) ולא בדשבורד הצלמת -
// שם אין טעם ב"התקנה למסך הבית" או במטמון תמונות אופליין. manifest נפרד לכל
// גלריה (app/api/gallery/[id]/manifest) כדי שהאייקון במסך הבית ייפתח בגלריה עצמה.
export function generateMetadata({ params }: { params: { id: string } }): Metadata {
  return { manifest: `/api/gallery/${encodeURIComponent(params.id)}/manifest` };
}

export default function GalleryLayout({ children }: { children: React.ReactNode }) {
  return children;
}
