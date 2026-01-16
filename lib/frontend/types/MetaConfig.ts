interface MetaConfigString {
  name: string;
  type: 'string';
  encrypted: boolean;
}

interface MetaConfigOthers {
  name: string;
  type: 'number' | 'boolean' | 'Date';
}

type MetaConfig = MetaConfigString | MetaConfigOthers;

export { MetaConfig };
