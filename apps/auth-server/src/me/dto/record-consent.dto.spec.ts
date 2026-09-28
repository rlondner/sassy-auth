import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { GetConsentQueryDto, RecordConsentDto } from './record-consent.dto';

describe('RecordConsentDto', () => {
  it('accepts a well-formed body', () => {
    const dto = plainToInstance(RecordConsentDto, { appPublicId: 'sq_1', accepted: ['terms', 'gdpr'] });
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('accepts an empty accepted array', () => {
    const dto = plainToInstance(RecordConsentDto, { appPublicId: 'sq_1', accepted: [] });
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('rejects a missing appPublicId', () => {
    const dto = plainToInstance(RecordConsentDto, { accepted: ['terms'] });
    const errors = validateSync(dto).filter((e) => e.property === 'appPublicId');
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects an empty-string appPublicId', () => {
    const dto = plainToInstance(RecordConsentDto, { appPublicId: '', accepted: ['terms'] });
    const errors = validateSync(dto).filter((e) => e.property === 'appPublicId');
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a non-array accepted', () => {
    const dto = plainToInstance(RecordConsentDto, { appPublicId: 'sq_1', accepted: 'terms' });
    const errors = validateSync(dto).filter((e) => e.property === 'accepted');
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects an accepted array containing an unknown document type', () => {
    const dto = plainToInstance(RecordConsentDto, { appPublicId: 'sq_1', accepted: ['terms', 'not-a-doc-type'] });
    const errors = validateSync(dto).filter((e) => e.property === 'accepted');
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('GetConsentQueryDto', () => {
  it('accepts a well-formed query', () => {
    const dto = plainToInstance(GetConsentQueryDto, { appPublicId: 'sq_1' });
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('rejects a missing appPublicId', () => {
    const dto = plainToInstance(GetConsentQueryDto, {});
    const errors = validateSync(dto).filter((e) => e.property === 'appPublicId');
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects an empty-string appPublicId', () => {
    const dto = plainToInstance(GetConsentQueryDto, { appPublicId: '' });
    const errors = validateSync(dto).filter((e) => e.property === 'appPublicId');
    expect(errors.length).toBeGreaterThan(0);
  });
});
