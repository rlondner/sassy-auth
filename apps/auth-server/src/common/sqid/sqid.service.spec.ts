import { Test } from '@nestjs/testing';
import { SqidService } from './sqid.service';

describe('SqidService', () => {
  let service: SqidService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [SqidService],
    }).compile();
    service = module.get(SqidService);
  });

  it('encodes a positive integer to a non-empty string', () => {
    const encoded = service.encode(1);
    expect(typeof encoded).toBe('string');
    expect(encoded.length).toBeGreaterThan(0);
  });

  it('decodes back to the original integer', () => {
    const id = 42;
    const encoded = service.encode(id);
    expect(service.decode(encoded)).toBe(id);
  });

  it('produces different values for different ids', () => {
    expect(service.encode(1)).not.toBe(service.encode(2));
  });

  it('is deterministic — same input always produces same output', () => {
    expect(service.encode(100)).toBe(service.encode(100));
  });

  it('throws when decoding an invalid sqid', () => {
    expect(() => service.decode('!!!invalid!!!')).toThrow();
  });
});
