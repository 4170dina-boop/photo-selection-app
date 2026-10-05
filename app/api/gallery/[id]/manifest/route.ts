import { NextResponse } from 'next/server';
import baseManifest from '@/public/manifest.json';

// manifest לכל גלריה בנפרד - כדי שאחרי "הוספה למסך הבית" האייקון ייפתח ישר
// בגלריה של הלקוחה ולא בדף הבית של האתר (start_url: "/" ב-public/manifest.json).
// לא חושף שום מידע על הגלריה - רק את הנתיב שהלקוחה כבר נמצאת בו.
const GALLERY_ID_RE = /^[A-Za-z0-9-]{1,64}$/;

export function GET(_req: Request, { params }: { params: { id: string } }) {
  if (!GALLERY_ID_RE.test(params.id)) {
    return NextResponse.json(baseManifest, { headers: { 'Content-Type': 'application/manifest+json' } });
  }
  const galleryPath = `/gallery/${params.id}`;
  return NextResponse.json(
    { ...baseManifest, id: galleryPath, start_url: galleryPath, scope: galleryPath },
    { headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'public, max-age=86400' } }
  );
}
