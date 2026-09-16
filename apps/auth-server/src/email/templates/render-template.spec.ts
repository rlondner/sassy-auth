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
});
