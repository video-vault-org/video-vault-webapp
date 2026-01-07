import { MetaConfig } from '@/frontend/types/MetaConfig';

interface FrontendConfig {
  title: string;
  description: string;
  logo: string; //name of the directory with logo files
  videoMeta: MetaConfig[];
}

export { FrontendConfig };
