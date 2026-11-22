import prompts from 'prompts';
import { z } from 'zod';

/** Asks a single question, applies its default on empty input and validates the resulting value. */
const ask = async function <T>(question: prompts.PromptObject, schema: z.ZodType<T>): Promise<T> {
  const normalize = (value: unknown) => (value === '' || value === undefined ? question.initial : value);

  const answers = await prompts(
    { ...question, name: 'value', validate: (value: unknown) => schema.safeParse(normalize(value)).success || 'Please enter a valid value' },
    {
      onCancel: () => {
        throw new Error('Configuration initialization cancelled');
      }
    }
  );
  // A missing answer also covers incomplete/cancelled responses returned by the prompt implementation.
  if (!('value' in answers)) throw new Error('Missing configuration answer');
  return schema.parse(normalize(answers.value));
};

export { ask };
