interface Comment {
  commentId: string;
  videoId: string;
  userId: string;
  content: string;
  created: Date;
  edited: boolean;
  lastModified: Date;
  deleted: boolean;
}

export { Comment };
