interface User {
  userId: string;
  username: string;
  displayName: string;
  loginHash: string;
  passwordKeySalt: string;
  userKey: string;
  admin: boolean;
  userManager: boolean;
  videoManager: boolean;
}

export { User };
