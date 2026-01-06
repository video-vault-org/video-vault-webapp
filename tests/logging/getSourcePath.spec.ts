import { getSourcePath } from '@/logging/getSourcePath';

describe('getSourcePath', (): void => {
  test('returns the path to the file which called the function where it was called in.', async (): Promise<void> => {
    const sourcePath = getSourcePath();

    // utils.js calls the jest test functions.
    expect(sourcePath).toMatch(/^.*node_modules[\/\\]jest-circus[\/\\]build[\/\\]utils.js$/iu);
  });
});
