let counter = 0;

export const v4 = jest.fn(() => `test-uuid-${++counter}`);
