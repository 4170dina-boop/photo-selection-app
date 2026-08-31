import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { computeSharpnessScore } from './sharpness';

// בונה תמונת בדיקה עם הרבה קצוות (רשת משבצות) - יש לזה מרקם אמיתי לנתח,
// בניגוד לצבע אחיד שהיה נותן variance אפס תמיד (גם לפני טשטוש)
async function buildCheckerboard(): Promise<Buffer> {
  const size = 200;
  const cell = 10;
  const svg = `
    <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="white"/>
      ${Array.from({ length: size / cell }, (_, row) =>
        Array.from({ length: size / cell }, (_, col) =>
          (row + col) % 2 === 0
            ? `<rect x="${col * cell}" y="${row * cell}" width="${cell}" height="${cell}" fill="black"/>`
            : ''
        ).join('')
      ).join('')}
    </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

describe('computeSharpnessScore', () => {
  it('scores a sharp checkerboard higher than a blurred version of the same image', async () => {
    const sharpImage = await buildCheckerboard();
    const blurredImage = await sharp(sharpImage).blur(8).toBuffer();

    const sharpScore = await computeSharpnessScore(sharpImage);
    const blurredScore = await computeSharpnessScore(blurredImage);

    expect(sharpScore).toBeGreaterThan(blurredScore);
  });

  it('returns near-zero for a flat, textureless image', async () => {
    const flat = await sharp({ create: { width: 200, height: 200, channels: 3, background: { r: 128, g: 128, b: 128 } } })
      .png()
      .toBuffer();

    const score = await computeSharpnessScore(flat);
    expect(score).toBeLessThan(1);
  });
});
