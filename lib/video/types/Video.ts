interface Video {
  videoId: string;
  title: string;
  meta: Record<string, unknown>;
  filesPrefix: string;
  lastModified: Date;
}

export { Video };
