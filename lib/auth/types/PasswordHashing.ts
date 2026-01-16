interface PasswordHashing {
  algorithm: 'scrypt'; // more constants when new algorithms added
  hashPassword: (password: string) => Promise<[string, string]>;
  checkPassword: (password: string, salt: string, hash: string) => Promise<boolean>;
}

export { PasswordHashing };
