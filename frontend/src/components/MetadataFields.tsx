import type { MetaField } from '../lib/types';
import { Field, useLanguage } from '../lib/ui';

const MetadataFields = function ({
  fields,
  value,
  onChange
}: {
  fields: MetaField[];
  value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
}) {
  const { t } = useLanguage();
  return (
    <>
      {fields.map((field) => (
        <Field key={field.key} label={`${field.name}${field.required ? ' *' : ''}`}>
          <MetaInput field={field} value={value[field.key]} onChange={(v) => onChange({ ...value, [field.key]: v })} />
          {field.multiple && <small>{t('Ein Wert pro Zeile.', 'One value per line.')}</small>}
        </Field>
      ))}
    </>
  );
};

const MetaInput = function ({
  field,
  value,
  onChange,
  id
}: {
  field: MetaField;
  id?: string;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const { t } = useLanguage();
  if (field.multiple)
    return (
      <textarea
        id={id}
        aria-label={`${field.name}${field.required ? ' *' : ''}`}
        required={field.required}
        value={Array.isArray(value) ? value.join('\n') : ''}
        onChange={(e) => onChange(e.target.value.split('\n'))}
        onBlur={() =>
          onChange(
            (Array.isArray(value) ? value : [])
              .map((v) => String(v).trim())
              .filter(Boolean)
              .map((v) => (field.type === 'number' ? Number(v) : v))
          )
        }
      />
    );
  if (field.type === 'boolean')
    return (
      <select
        id={id}
        required={field.required}
        value={value === undefined ? '' : String(value)}
        onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value === 'true')}
      >
        <option value="">—</option>
        <option value="true">{t('Ja', 'Yes')}</option>
        <option value="false">{t('Nein', 'No')}</option>
      </select>
    );
  return (
    <input
      id={id}
      required={field.required}
      type={
        field.type === 'number'
          ? 'number'
          : field.type === 'date'
            ? 'date'
            : field.type === 'datetime'
              ? 'datetime-local'
              : 'text'
      }
      step={field.type === 'number' ? 'any' : field.type === 'datetime' ? '1' : undefined}
      value={
        field.type === 'datetime' && value && Number.isFinite(Date.parse(String(value)))
          ? new Date(Date.parse(String(value)) - new Date(String(value)).getTimezoneOffset() * 60000)
              .toISOString()
              .slice(0, 19)
          : String(value ?? '')
      }
      onChange={(e) =>
        onChange(
          field.type === 'number' && e.target.value !== ''
            ? Number(e.target.value)
            : field.type === 'datetime' && e.target.value
              ? new Date(e.target.value).toISOString()
              : e.target.value
        )
      }
    />
  );
};

const validateMetadata = function (fields: MetaField[], meta: Record<string, unknown>) {
  const result: Record<string, unknown> = { ...meta };
  for (const f of fields) {
    let value = meta[f.key];
    const blank =
      value === undefined || value === '' || (Array.isArray(value) && !value.some((v) => String(v).trim() !== ''));
    if (blank) {
      if (f.required) throw new Error('metadata');
      delete result[f.key];
      continue;
    }
    if (f.multiple) {
      if (!Array.isArray(value)) throw new Error('metadata');
      value = value
        .map((v) => String(v).trim())
        .filter(Boolean)
        .map((v) => (f.type === 'number' ? Number(v) : v));
    }
    const values = f.multiple ? (value as unknown[]) : [value];
    if (
      !values.every((v) =>
        f.type === 'number'
          ? typeof v === 'number' && Number.isFinite(v)
          : f.type === 'boolean'
            ? typeof v === 'boolean'
            : f.type === 'date' || f.type === 'datetime'
              ? typeof v === 'string' &&
                Number.isFinite(Date.parse(v)) &&
                (f.type !== 'date' || (/^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(v).toISOString().startsWith(v)))
              : typeof v === 'string'
      )
    )
      throw new Error('metadata');
    result[f.key] =
      f.type === 'datetime'
        ? f.multiple
          ? (value as string[]).map((v) => new Date(v).toISOString())
          : new Date(value as string).toISOString()
        : value;
  }
  return result;
};

export { MetadataFields, MetaInput, validateMetadata };
