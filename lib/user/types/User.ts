interface User {
  userId: string;
  username: string;
  displayName: string;
  hash: string;
  hashSalt: string;
  hashAlgorithm: string;
  passwordKeySalt: string;
  userKey: string;
  admin: boolean;
  userManager: boolean;
  videoManager: boolean;
}

export { User };
