import prompts from 'prompts';
import { initializeFrontendConfig } from '@/cli/frontend';
import { listImageSets, loadConfig, saveConfig } from '@/images';

jest.mock('prompts', () => jest.fn());

jest.mock('@/images', () => ({ listImageSets: jest.fn(), loadConfig: jest.fn(), saveConfig: jest.fn() }));

describe('frontend image selection CLI', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(listImageSets).mockResolvedValue(['default', 'fm']);
    jest.mocked(loadConfig).mockResolvedValue(null);
    jest.mocked(saveConfig).mockResolvedValue(undefined);
    jest.mocked(prompts).mockResolvedValue({ value: 'default' });
  });

  test('offers all complete prefixes and saves the selection', async () => {
    jest.mocked(prompts).mockResolvedValueOnce({ value: 'fm' });
    await initializeFrontendConfig();
    expect(prompts).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'select',
        initial: 0,
        choices: [
          { title: 'default', value: 'default' },
          { title: 'fm', value: 'fm' }
        ]
      }),
      expect.anything()
    );
    expect(saveConfig).toHaveBeenCalledWith({ prefix: 'fm' });
  });

  test('rejects an invalid empty select response', async () => {
    jest.mocked(prompts).mockResolvedValueOnce({ value: '' });
    // Select prompts return the selected value, while an omitted response remains an invalid selection.
    await expect(initializeFrontendConfig()).rejects.toThrow();
    expect(saveConfig).not.toHaveBeenCalled();
  });

  test('preselects existing settings and confirms before overwriting', async () => {
    jest.mocked(loadConfig).mockResolvedValueOnce({ prefix: 'fm' });
    jest.mocked(prompts).mockResolvedValueOnce({ value: 'fm' }).mockResolvedValueOnce({ value: true });
    await initializeFrontendConfig();
    expect(jest.mocked(prompts).mock.calls[0][0]).toMatchObject({ initial: 1 });
    expect(jest.mocked(prompts).mock.calls[1][0]).toMatchObject({ type: 'confirm', initial: false });
    expect(saveConfig).toHaveBeenCalledWith({ prefix: 'fm' });
  });

  test('can replace a no longer available configured set', async () => {
    jest.mocked(loadConfig).mockResolvedValueOnce({ prefix: 'removed' });
    jest.mocked(prompts).mockResolvedValueOnce({ value: 'default' }).mockResolvedValueOnce({ value: true });
    await initializeFrontendConfig();
    expect(jest.mocked(prompts).mock.calls[0][0]).toMatchObject({ initial: 0 });
    expect(saveConfig).toHaveBeenCalledWith({ prefix: 'default' });
  });

  test.each([false, undefined])('does not overwrite an existing file without confirmation (%j)', async (value) => {
    jest.mocked(loadConfig).mockResolvedValueOnce({ prefix: 'default' });
    jest.mocked(prompts).mockResolvedValueOnce({ value: 'fm' }).mockResolvedValueOnce({ value });
    await expect(initializeFrontendConfig()).rejects.toThrow('replacement declined');
    expect(saveConfig).not.toHaveBeenCalled();
  });

  test('reports an empty image directory before prompting or saving', async () => {
    jest.mocked(listImageSets).mockResolvedValueOnce([]);
    await expect(initializeFrontendConfig()).rejects.toThrow('No complete image sets');
    expect(prompts).not.toHaveBeenCalled();
    expect(saveConfig).not.toHaveBeenCalled();
  });

  test('rejects values outside the offered sets', async () => {
    jest.mocked(prompts).mockResolvedValueOnce({ value: '../escape' });
    await expect(initializeFrontendConfig()).rejects.toThrow();
    expect(saveConfig).not.toHaveBeenCalled();
  });

  test('cancellation does not save any configuration', async () => {
    jest.mocked(prompts).mockImplementationOnce(async (question, options) => {
      options?.onCancel?.(question as prompts.PromptObject, {});
      return {};
    });
    await expect(initializeFrontendConfig()).rejects.toThrow('cancelled');
    expect(saveConfig).not.toHaveBeenCalled();
  });

  test.each(['list', 'load', 'save', 'prompt'] as const)('propagates %s failures', async (step) => {
    const error = new Error('Failure');
    if (step === 'list') jest.mocked(listImageSets).mockRejectedValueOnce(error);
    if (step === 'load') jest.mocked(loadConfig).mockRejectedValueOnce(error);
    if (step === 'save') jest.mocked(saveConfig).mockRejectedValueOnce(error);
    if (step === 'prompt') jest.mocked(prompts).mockRejectedValueOnce(error);
    await expect(initializeFrontendConfig()).rejects.toBe(error);
  });
});
