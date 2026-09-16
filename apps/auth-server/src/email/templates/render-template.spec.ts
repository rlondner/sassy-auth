import { renderTemplate } from '@sassy-auth/types';

describe('renderTemplate', () => {
  it('substitutes known tokens', () => {
    expect(renderTemplate('Hi {{firstName}}, welcome to {{appName}}', { firstName: 'Jane', appName: 'Vibecast' }))
      .toBe('Hi Jane, welcome to Vibecast');
  });

  it('leaves unknown tokens untouched', () => {
    expect(renderTemplate('Hi {{firstName}}, {{unknown}}', { firstName: 'Jane' }))
      .toBe('Hi Jane, {{unknown}}');
  });

  it('substitutes a repeated token every time it appears', () => {
    expect(renderTemplate('{{appName}} — {{appName}}', { appName: 'Vibecast' }))
      .toBe('Vibecast — Vibecast');
  });

  it('returns the template unchanged when it has no tokens', () => {
    expect(renderTemplate('plain text', {})).toBe('plain text');
  });

  it('does not substitute Object.prototype members for unknown tokens', () => {
    expect(renderTemplate('{{toString}} {{constructor}} {{hasOwnProperty}}', {}))
      .toBe('{{toString}} {{constructor}} {{hasOwnProperty}}');
  });

  it('returns an empty string unchanged', () => {
    expect(renderTemplate('', { firstName: 'Jane' })).toBe('');
  });

  it('does not match a token with whitespace inside the braces', () => {
    expect(renderTemplate('Hi {{ firstName }}', { firstName: 'Jane' })).toBe('Hi {{ firstName }}');
  });
});
