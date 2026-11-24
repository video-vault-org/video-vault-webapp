type Language = 'de' | 'en';

interface MetaField {
  key: string;
  name: Record<Language, string>;
  type: 'text' | 'number' | 'boolean' | 'date' | 'datetime';
  multiple: boolean;
  required: boolean;
  showInDetails: boolean;
  useAsFilter: boolean;
  options?: string[];
}

interface Bootstrap {
  version: 1;
  instanceSalt: string;
  app: { title: string };
  meta: {
    recorded: { withTime: boolean; useAsFilter: boolean };
    fields: MetaField[];
    sorting: (
      | { source: 'title'; direction: 'asc' | 'desc' }
      | { source: 'recorded'; direction: 'asc' | 'desc' }
      | { source: 'meta'; key: string; direction: 'asc' | 'desc' }
    )[];
  };
}

interface User {
  userId: string;
  username: string;
  displayName: string;
  passwordKeySalt: string;
  userKey: string;
  admin: boolean;
  editor: boolean;
  moderator: boolean;
}

interface Video {
  videoId: string;
  title: string;
  description: string;
  meta: Record<string, unknown>;
  videoMimeType: string;
  thumbnailMimeType: string;
  recorded: string;
  lastModified: string;
  hmac: string;
  deleted: boolean;
}

interface PlainVideo extends Video {
  plainTitle: string;
  plainDescription: string;
}

interface Comment {
  commentId: string;
  videoId: string;
  userId: string;
  content: string;
  created: string;
  lastModified: string;
  edited: boolean;
  deleted: boolean;
  hmac: string;
}

interface CommentDto extends Comment {
  displayName: string | null;
}

interface Keys {
  encryption: CryptoKey;
  auth: CryptoKey;
}

export { Language, MetaField, Bootstrap, User, Video, PlainVideo, Comment, CommentDto, Keys };
