import { describe, it, expect, vi, beforeEach } from 'vitest';

// מוק ל-S3Client.send() - lib/r2.ts יוצר את ה-client ברמת המודול, אז המוק
// חייב להיות מוגדר (hoisted) לפני ה-import. הפקודות עצמן (DeleteObjectsCommand
// וכו') נשארות אמיתיות, כך שאפשר לבדוק את ה-input שנשלח.
const { sendMock } = vi.hoisted(() => {
  process.env.R2_BUCKET_NAME = 'test-bucket';
  process.env.R2_ACCOUNT_ID = 'test-account';
  process.env.R2_ACCESS_KEY_ID = 'test-key';
  process.env.R2_SECRET_ACCESS_KEY = 'test-secret';
  return { sendMock: vi.fn() };
});

vi.mock('@aws-sdk/client-s3', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aws-sdk/client-s3')>();
  class MockS3Client {
    send = sendMock;
  }
  return { ...actual, S3Client: MockS3Client };
});

import { DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { deleteObjects, listAllKeys } from './r2';

const makeKeys = (n: number) => Array.from({ length: n }, (_, i) => `gallery-1/photo-${i}.jpg`);

beforeEach(() => {
  sendMock.mockReset();
});

describe('deleteObjects', () => {
  it('does not call S3 at all for an empty key list', async () => {
    await deleteObjects([]);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('sends a single request for exactly 1000 keys', async () => {
    sendMock.mockResolvedValue({});
    await deleteObjects(makeKeys(1000));

    expect(sendMock).toHaveBeenCalledTimes(1);
    const cmd = sendMock.mock.calls[0][0];
    expect(cmd).toBeInstanceOf(DeleteObjectsCommand);
    expect(cmd.input.Bucket).toBe('test-bucket');
    expect(cmd.input.Delete.Objects).toHaveLength(1000);
  });

  it('splits 2500 keys into chunks of 1000, 1000, 500 covering every key exactly once, in order', async () => {
    sendMock.mockResolvedValue({});
    const keys = makeKeys(2500);
    await deleteObjects(keys);

    expect(sendMock).toHaveBeenCalledTimes(3);
    const chunks: string[][] = sendMock.mock.calls.map(([cmd]) => {
      expect(cmd).toBeInstanceOf(DeleteObjectsCommand);
      return cmd.input.Delete.Objects.map((o: { Key: string }) => o.Key);
    });
    expect(chunks.map((c) => c.length)).toEqual([1000, 1000, 500]);
    expect(chunks.flat()).toEqual(keys);
  });

  it('propagates an S3 error instead of silently swallowing it', async () => {
    sendMock.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('boom'));
    await expect(deleteObjects(makeKeys(1500))).rejects.toThrow('boom');
    expect(sendMock).toHaveBeenCalledTimes(2);
  });
});

describe('listAllKeys', () => {
  it('follows ContinuationToken across pages and concatenates all objects', async () => {
    sendMock
      .mockResolvedValueOnce({
        Contents: [{ Key: 'g/a.jpg', Size: 10 }, { Key: 'g/b.jpg', Size: 20 }],
        IsTruncated: true,
        NextContinuationToken: 'token-1',
      })
      .mockResolvedValueOnce({
        Contents: [{ Key: 'g/thumbs/a.jpg', Size: 5 }],
        IsTruncated: true,
        NextContinuationToken: 'token-2',
      })
      .mockResolvedValueOnce({
        Contents: [{ Key: 'g/final/a.jpg' }], // בלי Size -> 0
        IsTruncated: false,
      });

    const result = await listAllKeys('g/');

    expect(result).toEqual([
      { key: 'g/a.jpg', size: 10 },
      { key: 'g/b.jpg', size: 20 },
      { key: 'g/thumbs/a.jpg', size: 5 },
      { key: 'g/final/a.jpg', size: 0 },
    ]);
    expect(sendMock).toHaveBeenCalledTimes(3);
    const inputs = sendMock.mock.calls.map(([cmd]) => {
      expect(cmd).toBeInstanceOf(ListObjectsV2Command);
      return cmd.input;
    });
    expect(inputs.map((i) => i.Prefix)).toEqual(['g/', 'g/', 'g/']);
    expect(inputs.map((i) => i.Bucket)).toEqual(['test-bucket', 'test-bucket', 'test-bucket']);
    expect(inputs.map((i) => i.ContinuationToken)).toEqual([undefined, 'token-1', 'token-2']);
  });

  it('stops after one request when the first page is not truncated, and handles missing Contents', async () => {
    sendMock.mockResolvedValueOnce({ IsTruncated: false });
    expect(await listAllKeys('empty/')).toEqual([]);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('skips entries without a Key', async () => {
    sendMock.mockResolvedValueOnce({ Contents: [{ Size: 3 }, { Key: 'k', Size: 1 }], IsTruncated: false });
    expect(await listAllKeys()).toEqual([{ key: 'k', size: 1 }]);
  });
});
