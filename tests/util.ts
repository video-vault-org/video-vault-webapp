import fs, { mkdir, rm, writeFile } from 'fs/promises';
import { dirname } from 'path';

const exists = async function (path: string): Promise<boolean> {
  try {
    await fs.stat(path);
    return true;
  } catch {
    return false;
  }
};

const deleteDirectory = async function (path: string) {
  if (!(await exists(path))) {
    return;
  }
  await rm(path, { recursive: true });
};

const createEmptyFile = async function (path: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, Buffer.from(''));
};

export { exists, deleteDirectory, createEmptyFile };
