import { validateSync } from 'class-validator';
import { IsOptional } from 'class-validator';
import { IsAppFavicon } from './is-app-favicon.decorator';

class Fixture {
  @IsOptional()
  @IsAppFavicon()
  favicon?: string | null;
}

function makeWith(favicon: unknown): Fixture {
  const f = new Fixture();
  // @ts-expect-error test assigns arbitrary values
  f.favicon = favicon;
  return f;
}

// 1x1 transparent PNG, well under the 250KB cap.
const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

describe('IsAppFavicon', () => {
  it('passes for a small valid PNG data URI', () => {
    expect(validateSync(makeWith(TINY_PNG))).toHaveLength(0);
  });

  it('passes when omitted (optional)', () => {
    expect(validateSync(makeWith(undefined))).toHaveLength(0);
  });

  it('passes when explicitly null', () => {
    expect(validateSync(makeWith(null))).toHaveLength(0);
  });

  it('fails for a non-data-URI string', () => {
    const errs = validateSync(makeWith('not-a-data-uri'));
    expect(errs).toHaveLength(1);
    expect(errs[0].constraints?.isAppFavicon).toBeDefined();
  });

  it('fails for a disallowed mime type', () => {
    const errs = validateSync(makeWith('data:image/gif;base64,R0lGODlh'));
    expect(errs).toHaveLength(1);
  });

  it('fails for a payload over the size cap', () => {
    // 350KB of base64 chars decodes to ~262.5KB, over the 256KB cap.
    const oversized = 'data:image/png;base64,' + 'A'.repeat(350000);
    const errs = validateSync(makeWith(oversized));
    expect(errs).toHaveLength(1);
  });
});
