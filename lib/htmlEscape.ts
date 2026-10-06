// נטרול ערכים בתוך HTML - בלי תלויות, כדי שאפשר יהיה להשתמש בזה גם בדפדפן
// (lib/clientInviteMessage.ts) וגם בשרת (lib/email.ts מייצא מחדש את אותן פונקציות).

// כל ערך שמוכנס לתבנית HTML (שם לקוחה, שם עסק, קוד גישה, שמות קבצים, מיקום,
// הערות) הוא טקסט חופשי - מנטרלים תווים מיוחדים כדי שלא ישברו את המייל או
// יזריקו HTML/קישורים.
export function escapeHtml(value: string | number | null | undefined): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// כתובת לשימוש בתוך href/src: רק http/https (לא javascript:, data: וכו'), ומנוטרלת
// לתוך attribute. null = כתובת לא תקינה - הכפתור/התמונה פשוט לא יוצגו.
export function safeHref(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return escapeHtml(parsed.toString());
  } catch {
    return null;
  }
}
