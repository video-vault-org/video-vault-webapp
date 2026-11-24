import { fieldTypes, MetaField } from '@/meta/config/MetaConfig';
import { Type, object } from './validation';

const key = Type.String({ minLength: 1, maxLength: 64, pattern: '^[A-Za-z][A-Za-z0-9_]*$' });
const direction = Type.Union([Type.Literal('asc'), Type.Literal('desc')]);

/** Public shape only; cross-field and uniqueness validation is performed when loading the configuration. */
const metaConfigResponse = object({
  recorded: object({ withTime: Type.Boolean(), useAsFilter: Type.Boolean() }),
  fields: Type.Array(
    object({
      key,
      name: Type.String({ minLength: 1, maxLength: 100 }),
      type: Type.Unsafe<MetaField['type']>({ type: 'string', enum: [...fieldTypes] }),
      multiple: Type.Boolean(),
      required: Type.Boolean(),
      showInDetails: Type.Boolean(),
      useAsFilter: Type.Boolean(),
      options: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 100 }), { minItems: 1, maxItems: 100, uniqueItems: true }))
    }),
    {
      maxItems: 100
    }
  ),
  sorting: Type.Array(Type.Union([object({ source: Type.Literal('title'), direction }), object({ source: Type.Literal('recorded'), direction }), object({ source: Type.Literal('meta'), key, direction })]), { maxItems: 102 })
});

export { metaConfigResponse };
