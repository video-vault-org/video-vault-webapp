interface Lock {
  username: string;
  attempts: number;
  lastAttempt: Date;
}

export { Lock };
