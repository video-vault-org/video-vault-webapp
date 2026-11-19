interface User {
  userId: string;
  username: string;
  displayName: string;
  /** Stored as a salted scrypt string in the database; UserService accepts the client's Base64 loginHash as input. */
  loginHash: string;
  passwordKeySalt: string;
  userKey: string;
  admin: boolean;
  editor: boolean;
  moderator: boolean;
}

export { User };
