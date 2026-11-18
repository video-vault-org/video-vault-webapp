interface Video {
  videoId: string;
  title: string;
  meta: Record<string, unknown>;
  videoMimeType: string;
  thumbnailMimeType: string;
  lastModified: Date;
  hmac: string;
}

export { Video };
