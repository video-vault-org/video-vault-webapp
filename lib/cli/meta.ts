import { access } from 'node:fs/promises';
import { z } from 'zod';
import { ask } from './prompt';
import { loadConfig, saveConfig } from '@/meta';
import { DEFAULT_META_CONFIG, MetaConfig, MetaField, MetaSort, fieldKeySchema, fieldSchema, fieldTypes } from '@/meta/config/MetaConfig';

const typeChoices = [
  { title: 'Text', value: 'text' },
  { title: 'Number', value: 'number' },
  { title: 'Yes/no', value: 'boolean' },
  { title: 'Date', value: 'date' },
  { title: 'Date and time', value: 'datetime' },
  { title: 'Text (multiple values)', value: 'text[]' },
  { title: 'Number (multiple values)', value: 'number[]' },
  { title: 'Date (multiple values)', value: 'date[]' },
  { title: 'Date and time (multiple values)', value: 'datetime[]' },
  { title: 'Text dropdown (single selection)', value: 'select' },
  { title: 'Text dropdown (multiple selections)', value: 'select[]' }
];

const confirm = async function (message: string, initial: boolean): Promise<boolean> {
  return ask({ type: 'confirm', name: 'value', message, initial }, z.boolean());
};

const readFields = async function (previous: MetaField[]): Promise<MetaField[]> {
  const count = await ask({ type: 'number', name: 'value', message: 'Number of metadata fields', initial: previous.length }, z.coerce.number().int().min(0).max(100));
  const fields: MetaField[] = [];
  for (let index = 0; index < count; index++) {
    const existing = previous[index];
    const key = await ask(
      { type: 'text', name: 'value', message: `Field ${index + 1}: key`, initial: existing?.key },
      fieldKeySchema.refine((value) => !fields.some((field) => field.key === value), 'Metadata keys must be unique')
    );
    const name = await ask({ type: 'text', name: 'value', message: `Field ${index + 1}: display name`, initial: existing?.name ?? key }, fieldSchema.shape.name);
    const initialType = existing ? `${existing.options ? 'select' : existing.type}${existing.multiple ? '[]' : ''}` : 'text';
    const choice = await ask(
      { type: 'select', name: 'value', message: `Field ${index + 1}: type`, initial: typeChoices.findIndex((item) => item.value === initialType), choices: typeChoices },
      z.string().refine((value) => typeChoices.some((item) => item.value === value), 'Unknown metadata type')
    );
    const dropdown = choice.startsWith('select');
    const type = z.enum(fieldTypes).parse(dropdown ? 'text' : choice.replace('[]', ''));
    const required = await confirm(`Field ${index + 1}: required?`, existing?.required ?? false);
    const showInDetails = await confirm(`Field ${index + 1}: show in details?`, existing?.showInDetails ?? true);
    const useAsFilter = await confirm(`Field ${index + 1}: use as a filter?`, existing?.useAsFilter ?? false);
    const field: MetaField = { key, name, type, multiple: choice.endsWith('[]'), required, showInDetails, useAsFilter };
    if (dropdown) {
      const count = await ask({ type: 'number', name: 'value', message: `Field ${index + 1}: number of options`, initial: existing?.options?.length ?? 1 }, z.coerce.number().int().min(1).max(100));
      const options: string[] = [];
      for (let option = 0; option < count; option++) {
        options.push(
          await ask(
            { type: 'text', name: 'value', message: `Field ${index + 1}: option ${option + 1}`, initial: existing?.options?.[option] },
            fieldSchema.shape.options.unwrap().element.refine((value) => !options.includes(value), 'Dropdown options must be unique')
          )
        );
      }
      field.options = options;
    }
    fields.push(field);
  }
  return fields;
};

const sortId = function (sort: MetaSort): string {
  return sort.source === 'meta' ? `meta:${sort.key}` : sort.source;
};

const readSorting = async function (fields: MetaField[], previous: MetaSort[]): Promise<MetaSort[]> {
  const remaining: { title: string; value: string; sort: MetaSort }[] = [
    { title: 'Title', value: 'title', sort: { source: 'title', direction: 'asc' } },
    { title: 'Recorded', value: 'recorded', sort: { source: 'recorded', direction: 'desc' } },
    ...fields.map((field) => ({ title: `${field.name} (${field.key})`, value: `meta:${field.key}`, sort: { source: 'meta' as const, key: field.key, direction: 'asc' as const } }))
  ];
  const prior = previous.filter((sort) => remaining.some((item) => item.value === sortId(sort)));
  const sorting: MetaSort[] = [];
  while (remaining.length > 0) {
    const initial = prior[sorting.length] ? remaining.findIndex((item) => item.value === sortId(prior[sorting.length])) : -1;
    const selected = await ask(
      {
        type: 'select',
        name: 'value',
        message: `Sort priority ${sorting.length + 1}`,
        initial: initial < 0 ? remaining.length : initial,
        choices: [...remaining.map(({ title, value }) => ({ title, value })), { title: 'No more', value: 'no-more' }]
      },
      z.string().refine((value) => value === 'no-more' || remaining.some((item) => item.value === value), 'Unknown or already selected sort field')
    );
    if (selected === 'no-more') break;
    const item = remaining.splice(
      remaining.findIndex((candidate) => candidate.value === selected),
      1
    )[0];
    const previousRule = prior.find((sort) => sortId(sort) === selected);
    const direction = await ask(
      {
        type: 'select',
        name: 'value',
        message: `Sort direction: ${item.title}`,
        initial: (previousRule?.direction ?? item.sort.direction) === 'desc' ? 1 : 0,
        choices: [
          { title: 'Ascending', value: 'asc' },
          { title: 'Descending', value: 'desc' }
        ]
      },
      z.enum(['asc', 'desc'])
    );
    sorting.push({ ...item.sort, direction });
  }
  return sorting;
};

/**
 * Configures the future frontend's recording-date presentation/filter, metadata fields and ordered sorting rules.
 * Existing files require confirmation before any settings are loaded or prompted. Empty answers retain defaults.
 * Each field has a stable key, a display name, a scalar type, multiplicity and required/details/filter flags.
 * Sort fields are offered once, in priority order, with an individual direction; "No more" ends selection.
 * Dropdown text fields prompt for their options after the other field attributes. Other multiple values remain free arrays.
 * @throws If cancelled, invalid, unreadable or saving fails. Nothing is written until all answers are valid.
 */
const initializeMetaConfig = async function (): Promise<void> {
  let exists = true;
  try {
    await access('./conf/meta.json');
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
    exists = false;
  }
  if (exists && !(await confirm('Metadata configuration already exists. Reconfigure?', false))) return;
  const previous = (await loadConfig()) ?? DEFAULT_META_CONFIG;
  const withTime = await confirm('Recorded: include time?', previous.recorded.withTime);
  const useAsFilter = await confirm('Recorded: use as a filter?', previous.recorded.useAsFilter);
  const fields = await readFields(previous.fields);
  const sorting = await readSorting(fields, previous.sorting);
  const config: MetaConfig = { recorded: { withTime, useAsFilter }, fields, sorting };
  await saveConfig(config);
};

export { initializeMetaConfig };
