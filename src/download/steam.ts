import SteamUser from "steam-user";
import { logger } from "../logger.js";
import type { Config } from "../config.js";

export function createSteamClient(logonID = 2121): SteamUser {
  const user = new SteamUser();

  user.on("error", (err: Error) => {
    logger.error("Steam error:", err.message);
    process.exit(1);
  });

  user.on("steamGuard", (_domain: string | null, _callback: (code: string) => void) => {
    logger.error("Steam Guard code required. Use an account without Steam Guard or supply a TOTP.");
    process.exit(1);
  });

  return user;
}

export function loginToSteam(user: SteamUser, config: Config): Promise<void> {
  return new Promise((resolve) => {
    if (!config.steam.anonymous && config.steam.username && config.steam.password) {
      logger.info(`Logging into Steam as ${config.steam.username}...`);
      user.logOn({
        accountName: config.steam.username,
        password: config.steam.password,
        rememberPassword: true,
        logonID: 2121,
      });
    } else {
      logger.info("Logging into Steam anonymously...");
      user.logOn({ anonymous: true, logonID: 2121 });
    }

    user.once("loggedOn", () => {
      logger.success("Logged into Steam");
      resolve();
    });
  });
}

export async function getLatestManifest(user: SteamUser, config: Config) {
  const productInfo = await user.getProductInfo([config.depot.app_id], [], true);
  const appInfo = (productInfo as any).apps[config.depot.app_id].appinfo;
  const depotInfo = appInfo.depots[config.depot.id];
  const latestManifestId = depotInfo.manifests.public.gid;
  return { latestManifestId, depotInfo };
}

export async function getManifest(user: SteamUser, config: Config, manifestId: string) {
  return user.getManifest(
    config.depot.app_id,
    config.depot.id,
    manifestId as any,
    "public"
  );
}
