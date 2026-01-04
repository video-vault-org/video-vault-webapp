import { UploadedFile } from 'express-fileupload';

interface Files {
  [key: string]: UploadedFile;
}

export { Files };
