import { describe, it, expect } from 'vitest';
import { escapeCsvField, csvRow, buildCsv, attachmentContentDisposition } from './csv';

describe('escapeCsvField', () => {
  it('leaves plain values untouched', () => {
    expect(escapeCsvField('IMG_0001.jpg')).toBe('IMG_0001.jpg');
    expect(escapeCsvField('דינה כהן')).toBe('דינה כהן');
  });

  it('prefixes formula triggers with an apostrophe', () => {
    expect(escapeCsvField('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(escapeCsvField('+972501234567')).toBe("'+972501234567");
    expect(escapeCsvField('-2+3')).toBe("'-2+3");
    expect(escapeCsvField('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(escapeCsvField('\tcmd')).toBe("'\tcmd");
  });

  it('prefixes and quotes a leading CR', () => {
    expect(escapeCsvField('\r=1')).toBe(`"'\r=1"`);
  });

  it('quotes on comma, quote, LF and lone CR', () => {
    expect(escapeCsvField('a,b')).toBe('"a,b"');
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvField('line1\nline2')).toBe('"line1\nline2"');
    expect(escapeCsvField('line1\rline2')).toBe('"line1\rline2"');
  });

  it('does not touch triggers that are not at the start', () => {
    expect(escapeCsvField('a=b')).toBe('a=b');
  });

  it('handles numbers and nullish values', () => {
    expect(escapeCsvField(5)).toBe('5');
    expect(escapeCsvField(-1)).toBe('-1');
    expect(escapeCsvField(null)).toBe('');
    expect(escapeCsvField(undefined)).toBe('');
  });
});

describe('csvRow / buildCsv', () => {
  it('joins escaped fields with commas', () => {
    expect(csvRow(['a', '=b', 'c,d', 3])).toBe(`a,'=b,"c,d",3`);
  });

  it('adds a BOM and CRLF between rows', () => {
    expect(buildCsv(['h1', 'h2'], [['x', 1], ['y', 2]])).toBe('﻿h1,h2\r\nx,1\r\ny,2');
  });
});

describe('attachmentContentDisposition', () => {
  it('uses an ASCII fallback plus RFC 5987 filename* for Hebrew names', () => {
    const header = attachmentContentDisposition('selections-דינה כהן.csv', 'selections.csv');
    expect(header).toBe(
      `attachment; filename="selections.csv"; filename*=UTF-8''selections-${encodeURIComponent('דינה כהן')}.csv`
    );
  });

  it("percent-encodes characters encodeURIComponent leaves alone (' ( ) *)", () => {
    const header = attachmentContentDisposition("o'neil (1)*.csv", 'x.csv');
    expect(header).toContain("filename*=UTF-8''o%27neil%20%281%29%2A.csv");
  });

  it('sanitizes quotes and non-ASCII in the fallback', () => {
    expect(attachmentContentDisposition('a.csv', 'a"b\\ש.csv')).toMatch(/^attachment; filename="a_b__\.csv";/);
  });
});
