let counter = 0;

export const v4 = jest.fn(
  () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`,
);
