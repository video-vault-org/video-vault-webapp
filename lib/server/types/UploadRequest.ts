import { AuthorizedUserRequest } from './AuthorizedUserRequest';
import { Files } from '@/server/types/Files';

type UploadRequest = AuthorizedUserRequest & { files: Files };

export { UploadRequest };
