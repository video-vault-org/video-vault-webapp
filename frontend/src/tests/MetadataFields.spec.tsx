import { useState } from 'react';
import { expect, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MetadataFields, validateMetadata } from '../components/MetadataFields';
import { LanguageProvider } from '../lib/ui';
import { filterVideos } from '../lib/catalog';
import type { MetaField } from '../lib/types';
import { config, video } from './fixtures';

const field: MetaField = {
  key: 'place',
  name: { de: 'Ort', en: 'Place' },
  type: 'text',
  multiple: false,
  required: false,
  showInDetails: true,
  useAsFilter: true,
  options: ['Berlin', 'Paris', 'Paris suburbs']
};

test('single dropdown uses configured text options and permits clearing optional values', async () => {
  const actor = userEvent.setup(),
    onChange = vi.fn();
  render(<MetadataFields fields={[field]} value={{ place: 'Berlin' }} onChange={onChange} />);
  const select = screen.getByRole('combobox', { name: 'Ort' });
  expect(select).toHaveValue('Berlin');
  await actor.selectOptions(select, 'Paris');
  expect(onChange).toHaveBeenLastCalledWith({ place: 'Paris' });
  await actor.selectOptions(select, '');
  expect(onChange).toHaveBeenLastCalledWith({ place: '' });
});

test.each(['de', 'en'])('multiple dropdown selects and removes values without free text (%s)', async (language) => {
  localStorage.setItem('videovault.language', language);
  const actor = userEvent.setup(),
    onChange = vi.fn();

  const Form = function () {
    const [value, setValue] = useState<Record<string, unknown>>({ place: ['Berlin'] });
    return (
      <MetadataFields
        fields={[{ ...field, multiple: true }]}
        value={value}
        onChange={(next) => {
          setValue(next);
          onChange(next);
        }}
      />
    );
  };

  render(
    <LanguageProvider>
      <Form />
    </LanguageProvider>
  );
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(screen.queryByText('Ein Wert pro Zeile.')).not.toBeInTheDocument();
  await actor.click(screen.getByText('Berlin', { selector: 'summary' }));
  const group = screen.getByRole('group', { name: language === 'de' ? 'Ort' : 'Place' });
  await actor.click(within(group).getByRole('checkbox', { name: 'Paris' }));
  expect(onChange).toHaveBeenLastCalledWith({ place: ['Berlin', 'Paris'] });
  await actor.click(within(group).getByRole('checkbox', { name: 'Berlin' }));
  await actor.click(within(group).getByRole('checkbox', { name: 'Paris' }));
  expect(onChange).toHaveBeenLastCalledWith({ place: [] });
  expect(
    screen.getByText(language === 'de' ? 'Bitte auswählen' : 'Please select', { selector: 'summary' })
  ).toBeVisible();
});

test('validates configured choices and scalar/array shapes and retains required semantics', () => {
  expect(validateMetadata([field], { place: 'Paris' })).toEqual({ place: 'Paris' });
  expect(validateMetadata([field], { place: '' })).toEqual({});
  const multiple = { ...field, multiple: true, required: true };
  expect(validateMetadata([multiple], { place: ['Berlin', 'Paris'] })).toEqual({ place: ['Berlin', 'Paris'] });
  for (const value of ['Unknown', ['Paris'], 3])
    expect(() => validateMetadata([field], { place: value })).toThrow('metadata');
  for (const value of [[], '', 'Paris', ['Unknown'], ['Paris', 'Paris'], [3]])
    expect(() => validateMetadata([multiple], { place: value })).toThrow('metadata');
  expect(() => validateMetadata([{ ...field, required: true }], {})).toThrow('metadata');
});

test('dropdown filters match complete options for single and multiple metadata values', () => {
  const meta = { ...config.meta, fields: [field] };
  const items = [
    { ...video, videoId: 'exact', meta: { place: 'Paris' } },
    { ...video, videoId: 'partial', meta: { place: 'Paris suburbs' } },
    { ...video, videoId: 'multiple', meta: { place: ['Berlin', 'Paris'] } }
  ];
  expect(filterVideos(items, '', { 'meta:place': 'Paris' }, meta).map((item) => item.videoId)).toEqual([
    'exact',
    'multiple'
  ]);
});
