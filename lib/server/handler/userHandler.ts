import express from 'express';
import { authenticate, authorize, hashPassword } from '@/auth';
import { getExpiresAt } from '@/auth/jwt';
import { addUser, deleteUser, getAllUsers, getUserByUsername, updateUser } from '@/user';
import { User } from '@/user/types/User';
import { authorizeInit } from '@/init';

const authorizeHandler: express.RequestHandler = async function (req, res, next) {
  req.body = req.body ?? {};
  delete req.body.authorizedUser;
  delete req.body.authorizedInit;
  const token = (req.header('authorize') ?? '').replace(/^bearer /, '');

  const user = await authorize(token);
  if (user) {
    req.body.authorizedUser = user;
    return next();
  }

  const authorizedInit = await authorizeInit(token);
  if (authorizedInit) {
    req.body.authorizedInit = true;
    return next();
  }

  res.status(401).json({ error: 'unauthorized' });
};

const userManagerHandler: express.RequestHandler = async function (req, res, next) {
  if (req.body?.authorizedInit) {
    return next();
  }

  const user = req.body?.authorizedUser as User | undefined;

  if (user?.userManager) {
    return next();
  }

  res.status(403).json({ error: 'forbidden' });
};

const addUserHandler: express.RequestHandler = async function (req, res) {
  const user = req.body.user as User;
  const [hashSalt, hash, hashAlgorithm] = await hashPassword(req.body.password ?? '');
  await addUser({ ...user, hashSalt, hash, hashAlgorithm });

  res.status(201).json({ message: 'created' });
};

const modifyUsernameHandler: express.RequestHandler = async function (req, res) {
  const { userId, username } = req.body;
  const updated = await updateUser(userId, { username });

  if (!updated) {
    return res.status(400).json({ error: 'not-updated' });
  }
  res.status(200).json({ message: 'updated' });
};

const modifyOwnUsernameHandler: express.RequestHandler = async function (req, res) {
  const { authorizedUser, username } = req.body ?? {};
  const { userId } = authorizedUser ?? {};
  const updated = await updateUser(userId, { username });

  if (!updated) {
    return res.status(400).json({ error: 'not-updated' });
  }
  res.status(200).json({ message: 'updated' });
};

const modifyCredentialsHandler: express.RequestHandler = async function (req, res) {
  const { userId, username, password, passwordKeySalt, userKey } = req.body;
  const [hashSalt, hash, hashAlgorithm] = await hashPassword(password);
  const updated = await updateUser(userId, { username, passwordKeySalt, userKey, hashSalt, hash, hashAlgorithm });

  if (!updated) {
    return res.status(400).json({ error: 'not-updated' });
  }
  res.status(200).json({ message: 'updated' });
};

const modifyOwnCredentialsHandler: express.RequestHandler = async function (req, res) {
  const { authorizedUser, username, password, passwordKeySalt, userKey } = req.body ?? {};
  const { userId } = authorizedUser ?? {};
  const [hashSalt, hash, hashAlgorithm] = await hashPassword(password);
  const updated = await updateUser(userId, { username, passwordKeySalt, userKey, hashSalt, hash, hashAlgorithm });

  if (!updated) {
    return res.status(400).json({ error: 'not-updated' });
  }
  res.status(200).json({ message: 'updated' });
};

const modifyPermissionsHandler: express.RequestHandler = async function (req, res) {
  const { userId, userManager, videoManager, admin } = req.body;
  const updated = await updateUser(userId, { userManager, videoManager, admin });

  if (!updated) {
    return res.status(400).json({ error: 'not-updated' });
  }
  res.status(200).json({ message: 'updated' });
};

const modifyDisplayNameHandler: express.RequestHandler = async function (req, res) {
  const { userId, displayName } = req.body;
  const updated = await updateUser(userId, { displayName });

  if (!updated) {
    return res.status(400).json({ error: 'not-updated' });
  }
  res.status(200).json({ message: 'updated' });
};

const deleteUserHandler: express.RequestHandler = async function (req, res) {
  const { userId } = req.params;
  const deleted = await deleteUser(userId ?? '_');

  if (!deleted) {
    return res.status(400).json({ error: 'not-deleted' });
  }
  res.status(200).json({ message: 'deleted' });
};

const getUsersHandler: express.RequestHandler = async function (req, res) {
  const users = await getAllUsers();

  res.status(200).json({ users });
};

const loginHandler: express.RequestHandler = async function (req, res) {
  const { username, password } = req.body;
  const token = await authenticate(username, password);

  if (!token) {
    return res.status(401).json({ error: 'invalid_login' });
  }

  const user = await getUserByUsername(username);
  res.status(200).json({ token, expires: getExpiresAt(token), userKey: user?.userKey });
};

export {
  authorizeHandler,
  userManagerHandler,
  addUserHandler,
  modifyUsernameHandler,
  modifyOwnUsernameHandler,
  modifyCredentialsHandler,
  modifyOwnCredentialsHandler,
  modifyPermissionsHandler,
  modifyDisplayNameHandler,
  deleteUserHandler,
  getUsersHandler,
  loginHandler
};
