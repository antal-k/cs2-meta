import fs from "fs";
import { logger } from "../../logger.js";
import type { BunnyConfig } from "../../config.js";
import type { UploadProvider } from "./provider.js";

export class BunnyProvider implements UploadProvider {
  readonly name = "Bunny CDN";
  private readonly config: BunnyConfig;

  constructor(config: BunnyConfig) {
    this.config = config;
  }

  validate(): string | null {
    if (!this.config.access_key) return "bunny.access_key is required (or set BUNNY_ACCESS_KEY)";
    if (!this.config.storage_zone) return "bunny.storage_zone is required (or set BUNNY_STORAGE_ZONE_NAME)";
    return null;
  }

  async upload(localPath: string, remotePath: string): Promise<boolean> {
    const url = this.buildUrl(remotePath);
    const body = fs.readFileSync(localPath);

    try {
      const res = await fetch(url, {
        method: "PUT",
        headers: {
          AccessKey: this.config.access_key,
          "Content-Type": "application/octet-stream",
        },
        body,
      });

      if (!res.ok) {
        logger.debug(`Bunny upload failed ${remotePath}: ${res.status} ${res.statusText}`);
        return false;
      }
      return true;
    } catch (err) {
      logger.debug(`Bunny upload error ${remotePath}: ${(err as Error).message}`);
      return false;
    }
  }

  private buildUrl(remotePath: string): string {
    const region = this.config.region ? `${this.config.region}.` : "";
    const clean = remotePath.startsWith("/") ? remotePath.slice(1) : remotePath;
    return `https://${region}storage.bunnycdn.com/${this.config.storage_zone}/${clean}`;
  }
}
