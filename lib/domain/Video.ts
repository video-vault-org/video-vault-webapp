interface Video {
  videoId: string;
  title: string;
  description: string;
  meta: Record<string, unknown>;
  videoMimeType: string;
  thumbnailMimeType: string;
  recorded: Date;
  lastModified: Date;
  hmac: string;
}

export { Video };
