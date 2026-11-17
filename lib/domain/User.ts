interface User {
  userId: string;
  username: string;
  displayName: string;
  loginHash: string;
  passwordKeySalt: string;
  userKey: string;
  admin: boolean;
  editor: boolean;
  moderator: boolean;
}

export { User };
