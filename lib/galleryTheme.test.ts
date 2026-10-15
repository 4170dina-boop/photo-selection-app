import { describe, expect, it } from 'vitest';
import {
  THEME_PRESETS,
  contrastRatio,
  extractLogoColors,
  galleryCssVars,
  isGalleryColors,
  textOn,
  themeWarnings,
  themesFromLogo,
} from './galleryTheme';

describe('galleryTheme', () => {
  it('validates the 4 hex colors', () => {
    expect(isGalleryColors({ bg: '#ffffff', panel: '#eeeeee', text: '#111111', accent: '#c47a72' })).toBe(true);
    expect(isGalleryColors({ bg: '#fff', panel: '#eeeeee', text: '#111111', accent: '#c47a72' })).toBe(false);
    expect(isGalleryColors(null)).toBe(false);
  });

  it('derives every CSS variable', () => {
    const vars = galleryCssVars({ bg: '#ffffff', panel: '#f0f0f0', text: '#222222', accent: '#c47a72' });
    expect(vars['--t-bg']).toBe('#ffffff');
    expect(vars['--t-text-muted']).toBe('rgba(34,34,34,0.66)');
    expect(Object.keys(vars)).toHaveLength(13);
    expect(vars['--t-gold-bright']).toBe('#c47a72');
  });

  it('picks readable text on buttons', () => {
    expect(textOn('#ffffff')).toBe('#1a1a1a');
    expect(textOn('#111111')).toBe('#ffffff');
  });

  it('warns about unreadable text', () => {
    expect(themeWarnings({ bg: '#ffffff', panel: '#f4f4f4', text: '#eeeeee', accent: '#c47a72' }).length).toBeGreaterThan(0);
  });

  it('ships presets that are all readable', () => {
    for (const preset of THEME_PRESETS) {
      expect(contrastRatio(preset.colors.text, preset.colors.bg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('extracts distinct colors and ignores transparency', () => {
    const px: number[] = [];
    for (let i = 0; i < 50; i++) px.push(200, 30, 60, 255); // אדום
    for (let i = 0; i < 30; i++) px.push(20, 20, 20, 255); // כמעט שחור
    for (let i = 0; i < 100; i++) px.push(0, 255, 0, 0); // שקוף - לא נספר
    const colors = extractLogoColors(px);
    expect(colors).toHaveLength(2);
    expect(colors[0]).toBe('#c81e3c');
  });

  it('builds readable light and dark themes from logo colors', () => {
    const themes = themesFromLogo(['#c81e3c', '#141414']);
    expect(themes).toHaveLength(2);
    for (const t of themes) {
      expect(isGalleryColors(t.colors)).toBe(true);
      expect(contrastRatio(t.colors.text, t.colors.bg)).toBeGreaterThanOrEqual(4.5);
    }
    expect(themesFromLogo([])).toEqual([]);
  });
});
