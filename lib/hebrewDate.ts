// המרה לתאריך עברי מלא (עם גימטריה, למשל "כ״ו באלול תשפ״ו") להצגה ללקוחה -
// בכוונה לא כתובים בקוד רגיל, במקום תאריך לועזי. Intl עם ('he-IL-u-ca-hebrew')
// כבר נותן לנו את שם החודש העברי ואת המספרים (יום/שנה) בלוח השנה העברי, אבל
// לא ממיר אותם לאותיות גימטריה בעצמו (בדקנו: numberingSystem: 'hebr' לא עובד
// על Intl.DateTimeFormat) - לכן ההמרה למספרים עבריים כתובה כאן ידנית.
function numberToHebrewLetters(num: number): string {
  const values: [number, string][] = [
    [400, 'ת'], [300, 'ש'], [200, 'ר'], [100, 'ק'],
    [90, 'צ'], [80, 'פ'], [70, 'ע'], [60, 'ס'], [50, 'נ'], [40, 'מ'], [30, 'ל'], [20, 'כ'], [10, 'י'],
    [9, 'ט'], [8, 'ח'], [7, 'ז'], [6, 'ו'], [5, 'ה'], [4, 'ד'], [3, 'ג'], [2, 'ב'], [1, 'א'],
  ];

  let n = num;
  let letters = '';

  // 15/16 נכתבים ט״ו/ט״ז ולא י״ה/י״ו, כדי לא לאיית את שם ה'.
  if (n % 100 === 15) {
    letters += 'טו';
    n -= 15;
  } else if (n % 100 === 16) {
    letters += 'טז';
    n -= 16;
  }

  for (const [value, letter] of values) {
    while (n >= value) {
      letters += letter;
      n -= value;
    }
  }

  if (letters.length <= 1) return letters + '׳';
  return letters.slice(0, -1) + '״' + letters.slice(-1);
}

export function toHebrewDateString(date: Date): string {
  const parts = new Intl.DateTimeFormat('he-IL-u-ca-hebrew', { day: 'numeric', month: 'long', year: 'numeric' }).formatToParts(date);
  const day = Number(parts.find((p) => p.type === 'day')?.value);
  const month = parts.find((p) => p.type === 'month')?.value ?? '';
  const year = Number(parts.find((p) => p.type === 'year')?.value);

  return `${numberToHebrewLetters(day)} ב${month} ${numberToHebrewLetters(year % 1000)}`;
}
