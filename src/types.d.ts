declare module "steam-user" {
  class SteamUser {
    constructor();
    logOn(details: Record<string, any>): void;
    logOff(): void;
    on(event: string, callback: (...args: any[]) => void): void;
    once(event: string, callback: (...args: any[]) => void): void;
    downloadFile(appId: number, depotId: number, file: any, path: string): Promise<void>;
    getProductInfo(apps: number[], packages: number[], inclTokens?: boolean): Promise<any>;
    getManifest(appId: number, depotId: number, manifestId: any, branch: string): Promise<any>;
  }
  export = SteamUser;
}

declare module "vpk" {
  class VPK {
    constructor(path: string);
    load(): void;
    files: string[];
    tree: Record<string, { archiveIndex: number }>;
    getFile(path: string): Buffer;
  }
  export = VPK;
}
