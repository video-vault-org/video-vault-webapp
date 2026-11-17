import { User } from '@/domain/User';
import { Video } from '@/domain/Video';
import { Comment } from '@/domain/Comment';
import { AttemptsCount } from '@/domain/AttemptsCount';

interface DatabaseAdapter {
  /**
   * Opens the database connection.
   */
  open(): Promise<void>;

  /**
   * Closes the database connection.
   */
  close(): Promise<void>;

  /**
   * Initializes the database.
   * Creates the required tables, indexes, primary keys, etc.
   */
  initialize(): Promise<void>;

  /**
   * Creates a new user
   * @param user The user to be created
   * @throws If the username is already in use
   */
  createUser(user: User): Promise<void>;

  /**
   * Changes the users displayName, matched by its userId
   * @param userId The id of the user to be changed
   * @param displayName The desired new username
   */
  changeUsersDisplayNameByUserId({ userId, displayName }: { userId: string, displayName: string }): Promise<void>;

  /**
   * Changes the users username, matched by its userId
   * @param userId The id of the user to be changed
   * @param username The desired new username
   * @throws If another user already has the username
   */
  changeUsersUsernameByUserId({ userId, username }: { userId: string, username: string }): Promise<void>;

  /**
   * Changes the users password attributes, matched by its userId
   * @param userId The id of the user to be changed
   * @param loginHash The new loginHash
   * @param passwordKeySalt The new passwordKeySalt
   * @param userKey The new userKey
   */
  changeUsersPasswordByUserId({ userId, loginHash, passwordKeySalt, userKey }: { userId: string, loginHash: string, passwordKeySalt: string, userKey: string }): Promise<void>;

  /**
   * Changes the users admin role flag, matched by its userId
   * @param userId The id of the user to be changed
   * @param admin The new admin role state (boolean)
   */
  changeUsersAdminRoleByUserId({ userId, admin }: { userId: string, admin: boolean }): Promise<void>;

  /**
   * Changes the users editor role flag, matched by its userId
   * @param userId The id of the user to be changed
   * @param editor The new editor role state (boolean)
   */
  changeUsersEditorRoleByUserId({ userId, editor }: { userId: string, editor: boolean }): Promise<void>;

  /**
   * Changes the users moderator role flag, matched by its userId
   * @param userId The id of the user to be changed
   * @param moderator The new moderator role state (boolean)
   */
  changeUsersModeratorRoleByUserId({ userId, moderator }: { userId: string, moderator: boolean }): Promise<void>;

  /**
   * Finds one user, matched by its userId
   * @param userId The id of the user to be found
   */
  findOneUserByUserId({ userId }: { userId: string }): Promise<User | null>;

  /**
   * Finds one user, matched by its username
   * @param username The username of the user to be found
   */
  findOneUserByUsername({ username }: { username: string }): Promise<User | null>;

  /**
   * Finds all users
   */
  findAllUsers(): Promise<User[]>;

  /**
   * Deletes a user, matched by its userId
   * @param userId The id of the user to be deleted
   */
  deleteUserByUserId({ userId }: { userId: string }): Promise<void>;

  /**
   * Posts a new video
   * @param video The video to be posted
   */
  postVideo(video: Video): Promise<void>;

  /**
   * Changes a videos title, matched by its videoId
   * @param videoId The id of the video to be changed
   * @param title The new title
   * @param lastModified The new lastModified date
   * @param hmac The new hmac
   */
  changeVideosTitleByVideoId({ videoId, title, lastModified, hmac }: { videoId: string, title: string, lastModified: Date, hmac: string }): Promise<void>;

  /**
   * Changes a videos metadata, matched by its videoId
   * @param videoId The id of the video to be changed
   * @param metadata The new metadata
   * @param lastModified The new lastModified date
   * @param hmac The new hmac
   */
  changeVideosMetadataByVideoId({ videoId, metadata, lastModified, hmac }: { videoId: string, metadata: Record<string, unknown>, lastModified: Date, hmac: string }): Promise<void>;

  /**
   * Changes a videos video mimetype, matched by its videoId
   * @param videoId The id of the video to be changed
   * @param mimetype The new mimetype
   * @param lastModified The new lastModified date
   * @param hmac The new hmac
   */
  changeVideosVideoMimetypeByVideoId({ videoId, mimetype, lastModified, hmac }: { videoId: string, mimetype: string, lastModified: Date, hmac: string }): Promise<void>;

  /**
   * Changes a videos thumbnail mimetype, matched by its videoId
   * @param videoId The id of the video to be changed
   * @param mimetype The new mimetype
   * @param lastModified The new lastModified date
   * @param hmac The new hmac
   */
  changeVideosThumbnailMimetypeByVideoId({ videoId, mimetype, lastModified, hmac }: { videoId: string, mimetype: string, lastModified: Date, hmac: string }): Promise<void>;

  /**
   * Finds one video by its videoId
   * @param videoId The id of the video to be found
   */
  findOneVideoByVideoId({ videoId }: { videoId: string }): Promise<Video | null>;

  /**
   * Finds all video lastModified since
   * @param since The date since you want the videos from
   */
  findManyVideosLastModified({ since }: { since: Date }): Promise<Video[]>;

  /**
   * Finds all videos
   */
  findAllVideos(): Promise<Video[]>;

  /**
   * Deletes a video by its videoId
   * @param videoId The id of the video to be deleted
   */
  deleteVideoByVideoId({ videoId }: { videoId: string }): Promise<void>;

  /**
   * Posts a comment
   * @param comment The comment to be posted
   */
  postComment(comment: Comment): Promise<void>;

  /**
   * Changes the content of a comment, matched by commentId and userId
   * @param commentId The id of the comment to be changed
   * @param userId The id of the user the comment belongs to
   * @param content The new content
   * @param lastModified The new lastModified date
   * @param hmac The new hmac
   */
  changeCommentsContentByCommentIdAndUserId({ commentId, userId, content, lastModified, hmac }: { commentId: string, userId: string, content: string, lastModified: Date, hmac: string }): Promise<void>;

  /**
   * Changes the content of a comment, matched by commentId
   * @param commentId The id of the comment to be changed
   * @param content The new content
   * @param lastModified The new lastModified date
   * @param hmac The new hmac
   */
  changeCommentsContentByCommentId({ commentId, content, lastModified, hmac }: { commentId: string, content: string, lastModified: Date, hmac: string }): Promise<void>;

  /**
   * Sets deleted to true and content to an empty string, matched by commentId.
   * @param commentId The id of the comment to be changed
   */
  markCommentAsDeletedByCommentId({ commentId }: { commentId: string }): Promise<void>;

  /**
   * Sets deleted to true and content to an empty string, matched by commentId and userId.
   * @param commentId The id of the comment to be changed
   * @param userId The id of the user the comment belongs to
   */
  markCommentAsDeletedByCommentIdAndUserId({ commentId, userId }: { commentId: string, userId: string }): Promise<void>;

  /**
   * Sets deleted to true and content to an empty string for all comments matched by the user's ID.
   * @param userId The id of the comments from which the comments are to be marked as deleted
   */
  markCommentsAsDeletedByUserId({ userId }: { userId: string }): Promise<void>;

  /**
   * Deletes comments, matched by belonging video's ID
   * @param videoId The id of the video from which the comments are to be deleted
   */
  deleteCommentsByVideoId({ videoId }: { videoId: string }): Promise<void>;

  /**
   * Finds comments, matched by videoId, sorted by created, paginated using cursor pagination
   * @param videoId The id of the video to find the comments from
   * @param paginationCursor The cursor returned by the previous request, or an empty string for the first page
   * @param paginationSize The desired page size
   * @returns The comments and an opaque cursor for the next page, or an empty string if there is no next page.
   */
  findManyCommentsByVideoIdSortedByCreatedDescPaginated({ videoId, paginationCursor, paginationSize }: { videoId: string, paginationCursor: string, paginationSize: number }): Promise<[Comment[], string]>;

  /**
   * Finds a comment by its id
   * @param commentId The id of the comment to be found
   */
  findOneCommentByCommentId({ commentId }: { commentId: string }): Promise<Comment | null>;

  /**
   * Increases the count of failed login attempts for a username.
   * The count is created if it not already exists.
   * @param username The username to increase the count for
   * @param lastAttempt The date of the last failed login attempt
   */
  increaseAttemptsCountByUsername({ username, lastAttempt }: { username: string, lastAttempt: Date }): Promise<void>;

  /**
   * Clears the count of failed login attempts for a username.
   * It will be deleted
   * @param username The username to clear the count for
   */
  clearAttemptsCountByUsername({ username }: { username: string }): Promise<void>;

  /**
   * Finds the count of failed login attempts for a username.
   * @param username The username to find the count for
   */
  findOneAttemptsCountByUsername({ username }: { username: string }): Promise<AttemptsCount | null>;
}

export { DatabaseAdapter };
