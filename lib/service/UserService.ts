import { DatabaseAdapter } from '@/db/adapters/DatabaseAdapter';
import { User } from '@/domain/User';
import { hashPassword } from '@/util/password';

/**
 * Coordinates user accounts and the deletion of their comment content.
 */
class UserService {
  private readonly db: DatabaseAdapter;

  /**
   * @param db The database adapter used for users and their comments.
   */
  public constructor(db: DatabaseAdapter) {
    this.db = db;
  }

  /**
   * Creates a user, hashing the client-supplied Base64 loginHash with scrypt and a fresh salt.
   * @param user The user to create; loginHash is the client's password equivalent, not a stored scrypt string.
   * @throws If the username is already in use or the database write fails.
   */
  public async createUser(user: User): Promise<void> {
    await this.db.createUser({ ...user, loginHash: await hashPassword(user.loginHash) });
  }

  /**
   * Marks the user's comments as deleted and clears their content, then deletes the user.
   * Stops if marking the comments fails, leaving the user account intact.
   * The two operations are not one transaction; comment changes are not rolled back if deletion fails.
   * @param userId The ID of the user to delete.
   * @throws If marking the comments or deleting the user fails.
   */
  public async deleteUser({ userId }: { userId: string }): Promise<void> {
    await this.db.markCommentsAsDeletedByUserId({ userId });
    await this.db.deleteUserByUserId({ userId });
  }

  /**
   * Updates a user's display name.
   * @param userId The ID of the user to update.
   * @param displayName The new display name.
   * @throws If the database update fails.
   */
  public async changeUsersDisplayName({ userId, displayName }: { userId: string; displayName: string }): Promise<void> {
    await this.db.changeUsersDisplayNameByUserId({ userId, displayName });
  }

  /**
   * Updates a user's username.
   * @param userId The ID of the user to update.
   * @param username The new username.
   * @throws If another user has the username or the database update fails.
   */
  public async changeUsersUsername({ userId, username }: { userId: string; username: string }): Promise<void> {
    await this.db.changeUsersUsernameByUserId({ userId, username });
  }

  /**
   * Hashes the client's new loginHash with scrypt and updates the password attributes together.
   * @param userId The ID of the user to update.
   * @param loginHash The new Base64 loginHash from the client, not a stored scrypt string.
   * @param passwordKeySalt The new password key salt.
   * @param userKey The new encrypted user key.
   * @throws If the database update fails.
   */
  public async changeUsersPassword({ userId, loginHash, passwordKeySalt, userKey }: { userId: string; loginHash: string; passwordKeySalt: string; userKey: string }): Promise<void> {
    await this.db.changeUsersPasswordByUserId({ userId, loginHash: await hashPassword(loginHash), passwordKeySalt, userKey });
  }

  /**
   * Updates a user's admin role.
   * @param userId The ID of the user to update.
   * @param admin Whether the user should have the admin role.
   * @throws If the database update fails.
   */
  public async changeUsersAdminRole({ userId, admin }: { userId: string; admin: boolean }): Promise<void> {
    await this.db.changeUsersAdminRoleByUserId({ userId, admin });
  }

  /**
   * Updates a user's editor role.
   * @param userId The ID of the user to update.
   * @param editor Whether the user should have the editor role.
   * @throws If the database update fails.
   */
  public async changeUsersEditorRole({ userId, editor }: { userId: string; editor: boolean }): Promise<void> {
    await this.db.changeUsersEditorRoleByUserId({ userId, editor });
  }

  /**
   * Updates a user's moderator role.
   * @param userId The ID of the user to update.
   * @param moderator Whether the user should have the moderator role.
   * @throws If the database update fails.
   */
  public async changeUsersModeratorRole({ userId, moderator }: { userId: string; moderator: boolean }): Promise<void> {
    await this.db.changeUsersModeratorRoleByUserId({ userId, moderator });
  }

  /**
   * Finds a user by their ID.
   * @param userId The ID of the user to find.
   * @returns The user, or null if no matching user exists.
   * @throws If the database query fails.
   */
  public async findUser({ userId }: { userId: string }): Promise<User | null> {
    return await this.db.findOneUserByUserId({ userId });
  }

  /**
   * Finds all users without sorting or pagination.
   * @returns All users, or an empty array if no users exist.
   * @throws If the database query fails.
   */
  public async findAllUsers(): Promise<User[]> {
    return await this.db.findAllUsers();
  }
}

export { UserService };
