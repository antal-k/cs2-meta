import fs from "fs";
import path from "path";
import os from "os";
import https from "https";
import { execSync } from "child_process";
import { logger } from "../logger.js";
import type { Config } from "../config.js";

const REPO = "ValveResourceFormat/ValveResourceFormat";
const GITHUB_API = `https://api.github.com/repos/${REPO}/releases/latest`;
const VERSION_FILE = "source2viewer.version";

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

interface Release {
  tag_name: string;
  assets: ReleaseAsset[];
}

function getPlatformKey(): string {
  const platform = os.platform();
  const arch = os.arch();

  let osKey: string;
  switch (platform) {
    case "darwin": osKey = "macos"; break;
    case "win32": osKey = "windows"; break;
    case "linux": osKey = "linux"; break;
    default: throw new Error(`Unsupported platform: ${platform}`);
  }

  let archKey: string;
  switch (arch) {
    case "x64": archKey = "x64"; break;
    case "arm64": archKey = "arm64"; break;
    case "arm": archKey = "arm"; break;
    default: throw new Error(`Unsupported architecture: ${arch}`);
  }

  return `cli-${osKey}-${archKey}`;
}

function fetchJson(url: string): Promise<Release> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "User-Agent": "cs2-meta" } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchJson(res.headers.location!).then(resolve).catch(reject);
      }
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error(`Failed to parse response from ${url}`)); }
      });
    });
    req.on("error", reject);
  });
}

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const request = (u: string) => {
      https.get(u, { headers: { "User-Agent": "cs2-meta" } }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          return request(res.headers.location!);
        }
        res.pipe(file);
        file.on("finish", () => { file.close(() => resolve()); });
      }).on("error", (err) => {
        fs.unlinkSync(dest);
        reject(err);
      });
    };
    request(url);
  });
}

function getInstalledVersion(binDir: string): string | null {
  const versionPath = path.join(binDir, VERSION_FILE);
  try {
    return fs.readFileSync(versionPath, "utf-8").trim();
  } catch {
    return null;
  }
}

function saveInstalledVersion(binDir: string, version: string): void {
  fs.writeFileSync(path.join(binDir, VERSION_FILE), version);
}

export async function ensureBinary(config: Config): Promise<string> {
  const cliPath = path.resolve(config.extract.source2_cli);
  const binDir = path.dirname(cliPath);

  if (fs.existsSync(cliPath)) {
    logger.debug(`Source2Viewer-CLI found at ${cliPath}`);
    return cliPath;
  }

  logger.step("Downloading Source2Viewer-CLI");

  const platformKey = getPlatformKey();
  logger.info(`Platform: ${platformKey}`);

  const release = await fetchJson(GITHUB_API);
  const tag = release.tag_name;
  logger.info(`Latest release: ${tag}`);

  const installed = getInstalledVersion(binDir);
  if (installed === tag && fs.existsSync(cliPath)) {
    logger.info(`Already at version ${tag}`);
    return cliPath;
  }

  const assetName = `${platformKey}.zip`;
  const asset = release.assets.find((a) => a.name === assetName);
  if (!asset) {
    throw new Error(
      `No release asset found for ${platformKey}. Available: ${release.assets.map((a) => a.name).join(", ")}`
    );
  }

  fs.mkdirSync(binDir, { recursive: true });
  const zipPath = path.join(binDir, assetName);

  const dlSpinner = logger.spin(`Downloading ${asset.name}...`);
  await downloadFile(asset.browser_download_url, zipPath);
  dlSpinner.succeed(`Downloaded ${asset.name}`);

  const extractSpinner = logger.spin("Extracting archive...");
  if (os.platform() === "win32") {
    execSync(`powershell -Command "Expand-Archive -Force '${zipPath}' '${binDir}'"`, { stdio: "pipe" });
  } else {
    execSync(`unzip -o "${zipPath}" -d "${binDir}"`, { stdio: "pipe" });
  }

  fs.unlinkSync(zipPath);

  if (os.platform() !== "win32" && fs.existsSync(cliPath)) {
    fs.chmodSync(cliPath, 0o755);
  }

  saveInstalledVersion(binDir, tag);
  extractSpinner.succeed(`Source2Viewer-CLI ${tag} installed`);

  return cliPath;
}
