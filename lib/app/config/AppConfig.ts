import { z } from 'zod';

const DEFAULT_APP_TITLE = 'VideoVault';
const appConfigSchema = z.object({ title: z.string().trim().min(1).max(100) }).strict();
type AppConfig = z.infer<typeof appConfigSchema>;

export { AppConfig, DEFAULT_APP_TITLE, appConfigSchema };
