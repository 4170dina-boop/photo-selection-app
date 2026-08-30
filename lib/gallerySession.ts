import { NextRequest } from 'next/server';
import { verifySession, SessionPayload } from '@/lib/session';

export const SESSION_MAX_AGE_MS = 60 * 60 * 24 * 14 * 1000; // שבועיים

// עוטף את verifySession כדי שכל ה-API routes של הגלריה יבדקו באותו אופן,
// מול אותה עוגייה (gallery_session_{galleryId}) ואותו משך תוקף.
export function requireGallerySession(req: NextRequest, galleryId: string): SessionPayload | null {
  const token = req.cookies.get(`gallery_session_${galleryId}`)?.value;
  return verifySession(token, galleryId, SESSION_MAX_AGE_MS);
}
