import { access } from 'node:fs/promises';
import prompts from 'prompts';
import { initializeMetaConfig } from '@/cli/meta';
import { loadConfig, saveConfig } from '@/meta';
import { DEFAULT_META_CONFIG, MetaConfig } from '@/meta/config/MetaConfig';

jest.mock('prompts', () => jest.fn());

jest.mock('node:fs/promises', () => ({ access: jest.fn() }));

jest.mock('@/meta', () => ({ loadConfig: jest.fn(), saveConfig: jest.fn() }));

describe('metadata configuration CLI', () => {
  let answers: unknown[];
  let questions: prompts.PromptObject[];

  beforeEach(() => {
    jest.resetAllMocks();
    answers = [];
    questions = [];
    jest.mocked(access).mockRejectedValue(Object.assign(new Error('Missing'), { code: 'ENOENT' }));
    jest.mocked(loadConfig).mockResolvedValue(null);
    jest.mocked(saveConfig).mockResolvedValue(undefined);

    jest.mocked(prompts).mockImplementation(async (question) => {
      const q = question as prompts.PromptObject;
      questions.push(q);
      if (answers.length === 0) throw new Error(`Unexpected question: ${q.message}`);
      const answer = answers.shift();
      if (answer !== undefined) return { value: answer };
      if (q.type === 'select') return { value: (q.choices as prompts.Choice[])[q.initial as number].value };
      return { value: q.initial };
    });
  });

  test('retains all agreed defaults on empty input and saves only after the last answer', async () => {
    answers = Array(7).fill(undefined);
    await initializeMetaConfig();
    expect(saveConfig).toHaveBeenCalledWith(DEFAULT_META_CONFIG);
    expect(jest.mocked(saveConfig).mock.invocationCallOrder[0]).toBeGreaterThan(jest.mocked(prompts).mock.invocationCallOrder.at(-1)!);
    expect(answers).toHaveLength(0);
  });

  test('can disable the date filter, enable time and end sorting immediately with No more', async () => {
    answers = [true, false, 0, 'no-more'];
    await initializeMetaConfig();
    expect(saveConfig).toHaveBeenCalledWith({ recorded: { withTime: true, useAsFilter: false }, fields: [], sorting: [] });
  });

  test.each(['text', 'number', 'boolean', 'date', 'datetime', 'text[]', 'number[]', 'date[]', 'datetime[]'])('collects a %s field with separate key/name and individual flags', async (choice) => {
    answers = [false, true, 1, 'customField', 'Anzeigename', 'Display name', choice, true, false, false, 'no-more'];
    await initializeMetaConfig();
    expect(saveConfig).toHaveBeenCalledWith({
      recorded: DEFAULT_META_CONFIG.recorded,
      fields: [{ key: 'customField', name: { de: 'Anzeigename', en: 'Display name' }, type: choice.replace('[]', ''), multiple: choice.endsWith('[]'), required: true, showInDetails: false, useAsFilter: false }],
      sorting: []
    });
    expect(answers).toHaveLength(0);
    const messages = questions.map((question) => question.message);
    expect(messages.indexOf('Field 1: German display name')).toBeLessThan(messages.indexOf('Field 1: English display name'));
    expect(messages.indexOf('Field 1: English display name')).toBeLessThan(messages.indexOf('Field 1: type'));
  });

  test('stores title followed by two metadata fields in the selected priority and removes selected choices', async () => {
    answers = [false, true, 2, 'camera', 'Kamera', 'Camera', 'text', false, true, true, 'years', 'Jahre', 'Years', 'number[]', false, false, false, 'title', 'asc', 'meta:camera', 'desc', 'meta:years', 'asc', 'no-more'];
    await initializeMetaConfig();
    expect(jest.mocked(saveConfig).mock.calls[0][0].sorting).toEqual([
      { source: 'title', direction: 'asc' },
      { source: 'meta', key: 'camera', direction: 'desc' },
      { source: 'meta', key: 'years', direction: 'asc' }
    ]);
    const selections = questions.filter((q) => String(q.message).startsWith('Sort priority'));
    const values = selections.map((q) => (q.choices as prompts.Choice[]).map((choice) => choice.value));
    expect(values).toEqual([
      ['title', 'recorded', 'meta:camera', 'meta:years', 'no-more'],
      ['recorded', 'meta:camera', 'meta:years', 'no-more'],
      ['recorded', 'meta:years', 'no-more'],
      ['recorded', 'no-more']
    ]);
    expect(answers).toHaveLength(0);
  });

  test.each(['select', 'select[]'])('collects %s options after the other field attributes', async (choice) => {
    answers = [false, true, 1, 'place', 'Ort', 'Place', choice, true, true, true, 2, 'Berlin', 'Paris', 'no-more'];
    await initializeMetaConfig();
    expect(jest.mocked(saveConfig).mock.calls[0][0].fields).toEqual([
      { key: 'place', name: { de: 'Ort', en: 'Place' }, type: 'text', multiple: choice.endsWith('[]'), required: true, showInDetails: true, useAsFilter: true, options: ['Berlin', 'Paris'] }
    ]);
    const messages = questions.map((question) => question.message);
    expect(messages.indexOf('Field 1: number of options')).toBeGreaterThan(messages.indexOf('Field 1: use as a filter?'));
    expect(answers).toHaveLength(0);
  });

  test('preserves existing dropdown options and the selection type on empty answers', async () => {
    const existing: MetaConfig = {
      ...DEFAULT_META_CONFIG,
      fields: [{ key: 'place', name: { de: 'Ort', en: 'Place' }, type: 'text', multiple: true, required: false, showInDetails: true, useAsFilter: true, options: ['Berlin', 'Paris'] }],
      sorting: []
    };
    jest.mocked(access).mockResolvedValue(undefined);
    jest.mocked(loadConfig).mockResolvedValue(existing);
    answers = [true, ...Array(14).fill(undefined)];
    await initializeMetaConfig();
    expect(saveConfig).toHaveBeenCalledWith(existing);
    expect(answers).toHaveLength(0);
  });

  test.each([{ options: [0] }, { options: [2, 'Berlin', ' Berlin '] }, { options: [1, '   '] }])('rejects empty or duplicate options without saving (%j)', async ({ options }) => {
    answers = [false, true, 1, 'place', 'Ort', 'Place', 'select', false, true, false, ...options];
    await expect(initializeMetaConfig()).rejects.toMatchObject({ name: 'ZodError' });
    expect(saveConfig).not.toHaveBeenCalled();
  });

  test.each([true, false, undefined])('configures a field filter independently of its details visibility (%s)', async (useAsFilter) => {
    answers = [false, true, 1, 'tags', 'Schlagwörter', 'Tags', 'text[]', false, false, useAsFilter, 'no-more'];
    await initializeMetaConfig();
    expect(jest.mocked(saveConfig).mock.calls[0][0].fields[0]).toMatchObject({ showInDetails: false, useAsFilter: useAsFilter ?? false });
    expect(questions.find((question) => question.message === 'Field 1: use as a filter?')).toMatchObject({ initial: false });
    expect(answers).toHaveLength(0);
  });

  test('prefills an existing configuration after confirmation and preserves field flags and sort directions', async () => {
    const existing: MetaConfig = {
      recorded: { withTime: true, useAsFilter: false },
      fields: [{ key: 'tags', name: { de: 'Schlagwörter', en: 'Tags' }, type: 'text', multiple: true, required: true, showInDetails: false, useAsFilter: true }],
      sorting: [
        { source: 'meta', key: 'tags', direction: 'desc' },
        { source: 'title', direction: 'asc' }
      ]
    };
    jest.mocked(access).mockResolvedValue(undefined);
    jest.mocked(loadConfig).mockResolvedValue(existing);
    answers = [true, ...Array(15).fill(undefined)];
    await initializeMetaConfig();
    expect(questions[0]).toMatchObject({ type: 'confirm', initial: false });
    expect(jest.mocked(prompts).mock.invocationCallOrder[0]).toBeLessThan(jest.mocked(loadConfig).mock.invocationCallOrder[0]);
    expect(saveConfig).toHaveBeenCalledWith(existing);
    expect(answers).toHaveLength(0);
  });

  test.each([false, undefined])('skips an existing file without reading or writing it when reconfiguration is declined (%s)', async (answer) => {
    jest.mocked(access).mockResolvedValue(undefined);
    answers = [answer];
    await initializeMetaConfig();
    expect(questions).toHaveLength(1);
    expect(loadConfig).not.toHaveBeenCalled();
    expect(saveConfig).not.toHaveBeenCalled();
  });

  test('drops references to removed fields while preserving the remaining sort defaults', async () => {
    jest.mocked(access).mockResolvedValue(undefined);
    jest.mocked(loadConfig).mockResolvedValue({
      ...DEFAULT_META_CONFIG,
      fields: [{ key: 'removed', name: { de: 'Entfernt', en: 'Removed' }, type: 'text', multiple: false, required: false, showInDetails: true, useAsFilter: true }],
      sorting: [
        { source: 'meta', key: 'removed', direction: 'desc' },
        { source: 'title', direction: 'asc' }
      ]
    });
    answers = [true, undefined, undefined, 0, undefined, undefined, 'no-more'];
    await initializeMetaConfig();
    expect(jest.mocked(saveConfig).mock.calls[0][0]).toEqual({ ...DEFAULT_META_CONFIG, fields: [], sorting: [{ source: 'title', direction: 'asc' }] });
    expect(answers).toHaveLength(0);
  });

  test.each([
    [false, true, -1],
    [false, true, 101],
    [false, true, 1, 'constructor'],
    [false, true, 1, 'has spaces'],
    [false, true, 1, 'valid', ' '],
    [false, true, 1, 'valid', 'Name', ' '],
    [false, true, 1, 'valid', 'Name', 'Name', 'boolean[]'],
    [false, true, 2, 'same', 'Gleich', 'Same', 'text', false, true, false, 'same'],
    [false, true, 0, 'meta:unknown'],
    [false, true, 0, 'title', 'sideways'],
    [false, true, 0, 'title', 'asc', 'title']
  ])('rejects invalid fields or sorting choices without saving (%#)', async (...invalid) => {
    answers = invalid;
    await expect(initializeMetaConfig()).rejects.toMatchObject({ name: 'ZodError' });
    expect(saveConfig).not.toHaveBeenCalled();
  });

  test.each(['Recorded: include time?', 'Field 1: key', 'Sort priority 1', 'Sort direction: Recorded'])('cancelling %s prevents a partial save', async (message) => {
    const implementation = jest.mocked(prompts).getMockImplementation()!;

    jest.mocked(prompts).mockImplementation(async (question, options) => {
      if ((question as prompts.PromptObject).message === message) {
        options?.onCancel?.(question as prompts.PromptObject, {});
        return {};
      }
      return implementation(question, options);
    });

    answers = [false, true, 1, 'field', 'Name', 'Name', 'text', false, true, false, 'recorded', 'desc', 'no-more'];
    await expect(initializeMetaConfig()).rejects.toThrow('cancelled');
    expect(saveConfig).not.toHaveBeenCalled();
  });

  test('rejects missing prompt answers', async () => {
    jest.mocked(prompts).mockResolvedValueOnce({});
    await expect(initializeMetaConfig()).rejects.toThrow('Missing configuration answer');
    expect(saveConfig).not.toHaveBeenCalled();
  });

  test.each(['access', 'load', 'save'] as const)('propagates %s failures', async (step) => {
    const error = new Error('Failure');
    if (step === 'access') jest.mocked(access).mockRejectedValueOnce(error);
    if (step === 'load') jest.mocked(loadConfig).mockRejectedValueOnce(error);
    if (step === 'save') jest.mocked(saveConfig).mockRejectedValueOnce(error);
    answers = [false, true, 0, 'no-more'];
    await expect(initializeMetaConfig()).rejects.toBe(error);
  });
});
