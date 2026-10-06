import { describe, it, expect } from 'vitest';
import { googleMapsUrl, wazeUrl } from './navLinks';

describe('navLinks', () => {
  it('Google Maps מקודד', () => {
    expect(googleMapsUrl(' פארק הירקון, תל אביב ')).toBe(
      `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent('פארק הירקון, תל אביב')}`
    );
  });
  it('Waze מקודד', () => {
    expect(wazeUrl('חוף גורדון')).toBe(`https://waze.com/ul?q=${encodeURIComponent('חוף גורדון')}&navigate=yes`);
  });
});
