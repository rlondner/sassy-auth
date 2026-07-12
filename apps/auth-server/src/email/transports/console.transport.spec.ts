import { ConsoleTransport } from './console.transport';

describe('ConsoleTransport', () => {
  it('has name "console" and logs recipient + subject without throwing', async () => {
    const info = jest.fn();
    const t = new ConsoleTransport({ info });
    expect(t.name).toBe('console');
    await t.send({ from: 'no-reply@x', to: 'a@b.co', subject: 'Hi', html: '<p>h</p>', text: 'h' });
    expect(info).toHaveBeenCalledWith(expect.stringContaining('a@b.co'));
  });
});
