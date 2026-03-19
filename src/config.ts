import fs from "fs";
import path from "path";
import { parse as parseYaml } from "yaml";

export interface ExtractTarget {
  type: string;
  filter: string;
  format: string;
  enabled: boolean;
  extension?: string;
  extra_args?: string[];
}

export interface ThumbnailSource {
  name: string;
  url: string;
  languages: string[];
}

export interface ItemFieldDef {
  key?: string;
  value?: string;
  template?: string;
  translate?: boolean;
  prefix?: string;
  nested?: string;
  first_key?: boolean;
  transform?: string;
  locale_aware?: boolean;
}

export interface StaticItemDef {
  id: string;
  name_key: string;
  description_key: string;
  image: string;
}

export interface ItemTypeDef {
  enabled: boolean;
  source: string;
  filter?: Record<string, unknown>;
  fields?: Record<string, ItemFieldDef>;
  static_items?: StaticItemDef[];
  static_items_file?: string;
}

export interface TransformDef {
  enabled: boolean;
  transform: string;
}

export interface Config {
  steam: {
    anonymous: boolean;
    username?: string;
    password?: string;
  };
  depot: {
    id: number;
    app_id: number;
  };
  paths: {
    data: string;
    output: string;
  };
  download: {
    force: boolean;
    verify_checksums: boolean;
    parallel_archives: number;
  };
  extract: {
    source2_cli: string;
    threads: number;
    parallel: number;
    vpk_cache: boolean;
    targets: ExtractTarget[];
  };
  thumbnails: {
    enabled: boolean;
    format: string;
    seek_time: number;
    sources: ThumbnailSource[];
  };
  languages: string[];
  process: {
    group: boolean;
    cdn_url: string;
    item_types: Record<string, ItemTypeDef>;
    transforms: Record<string, TransformDef>;
  };
}

const DEFAULT_CONFIG: Config = {
  steam: { anonymous: true },
  depot: { id: 2347770, app_id: 730 },
  paths: { data: "./data", output: "./output" },
  download: {
    force: false,
    verify_checksums: false,
    parallel_archives: 4,
  },
  extract: {
    source2_cli: "./bin/Source2Viewer-CLI",
    threads: 8,
    parallel: 4,
    vpk_cache: true,
    targets: [
      { type: "images", filter: "panorama/images/econ", format: "png", enabled: true },
      { type: "images", filter: "panorama/images/backgrounds", format: "png", enabled: true },
      { type: "textures", filter: "materials/models/weapons/customization/paints", format: "png", enabled: true },
      { type: "textures", filter: "materials/models/weapons/customization/paints_gloves", format: "png", enabled: true },
      { type: "textures", filter: "items/assets", format: "png", enabled: true },
      { type: "textures", filter: "weapons", format: "png", enabled: true },
      { type: "textures", filter: "materials/default", format: "png", enabled: true },
      { type: "textures", filter: "materials/models/weapons/customization/shared", format: "png", enabled: true },
      { type: "materials", filter: "materials/models/weapons/customization/paints", format: "vmat", enabled: true },
      { type: "composites", filter: "weapons/paints", format: "vcompmat", enabled: true },
      { type: "sounds", filter: "sounds/music", format: "wav", enabled: false },
      { type: "models", filter: "weapons", format: "gltf", enabled: false, extra_args: ["--gltf_textures_adapt", "--gltf_export_materials", "--gltf_export_extras"] },
      { type: "models", filter: "materials/models/weapons", format: "gltf", enabled: false, extension: "", extra_args: ["--gltf_textures_adapt", "--gltf_export_materials", "--gltf_export_extras"] },
      { type: "models", filter: "characters", format: "gltf", enabled: false, extra_args: ["--gltf_textures_adapt", "--gltf_export_materials", "--gltf_export_extras"] },
      { type: "models", filter: "models/chicken", format: "gltf", enabled: false, extra_args: ["--gltf_textures_adapt", "--gltf_export_materials", "--gltf_export_extras"] },
      { type: "models", filter: "stickers", format: "gltf", enabled: false, extra_args: ["--gltf_textures_adapt", "--gltf_export_materials", "--gltf_export_extras"] },
    ],
  },
  thumbnails: {
    enabled: true,
    format: "webp",
    seek_time: 3,
    sources: [
      { name: "highlights", url: "https://pricempire.com/api/highlights", languages: ["en", "zh-CN"] },
    ],
  },
  languages: ["all"],
  process: {
    group: true,
    cdn_url: "https://cs2-cdn.pricempire.com/",
    item_types: {
      agents: {
        enabled: true,
        source: "items",
        filter: { prefab: { equals: "customplayertradable" } },
        fields: {
          id: { template: "agent-{sha:name}" },
          type: { value: "Agent" },
          name: { key: "item_name", translate: true },
          description: { key: "description_string", translate: true },
          rarity: { key: "item_rarity", prefix: "rarity_" },
          team: { nested: "used_by_classes", first_key: true },
          image: { key: "image_inventory", transform: "cdn_image" },
          model_player: { key: "model_player" },
        },
      },
      patches: {
        enabled: true,
        source: "sticker_kits",
        filter: {
          patch_material: { exists: true },
          exclude: { patch_material: ["case_skillgroups/patch_legendaryeagle"] },
        },
        fields: {
          id: { template: "patch-{object_id}" },
          type: { value: "Patch" },
          name: { key: "item_name", translate: true },
          description: { key: "description_string", translate: true },
          rarity: { key: "item_rarity", prefix: "rarity_" },
          image: { key: "patch_material", transform: "patch_image" },
        },
      },
      keychains: {
        enabled: true,
        source: "keychain_definitions",
        filter: {
          loc_name: { starts_with: "#keychain_" },
          "is commodity": { not_exists: true },
        },
        fields: {
          id: { template: "keychain-{object_id}" },
          type: { value: "Keychain" },
          name: { key: "loc_name", translate: true },
          description: { key: "loc_description", translate: true },
          rarity: { key: "item_rarity", prefix: "rarity_" },
          image: { key: "image_inventory", transform: "cdn_image" },
        },
      },
      highlights: {
        enabled: true,
        source: "highlight_reels",
        fields: {
          id: { template: "highlight-{id}" },
          type: { value: "Highlight" },
          name: { key: "loc_name", translate: true },
          image: { key: "image_inventory", transform: "cdn_image" },
          video: { key: "video", locale_aware: true },
        },
      },
      tools: {
        enabled: true,
        source: "static",
        static_items: [
          { id: "tool-1", name_key: "csgo_tool_name_tag", description_key: "csgo_tool_name_tag_desc", image: "econ/tools/tag" },
          { id: "tool-2", name_key: "csgo_tool_casket_tag", description_key: "csgo_tool_casket_tag_desc", image: "econ/tools/casket" },
          { id: "tool-3", name_key: "csgo_tool_stattrak_swap", description_key: "csgo_tool_stattrak_swap_desc", image: "econ/tools/stattrak_swap_tool" },
          { id: "tool-4", name_key: "csgo_tool_keychain_tool", description_key: "csgo_tool_keychain_tool_desc", image: "econ/tools/keychain_tool" },
        ],
      },
      base_weapons: {
        enabled: true,
        source: "static",
        static_items_file: "data/base-weapons.json",
      },
    },
    transforms: {
      skins: { enabled: true, transform: "skins" },
      skins_not_grouped: { enabled: true, transform: "skinsNotGrouped" },
      stickers: { enabled: true, transform: "stickers" },
      sticker_slabs: { enabled: true, transform: "stickerSlabs" },
      crates: { enabled: true, transform: "crates" },
      collections: { enabled: true, transform: "collections" },
      graffiti: { enabled: true, transform: "graffiti" },
      music_kits: { enabled: true, transform: "musicKits" },
      collectibles: { enabled: true, transform: "collectibles" },
      keys: { enabled: true, transform: "keys" },
    },
  },
};

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === "object" &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === "object" &&
      !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(
        target[key] as Record<string, unknown>,
        source[key] as Record<string, unknown>
      );
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

export function loadConfig(configPath?: string): Config {
  let userConfig: Record<string, unknown> = {};

  const filesToTry = configPath
    ? [configPath]
    : ["config.yaml", "config.yml", "config.default.yaml"];

  for (const file of filesToTry) {
    const resolved = path.resolve(file);
    if (fs.existsSync(resolved)) {
      const raw = fs.readFileSync(resolved, "utf-8");
      userConfig = parseYaml(raw) ?? {};
      break;
    }
  }

  const envOverrides: Record<string, unknown> = {};
  if (process.env.STEAM_USERNAME) {
    envOverrides.steam = { anonymous: false, username: process.env.STEAM_USERNAME, password: process.env.STEAM_PASSWORD };
  }
  if (process.env.FORCE_DOWNLOAD === "true") {
    envOverrides.download = { force: true };
  }

  const merged = deepMerge(
    deepMerge(DEFAULT_CONFIG as unknown as Record<string, unknown>, userConfig),
    envOverrides
  );

  return merged as unknown as Config;
}

export function applyCliOverrides(config: Config, overrides: Record<string, string>): Config {
  const raw = config as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(overrides)) {
    const parts = key.split(".");
    let obj = raw;
    for (let i = 0; i < parts.length - 1; i++) {
      if (typeof obj[parts[i]] !== "object" || obj[parts[i]] === null) {
        obj[parts[i]] = {};
      }
      obj = obj[parts[i]] as Record<string, unknown>;
    }
    const lastKey = parts[parts.length - 1];
    if (value === "true") obj[lastKey] = true;
    else if (value === "false") obj[lastKey] = false;
    else if (!isNaN(Number(value))) obj[lastKey] = Number(value);
    else obj[lastKey] = value;
  }
  return raw as unknown as Config;
}
