import { Comment } from './Comment';

/** Current author name is response metadata and is not covered by the comment HMAC. */
interface CommentDto extends Comment {
  displayName: string | null;
}

export { CommentDto };
