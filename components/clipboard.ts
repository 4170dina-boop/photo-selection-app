// העתקה ללוח מהדפדפן - טקסט רגיל, ואם ניתן גם HTML (ג'ימייל/אאוטלוק מדביקים
// את הגרסה המעוצבת, וואטסאפ את הטקסט). אותו דפוס כמו ClientInviteMessageCopy:
// ClipboardItem -> writeText -> execCommand('copy') דרך textarea זמני.
// מחזיר false אם שום דרך לא עבדה (HTTP לא מאובטח/הרשאה נדחתה) - הקורא מציג
// את הטקסט להעתקה ידנית.
export async function copyToClipboard(text: string, html?: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    if (html && typeof ClipboardItem !== 'undefined') {
      try {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/plain': new Blob([text], { type: 'text/plain' }),
            'text/html': new Blob([html], { type: 'text/html' }),
          }),
        ]);
        return true;
      } catch {
        // נופלים לטקסט בלבד
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // נופלים ל-execCommand
    }
  }
  try {
    const el = document.createElement('textarea');
    el.value = text;
    el.setAttribute('readonly', '');
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand('copy');
    el.remove();
    return ok;
  } catch {
    return false;
  }
}
