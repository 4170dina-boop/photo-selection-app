import sharp from 'sharp';
import { MAX_INPUT_PIXELS } from './uploadPolicy';
import { DHASH_HEIGHT, DHASH_WIDTH, dhashFromGrey } from './bursts';

// dHash (64 ביט) לתמונה - בצד שרת בלבד (sharp). מחושב מתמונת הגריד הקטנה
// (480px, עם סימן המים): זול מאוד, וגם עובד בהשלמה לתמונות ישנות שהמקור שלהן
// כבר נמחק. סימן המים זהה בכל תמונות הגלריה, אז הוא כמעט לא משפיע על ההשוואה
// בין שתי תמונות. ראו lib/bursts.ts.
export async function computeDHash(input: Buffer): Promise<string> {
  const { data } = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .flatten({ background: '#ffffff' })
    .greyscale()
    .resize(DHASH_WIDTH, DHASH_HEIGHT, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return dhashFromGrey(data, DHASH_WIDTH, DHASH_HEIGHT);
}
