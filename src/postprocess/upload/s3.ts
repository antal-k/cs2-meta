import fs from "fs";
import crypto from "crypto";
import { logger } from "../../logger.js";
import type { S3Config } from "../../config.js";
import type { UploadProvider } from "./provider.js";

function hmac(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac("sha256", key).update(data).digest();
}

function sha256(data: Buffer | string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

export class S3Provider implements UploadProvider {
  readonly name = "S3";
  private readonly config: S3Config;

  constructor(config: S3Config) {
    this.config = config;
  }

  validate(): string | null {
    if (!this.config.access_key_id) return "s3.access_key_id is required (or set AWS_ACCESS_KEY_ID)";
    if (!this.config.secret_access_key) return "s3.secret_access_key is required (or set AWS_SECRET_ACCESS_KEY)";
    if (!this.config.bucket) return "s3.bucket is required (or set S3_BUCKET)";
    if (!this.config.region) return "s3.region is required (or set AWS_REGION)";
    return null;
  }

  async upload(localPath: string, remotePath: string): Promise<boolean> {
    const body = fs.readFileSync(localPath);
    const key = remotePath.startsWith("/") ? remotePath.slice(1) : remotePath;

    const host = this.config.endpoint
      ? new URL(this.config.endpoint).host
      : `${this.config.bucket}.s3.${this.config.region}.amazonaws.com`;

    const baseUrl = this.config.endpoint
      ? `${this.config.endpoint}/${this.config.bucket}`
      : `https://${host}`;

    const url = `${baseUrl}/${key}`;
    const now = new Date();
    const dateStamp = now.toISOString().replace(/[-:]/g, "").slice(0, 8);
    const amzDate = dateStamp + "T" + now.toISOString().replace(/[-:]/g, "").slice(9, 15) + "Z";
    const payloadHash = sha256(body);

    const headers: Record<string, string> = {
      Host: new URL(url).host,
      "x-amz-date": amzDate,
      "x-amz-content-sha256": payloadHash,
      "Content-Type": "application/octet-stream",
    };

    const signedHeaderKeys = Object.keys(headers).map((k) => k.toLowerCase()).sort();
    const signedHeaders = signedHeaderKeys.join(";");
    const canonicalHeaders = signedHeaderKeys.map((k) => `${k}:${headers[Object.keys(headers).find((h) => h.toLowerCase() === k)!]}\n`).join("");

    const canonicalRequest = [
      "PUT",
      `/${key}`,
      "",
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join("\n");

    const scope = `${dateStamp}/${this.config.region}/s3/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      scope,
      sha256(canonicalRequest),
    ].join("\n");

    const signingKey = hmac(
      hmac(
        hmac(
          hmac(`AWS4${this.config.secret_access_key}`, dateStamp),
          this.config.region,
        ),
        "s3",
      ),
      "aws4_request",
    );
    const signature = hmac(signingKey, stringToSign).toString("hex");

    const authorization = `AWS4-HMAC-SHA256 Credential=${this.config.access_key_id}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    try {
      const res = await fetch(url, {
        method: "PUT",
        headers: { ...headers, Authorization: authorization },
        body,
      });

      if (!res.ok) {
        logger.debug(`S3 upload failed ${key}: ${res.status} ${res.statusText}`);
        return false;
      }
      return true;
    } catch (err) {
      logger.debug(`S3 upload error ${key}: ${(err as Error).message}`);
      return false;
    }
  }
}
