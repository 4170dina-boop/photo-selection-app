import { describe, it, expect } from 'vitest';
import {
  evenlySpacedIndices,
  pickCollagePhotos,
  collageCells,
  collagePhotoArea,
  assignPhotosToCells,
  coverCrop,
  collageFileName,
  COLLAGE_GAP,
  COLLAGE_WIDTH,
  COLLAGE_HEIGHT,
  type Rect,
} from './collage';

const ids = (n: number, p = 's') => Array.from({ length: n }, (_, i) => `${p}${i}`);

function overlaps(a: Rect, b: Rect) {
  const eps = 1e-6;
  return a.x < b.x + b.w - eps && b.x < a.x + a.w - eps && a.y < b.y + b.h - eps && b.y < a.y + a.h - eps;
}

function inside(r: Rect, area: Rect) {
  const eps = 1e-6;
  return r.x >= area.x - eps && r.y >= area.y - eps && r.x + r.w <= area.x + area.w + eps && r.y + r.h <= area.y + area.h + eps;
}

describe('evenlySpacedIndices', () => {
  it('כולל ראשונה ואחרונה ומפזר באמצע', () => {
    expect(evenlySpacedIndices(10, 4)).toEqual([0, 3, 6, 9]);
    expect(evenlySpacedIndices(5, 3)).toEqual([0, 2, 4]);
  });
  it('k>=n מחזיר הכל', () => {
    expect(evenlySpacedIndices(3, 6)).toEqual([0, 1, 2]);
  });
  it('מקרי קצה', () => {
    expect(evenlySpacedIndices(0, 3)).toEqual([]);
    expect(evenlySpacedIndices(5, 0)).toEqual([]);
    expect(evenlySpacedIndices(5, 1)).toEqual([2]);
  });
  it('אינדקסים ייחודיים ועולים', () => {
    for (let n = 1; n < 40; n++) {
      for (let k = 1; k <= 6; k++) {
        const r = evenlySpacedIndices(n, k);
        expect(r.length).toBe(Math.min(n, k));
        for (let i = 1; i < r.length; i++) expect(r[i]).toBeGreaterThan(r[i - 1]);
      }
    }
  });
});

describe('pickCollagePhotos', () => {
  it('הרבה נבחרות בלי מתנות - 6 בפיזור שווה', () => {
    const { primary, backups } = pickCollagePhotos({ selected: ids(30), gifts: [] });
    expect(primary).toEqual(['s0', 's6', 's12', 's17', 's23', 's29']);
    expect(backups).toHaveLength(24);
    expect(backups).not.toContain('s0');
  });

  it('הרבה נבחרות + מתנות - מתנה אחת בלבד, השאר נבחרות', () => {
    const { primary } = pickCollagePhotos({ selected: ids(20), gifts: ['g0', 'g1', 'g2'] });
    expect(primary).toHaveLength(6);
    expect(primary.filter((id) => id.startsWith('g'))).toEqual(['g0']);
  });

  it('מעט נבחרות - עד 2 מתנות להשלמה', () => {
    const { primary } = pickCollagePhotos({ selected: ids(3), gifts: ['g0', 'g1', 'g2'] });
    expect(primary).toEqual(['s0', 's1', 's2', 'g0', 'g1', 'g2']);
  });

  it('משלים מ"אולי" כשאין מספיק', () => {
    const { primary } = pickCollagePhotos({ selected: ids(2), gifts: [], maybe: ids(5, 'm') });
    expect(primary).toEqual(['s0', 's1', 'm0', 'm1', 'm2', 'm3']);
  });

  it('נבחרות לפני "אולי" - לא נכנסת "אולי" כשיש מספיק נבחרות', () => {
    const { primary, backups } = pickCollagePhotos({ selected: ids(8), gifts: [], maybe: ['m0'] });
    expect(primary.some((id) => id.startsWith('m'))).toBe(false);
    expect(backups[backups.length - 1]).toBe('m0');
  });

  it('לא מכפיל תמונה שמופיעה בכמה רשימות', () => {
    const { primary, backups } = pickCollagePhotos({ selected: ['a', 'b', 'a'], gifts: ['b', 'g'], maybe: ['a'] });
    expect(primary).toEqual(['a', 'b', 'g']);
    expect(backups).toEqual([]);
  });

  it('ריק', () => {
    expect(pickCollagePhotos({ selected: [], gifts: [] })).toEqual({ primary: [], backups: [] });
  });
});

describe('collageCells', () => {
  const area = collagePhotoArea();

  it('אזור התמונות בתוך הקנבס', () => {
    expect(inside(area, { x: 0, y: 0, w: COLLAGE_WIDTH, h: COLLAGE_HEIGHT })).toBe(true);
  });

  for (const count of [1, 2, 3, 4, 5, 6]) {
    for (const portrait of [false, true]) {
      it(`${count} תאים (portrait=${portrait}) - בתוך האזור, בלי חפיפה`, () => {
        const cells = collageCells(count, area, COLLAGE_GAP, portrait);
        expect(cells).toHaveLength(count);
        for (const c of cells) {
          expect(c.w).toBeGreaterThan(0);
          expect(c.h).toBeGreaterThan(0);
          expect(inside(c, area)).toBe(true);
        }
        for (let i = 0; i < cells.length; i++) {
          for (let j = i + 1; j < cells.length; j++) expect(overlaps(cells[i], cells[j])).toBe(false);
        }
      });
    }
  }

  it('4 = 2×2 שווים', () => {
    const cells = collageCells(4, area);
    const w = cells[0].w;
    const h = cells[0].h;
    cells.forEach((c) => {
      expect(c.w).toBeCloseTo(w);
      expect(c.h).toBeCloseTo(h);
    });
    expect(new Set(cells.map((c) => Math.round(c.y))).size).toBe(2);
  });

  it('5 = אחת גדולה ברוחב מלא + 4 קטנות', () => {
    const cells = collageCells(5, area);
    expect(cells[0].w).toBeCloseTo(area.w);
    expect(cells[0].w * cells[0].h).toBeGreaterThan(cells[1].w * cells[1].h * 2);
  });

  it('6 = 2 עמודות × 3 שורות', () => {
    const cells = collageCells(6, area);
    expect(new Set(cells.map((c) => Math.round(c.x))).size).toBe(2);
    expect(new Set(cells.map((c) => Math.round(c.y))).size).toBe(3);
  });

  it('RTL - התא הראשון בשורה מימין', () => {
    const cells = collageCells(4, area);
    expect(cells[0].x).toBeGreaterThan(cells[1].x);
  });

  it('רווחים בין תאים שכנים = gap', () => {
    const cells = collageCells(4, area, 20);
    expect(cells[0].x - (cells[1].x + cells[1].w)).toBeCloseTo(20);
    expect(cells[2].y - (cells[0].y + cells[0].h)).toBeCloseTo(20);
  });
});

describe('assignPhotosToCells', () => {
  it('התמונה הכי לרוחב לתא הכי רחב', () => {
    const cells = collageCells(5, collagePhotoArea());
    // תמונה 2 היא היחידה לרוחב - צריכה לקבל את התא הגדול (0)
    const result = assignPhotosToCells(cells, [0.66, 0.75, 1.5, 0.66, 0.8]);
    expect(result[0]).toBe(2);
    expect([...result].sort()).toEqual([0, 1, 2, 3, 4]);
  });

  it('תמורה תקינה גם כשהכל זהה (שומר סדר)', () => {
    const cells = collageCells(4, collagePhotoArea());
    expect(assignPhotosToCells(cells, [1, 1, 1, 1])).toEqual([0, 1, 2, 3]);
  });
});

describe('coverCrop', () => {
  it('תמונה רחבה לתא ריבועי - חותך מהצדדים, ממורכז', () => {
    expect(coverCrop(2000, 1000, 500, 500)).toEqual({ x: 500, y: 0, w: 1000, h: 1000 });
  });

  it('תמונה גבוהה לתא רחב - חותך למעלה/למטה, מעט מעל המרכז', () => {
    const r = coverCrop(1000, 2000, 1000, 500);
    expect(r.w).toBe(1000);
    expect(r.h).toBe(500);
    expect(r.y).toBeCloseTo(600); // (2000-500)*0.4
  });

  it('שומר על יחס התא ונשאר בתוך התמונה', () => {
    for (const [sw, sh, dw, dh] of [[1333, 2000, 300, 420], [2000, 1333, 984, 400], [800, 800, 10, 30]]) {
      const r = coverCrop(sw, sh, dw, dh);
      expect(r.w / r.h).toBeCloseTo(dw / dh);
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(sw + 1e-6);
      expect(r.y + r.h).toBeLessThanOrEqual(sh + 1e-6);
    }
  });

  it('מידות לא תקינות לא זורקות', () => {
    expect(coverCrop(0, 0, 100, 100)).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });
});

describe('collageFileName', () => {
  it('שם רגיל', () => {
    expect(collageFileName('רחל כהן')).toBe('הקולאז-שלי-רחל-כהן.jpg');
  });
  it('מסיר תווים אסורים וגרשיים', () => {
    expect(collageFileName('a/b\\c:d*e?"f<g>h|i\'j')).toBe('הקולאז-שלי-abcdefghij.jpg');
    expect(collageFileName('בר מצוה – ר׳ יוסי')).toBe('הקולאז-שלי-בר-מצוה-–-ר-יוסי.jpg');
  });
  it('ריק / רק תווים אסורים', () => {
    expect(collageFileName('')).toBe('הקולאז-שלי.jpg');
    expect(collageFileName(null)).toBe('הקולאז-שלי.jpg');
    expect(collageFileName('  ///  ')).toBe('הקולאז-שלי.jpg');
  });
  it('מקצר שמות ארוכים', () => {
    expect(collageFileName('א'.repeat(200)).length).toBeLessThanOrEqual('הקולאז-שלי-'.length + 60 + 4);
  });
});
