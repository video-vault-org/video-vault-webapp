import { z } from 'zod';

type ImagesConfig = z.infer<typeof imagesConfigSchema>;

const imagesConfigSchema = z
  .object({
    prefix: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/)
  })
  .strict();

export { ImagesConfig, imagesConfigSchema };
