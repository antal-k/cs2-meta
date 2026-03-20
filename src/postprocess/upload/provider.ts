export interface UploadProvider {
  readonly name: string;
  validate(): string | null;
  upload(localPath: string, remotePath: string): Promise<boolean>;
}
