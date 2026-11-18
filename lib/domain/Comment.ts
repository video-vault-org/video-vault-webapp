interface Comment {
  commentId: string;
  userId: string;
  videoId: string;
  content: string;
  created: Date;
  lastModified: Date;
  edited: boolean;
  deleted: boolean;
  hmac: string;
}

export { Comment };
