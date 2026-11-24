import { z } from 'zod';

const fieldKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z][A-Za-z0-9_]*$/)
  .refine((key) => !['constructor', 'prototype', '__proto__'].includes(key), 'Reserved metadata key');
const fieldTypes = ['text', 'number', 'boolean', 'date', 'datetime'] as const;
const fieldSchema = z
  .object({
    key: fieldKeySchema,
    name: z.object({ de: z.string().trim().min(1).max(100), en: z.string().trim().min(1).max(100) }).strict(),
    type: z.enum(fieldTypes),
    multiple: z.boolean(),
    required: z.boolean(),
    showInDetails: z.boolean(),
    useAsFilter: z.boolean(),
    options: z.array(z.string().trim().min(1).max(100)).min(1).max(100).optional()
  })
  .strict()
  .refine((field) => field.type !== 'boolean' || !field.multiple, 'Boolean fields cannot contain multiple values')
  .refine((field) => field.options === undefined || field.type === 'text', 'Only text fields can have dropdown options')
  .refine((field) => field.options === undefined || new Set(field.options).size === field.options.length, 'Dropdown options must be unique');
const sortDirectionSchema = z.enum(['asc', 'desc']);
const sortSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('title'), direction: sortDirectionSchema }).strict(),
  z.object({ source: z.literal('recorded'), direction: sortDirectionSchema }).strict(),
  z.object({ source: z.literal('meta'), key: fieldKeySchema, direction: sortDirectionSchema }).strict()
]);

/** Public frontend configuration; this does not restrict values accepted in Video.meta by the backend. */
const metaConfigSchema = z
  .object({
    recorded: z.object({ withTime: z.boolean(), useAsFilter: z.boolean() }).strict(),
    fields: z.array(fieldSchema).max(100),
    sorting: z.array(sortSchema).max(102)
  })
  .strict()
  .superRefine((config, context) => {
    const keys = new Set<string>();
    for (const [index, field] of config.fields.entries()) {
      if (keys.has(field.key)) context.addIssue({ code: 'custom', message: 'Metadata keys must be unique', path: ['fields', index, 'key'] });
      keys.add(field.key);
    }
    const selected = new Set<string>();
    for (const [index, sort] of config.sorting.entries()) {
      const key = sort.source === 'meta' ? `meta:${sort.key}` : sort.source;
      if (sort.source === 'meta' && !keys.has(sort.key)) context.addIssue({ code: 'custom', message: 'Unknown metadata sort key', path: ['sorting', index, 'key'] });
      if (selected.has(key)) context.addIssue({ code: 'custom', message: 'Sort fields must be unique', path: ['sorting', index] });
      selected.add(key);
    }
  });

type MetaConfig = z.infer<typeof metaConfigSchema>;
type MetaField = z.infer<typeof fieldSchema>;
type MetaSort = z.infer<typeof sortSchema>;

const DEFAULT_META_CONFIG: MetaConfig = {
  recorded: { withTime: false, useAsFilter: true },
  fields: [],
  sorting: [
    { source: 'recorded', direction: 'desc' },
    { source: 'title', direction: 'asc' }
  ]
};

export { MetaConfig, MetaField, MetaSort, DEFAULT_META_CONFIG, metaConfigSchema, fieldSchema, fieldTypes, fieldKeySchema };
