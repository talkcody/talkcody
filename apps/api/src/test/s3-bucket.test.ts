import { describe, expect, it } from 'bun:test';
import { createHash, createHmac } from 'node:crypto';
import { parseListObjectsV2Xml } from '../services/s3-bucket';
import { signAwsRequest } from '../services/s3-sigv4';

describe('S3Bucket helpers', () => {
  it('parses ListObjectsV2 XML (keys, truncation, prefixes)', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Name>my-bucket</Name>
  <Prefix>users/</Prefix>
  <KeyCount>2</KeyCount>
  <MaxKeys>1000</MaxKeys>
  <IsTruncated>true</IsTruncated>
  <NextContinuationToken>abc123</NextContinuationToken>
  <Contents>
    <Key>users/u1/avatar.png</Key>
    <LastModified>2020-01-01T00:00:00.000Z</LastModified>
    <ETag>&quot;etag1&quot;</ETag>
    <Size>123</Size>
  </Contents>
  <Contents>
    <Key>users/u2/avatar.webp</Key>
    <LastModified>2020-01-02T00:00:00.000Z</LastModified>
    <ETag>&quot;etag2&quot;</ETag>
    <Size>456</Size>
  </Contents>
  <CommonPrefixes>
    <Prefix>users/u1/</Prefix>
  </CommonPrefixes>
</ListBucketResult>`;

    const parsed = parseListObjectsV2Xml(xml);
    expect(parsed.truncated).toBe(true);
    expect(parsed.nextContinuationToken).toBe('abc123');
    expect(parsed.commonPrefixes).toEqual(['users/u1/']);
    expect(parsed.keys.map((k) => k.key)).toEqual(['users/u1/avatar.png', 'users/u2/avatar.webp']);
    expect(parsed.keys.map((k) => k.size)).toEqual([123, 456]);
    expect(parsed.keys.map((k) => k.etag)).toEqual(['etag1', 'etag2']);
  });

  it('creates a SigV4 authorization header for S3', async () => {
    const now = new Date('2020-01-02T03:04:05Z');
    const url = new URL('https://example.com/test.txt?foo=bar&baz=qux');

    const accessKeyId = 'AKIDEXAMPLE';
    const secretAccessKey = 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY';
    const region = 'us-east-1';
    const service = 's3';

    const signed = await signAwsRequest({
      method: 'GET',
      url,
      config: {
        region,
        service,
        credentials: { accessKeyId, secretAccessKey },
        now,
      },
    });

    expect(signed.amzDate).toBe('20200102T030405Z');
    expect(signed.payloadHash).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );

    const expectedCanonicalRequest = [
      'GET',
      '/test.txt',
      'baz=qux&foo=bar',
      'host:example.com\nx-amz-content-sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855\nx-amz-date:20200102T030405Z\n',
      'host;x-amz-content-sha256;x-amz-date',
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    ].join('\n');

    expect(signed.canonicalRequest).toBe(expectedCanonicalRequest);

    const dateStamp = '20200102';
    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
    const canonicalRequestHash = createHash('sha256')
      .update(expectedCanonicalRequest, 'utf8')
      .digest('hex');
    const stringToSign = `AWS4-HMAC-SHA256\n${signed.amzDate}\n${credentialScope}\n${canonicalRequestHash}`;

    const hmac = (key: Buffer | string, data: string) =>
      createHmac('sha256', key).update(data, 'utf8').digest();

    const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
    const kRegion = hmac(kDate, region);
    const kService = hmac(kRegion, service);
    const kSigning = hmac(kService, 'aws4_request');
    const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

    const expectedAuth =
      `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, ` +
      `SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=${signature}`;

    expect(signed.headers.get('Authorization')).toBe(expectedAuth);
  });
});

