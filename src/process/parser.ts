import fs from "fs";
import path from "path";
import crypto from "crypto";
import { logger } from "../logger.js";
import type { Config } from "../config.js";
import {
  getDopplerPhase,
  getGraffitiVariations,
  isExclusive,
  isNotWeapon,
  getPlayerNameOfHighlight,
  KNIVES,
} from "./helpers.js";
import { buildTextureMap, type TextureRef } from "./texture-parser.js";
import rareSpecials from "./data/rare-specials.json" with { type: "json" };

export interface GameState {
  itemsGame: any;
  prefabs: Record<string, any>;
  items: Record<string, any>;
  itemSets: any[];
  stickerKits: any[];
  stickerKitsObj: Record<string, any>;
  keychainDefinitions: any[];
  keychainDefinitionsObj: Record<string, any>;
  paintKits: Record<string, any>;
  musicDefinitions: any[];
  musicDefinitionsObj: Record<string, any>;
  clientLootLists: Record<string, any>;
  revolvingLootLists: Record<string, any>;
  rarities: Record<string, { rarity: string }>;
  skinsByCrates: Record<string, any[]>;
  cratesBySkins: Record<string, any[]>;
  skinsByCollections: Record<string, any[]>;
  cratesByCollections: Record<string, any[]>;
  collectionsBySkins: Record<string, any[]>;
  collectionsByStickers: Record<string, any[]>;
  souvenirSkins: Record<string, boolean>;
  stattTrakSkins: Record<string, boolean>;
  highlightReels: any[];
  proTeams: Record<string, any>;
  proPlayers: Record<string, any>;
  players: Record<string, string>;
  cdnImages: Record<string, boolean>;
  textureMap: Record<string, TextureRef[]>;
}

function getImageUrl(p: string): string {
  return "/panorama/images/" + p + "_png.png";
}

function sha1(str: string): string {
  return crypto.createHash("sha1").update(str).digest("hex");
}

function filterUniqueByAttribute<T>(items: T[], attr: keyof T): T[] {
  const seen = new Set();
  return items.filter((item) => {
    const val = item[attr];
    if (seen.has(val)) return false;
    seen.add(val);
    return true;
  });
}

function getItemFromKey(state: GameState, key: string): any {
  const { items, itemsGame, rarities, paintKits, stickerKitsObj, musicDefinitionsObj, keychainDefinitionsObj } = state;

  if (key.includes("Commodity Pin")) {
    const pin = items[key];
    if (!pin) return null;
    return { id: `collectible-${pin.object_id}`, name: pin.item_name, rarity: `rarity_${pin.item_rarity}`, image: getImageUrl(pin.image_inventory) };
  }

  if (key.startsWith("customplayer_")) {
    const agent = items[key];
    if (!agent) return null;
    return { id: `agent-${agent.object_id}`, name: agent.item_name, rarity: `rarity_${agent.item_rarity}_character`, image: getImageUrl(`econ/characters/${agent.name.toLocaleLowerCase()}`) };
  }

  const match = key.match(/\[(?<name>.+?)\](?<type>.+)/);
  if (!match?.groups) return null;
  let { name, type } = match.groups;

  if (name === "cu_bizon_Curse") name = name.toLowerCase();

  if (type === "sticker") {
    const s = stickerKitsObj[name];
    if (!s) return null;
    return { id: `sticker-${s.object_id}`, name: s.item_name, rarity: `rarity_${s.item_rarity}`, image: getImageUrl(`econ/stickers/${s.sticker_material?.toLowerCase()}`) };
  }

  if (type === "patch") {
    const p = stickerKitsObj[name];
    if (!p) return null;
    return { id: `patch-${p.object_id}`, name: p.item_name, rarity: `rarity_${p.item_rarity}`, image: getImageUrl(`econ/patches/${p.patch_material}`) };
  }

  if (type === "spray") {
    const g = stickerKitsObj[name];
    if (!g) return null;
    const variations = getGraffitiVariations(name);
    const indices = variations[0] === 0 ? Array.from({ length: 19 }, (_, i) => i + 1) : variations;
    if (indices.length > 0) {
      return indices.map((i) => ({
        id: `graffiti-${g.object_id}_${i}`,
        name: g.item_name,
        rarity: `rarity_${g.item_rarity}`,
        image: getImageUrl(`econ/stickers/${g.sticker_material}_${i}`),
      }));
    }
    return { id: `graffiti-${g.object_id}`, name: g.item_name, rarity: `rarity_${g.item_rarity}`, image: getImageUrl(`econ/stickers/${g.sticker_material}`) };
  }

  if (type === "musickit") {
    const kit = musicDefinitionsObj[name];
    if (!kit) return null;
    const exclusive = isExclusive(kit.name);
    return { id: `music_kit-${kit.object_id}`, name: exclusive ? kit.loc_name : kit.coupon_name, rarity: "rarity_rare", image: getImageUrl(kit.image_inventory) };
  }

  if (type === "keychain") {
    const kc = keychainDefinitionsObj[name];
    if (!kc) return null;
    return { id: `keychain-${kc.object_id}`, name: kc.loc_name, rarity: `rarity_${kc.item_rarity}`, image: getImageUrl(kc.image_inventory?.toLowerCase()) };
  }

  if (type.includes("weapon_") || ["studded_bloodhound_gloves", "slick_gloves", "leather_handwraps", "motorcycle_gloves", "specialist_gloves", "sporty_gloves", "studded_hydra_gloves", "studded_brokenfang_gloves"].includes(type)) {
    const isKnife = type.includes("weapon_knife") || type.includes("weapon_bayonet");
    const rarity = !isNotWeapon(type)
      ? `rarity_${rarities[key.toLocaleLowerCase()]?.rarity}_weapon`
      : isKnife ? "rarity_ancient_weapon" : "rarity_ancient";

    if (name === "vanilla") {
      const knife = KNIVES.find((k) => k.name === type);
      if (!knife) return null;
      return { id: `skin-vanilla-${type}`, name: { tKey: "rare_special_vanilla", weapon: knife.item_name }, rarity, image: getImageUrl(`econ/weapons/base_weapons/${knife.name}`) };
    }

    const weaponIcons = Object.entries(itemsGame.alternate_icons2?.weapon_icons ?? {}).find(([, v]: any) =>
      v.icon_path?.includes(`${type}_${name}_light`)
    );
    if (!weaponIcons) return null;

    const pk = paintKits[name.toLowerCase()];
    if (!pk) return null;

    return {
      id: `skin-${weaponIcons[0]}`,
      name: {
        ...(isNotWeapon(type) && { tKey: "rare_special" }),
        weapon: (items[type]?.item_name_prefab ?? items[type]?.item_name ?? "").replace("#", ""),
        pattern: pk.description_tag?.replace("#", ""),
      },
      rarity,
      paint_index: pk.paint_index,
      phase: getDopplerPhase(pk.paint_index),
      image: getImageUrl((weaponIcons[1] as any).icon_path?.toLowerCase()),
    };
  }

  return null;
}

export function loadGameState(config: Config): GameState {
  logger.step("Process: loading game state");

  const dataDir = path.resolve(config.paths.data, "output");
  const itemsGamePath = path.join(dataDir, "scripts", "items", "items_game.json");

  if (!fs.existsSync(itemsGamePath)) {
    throw new Error(`items_game.json not found: ${itemsGamePath}. Run 'download' first.`);
  }

  const rawItemsGame = JSON.parse(fs.readFileSync(itemsGamePath, "utf-8"));
  const itemsGame = rawItemsGame.items_game ?? rawItemsGame;

  // Patch item_sets with collection packs from client_loot_lists
  const sets: Record<string, { type: string; items: Record<string, any> }> = {};
  if (itemsGame.client_loot_lists) {
    for (const [key, value] of Object.entries(itemsGame.client_loot_lists)) {
      const match = key.match(/^(sticker_pack_|keychain_pack_)(.+)_(.+)$/);
      if (match && Object.keys(value as any)[0]?.includes("[")) {
        const setName = match[2];
        if (!(setName in sets)) sets[setName] = { type: match[1], items: {} };
        sets[setName].items = { ...sets[setName].items, ...(value as any) };
      }
    }
    for (const [key, val] of Object.entries(sets)) {
      let keyTranslation = key;
      if (keyTranslation === "community_2025") keyTranslation = "community2025";
      itemsGame.item_sets[`set_${key}`] = {
        name: `#CSGO_set_${key}`,
        name_force: `#CSGO_crate_${val.type}${keyTranslation}_capsule`,
        set_description: `#CSGO_crate_${val.type}${keyTranslation}_capsule_desc`,
        is_collection: 1,
        items: val.items,
      };
    }
  }

  // Load default_generated images list
  const defaultGenPath = path.join(
    config.paths.output,
    "panorama", "images", "econ", "default_generated"
  );
  let cdnImages: Record<string, boolean> = {};
  const defaultGenJsonPath = path.join(dataDir, "scripts", "items", "default_generated.json");
  if (fs.existsSync(defaultGenJsonPath)) {
    const imgs: string[] = JSON.parse(fs.readFileSync(defaultGenJsonPath, "utf-8"));
    for (const img of imgs) {
      const key = `econ/default_generated/${img.replace("_png.png", "")}`;
      cdnImages[key] = true;
    }
  }
  // Build weapon_icons from CDN images if not already present
  if (!itemsGame.alternate_icons2?.weapon_icons || Object.keys(itemsGame.alternate_icons2.weapon_icons).length === 0) {
    if (fs.existsSync(defaultGenPath)) {
      const files = fs.readdirSync(defaultGenPath).filter((f: string) => f.includes("light_png"));
      if (!itemsGame.alternate_icons2) itemsGame.alternate_icons2 = {};
      itemsGame.alternate_icons2.weapon_icons = files
        .filter((f: string) => !f.includes("pet_hen_1_hen"))
        .reduce((acc: any, item: string) => {
          const key = sha1(item.replace("_light_png.png", "")).slice(0, 12);
          acc[key] = { icon_path: `econ/default_generated/${item.replace("_png.png", "")}` };
          return acc;
        }, {});
    }
  }

  // Prefabs
  const prefabs: Record<string, any> = {};
  for (const [key, value] of Object.entries(itemsGame.prefabs ?? {})) {
    const v = value as any;
    const inner = itemsGame.prefabs?.[v?.prefab];
    prefabs[key] = {
      item_name: v.item_name ?? inner?.item_name,
      item_description: v.item_description ?? inner?.item_description,
      first_sale_date: v.first_sale_date ?? inner?.first_sale_date ?? null,
      prefab: v.prefab ?? inner?.prefab,
      used_by_classes: v.used_by_classes,
    };
  }

  // Items
  const items: Record<string, any> = {};
  for (const [key, value] of Object.entries(itemsGame.items ?? {})) {
    const v = value as any;
    items[v.name] = {
      ...v,
      object_id: key,
      item_name: v.item_name,
      item_description: v.item_description,
      item_name_prefab: prefabs[v.prefab]?.item_name,
      item_description_prefab: prefabs[v.prefab]?.item_description,
      used_by_classes: v?.used_by_classes ?? prefabs[v.prefab]?.used_by_classes,
    };
  }

  // Item sets
  const itemSets = Object.values(itemsGame.item_sets ?? {});

  // Sticker kits
  const stickerKits = Object.entries(itemsGame.sticker_kits ?? {}).map(([key, item]: any) => {
    if (item.name === "comm01_howling_dawn") item.item_rarity = "contraband";
    return { ...item, object_id: key };
  });
  const stickerKitsObj = Object.fromEntries(stickerKits.map((s) => [s.name, s]));

  // Players
  const players: Record<string, string> = {};
  for (const [id, player] of Object.entries(itemsGame.pro_players ?? {})) {
    players[id] = (player as any).name?.toString() ?? "";
  }

  // Keychain definitions
  const keychainDefinitions = Object.entries(itemsGame.keychain_definitions ?? {}).map(([key, item]: any) => ({
    ...item, object_id: key,
  }));
  const keychainDefinitionsObj = Object.fromEntries(keychainDefinitions.map((k) => [k.name, k]));

  // Paint kits
  const paintKits: Record<string, any> = {};
  for (const [key, item] of Object.entries(itemsGame.paint_kits ?? {})) {
    const v = item as any;
    if (v.description_tag !== undefined) {
      paintKits[v.name.toLowerCase()] = {
        name: v.name,
        description_tag: v.description_tag,
        wear_remap_min: v.wear_remap_min ?? 0.06,
        wear_remap_max: v.wear_remap_max ?? 0.8,
        paint_index: key,
        style_id: v.style ?? 0,
        style_name: `SFUI_ItemInfo_FinishStyle_${v.style ?? 0}`,
        legacy_model: !!v.use_legacy_model,
        vcompmat: v.composite_material_path ?? null,
        vmt_path: v.vmt_path ?? null,
      };
    }
  }

  // Music definitions
  const musicDefinitions = Object.entries(itemsGame.music_definitions ?? {}).map(([key, item]: any) => ({
    ...item, object_id: key, coupon_name: `coupon_${item.name}`,
  }));
  const musicDefinitionsObj = Object.fromEntries(musicDefinitions.map((m) => [m.name, m]));

  const clientLootLists = itemsGame.client_loot_lists ?? {};
  const revolvingLootLists = itemsGame.revolving_loot_lists ?? {};

  // Rarities
  const hardCodedRarities: Record<string, { rarity: string }> = {
    "[cu_m4a1_howling]weapon_m4a1": { rarity: "contraband" },
    "[cu_retribution]weapon_elite": { rarity: "rare" },
    "[cu_mac10_decay]weapon_mac10": { rarity: "mythical" },
    "[cu_p90_scorpius]weapon_p90": { rarity: "rare" },
    "[hy_labrat_mp5]weapon_mp5sd": { rarity: "mythical" },
    "[cu_xray_p250]weapon_p250": { rarity: "mythical" },
    "[cu_usp_spitfire]weapon_usp_silencer": { rarity: "legendary" },
    "[am_nitrogen]weapon_cz75a": { rarity: "rare" },
  };
  const raritySet = new Set(["common", "uncommon", "rare", "mythical", "legendary", "ancient"]);
  const rarities: Record<string, { rarity: string }> = { ...hardCodedRarities };
  for (const [name, keys] of Object.entries(clientLootLists)) {
    const r = name.split("_").pop()!;
    if (raritySet.has(r)) {
      for (const key of Object.keys(keys as any)) {
        if (key.includes("[")) rarities[key.toLowerCase()] = { rarity: r };
      }
    }
  }

  // Build texture map by parsing vmat/vcompmat material files
  const textureMap = buildTextureMap(config.paths.output, paintKits);

  // Build state
  const state: GameState = {
    itemsGame, prefabs, items, itemSets, stickerKits, stickerKitsObj,
    keychainDefinitions, keychainDefinitionsObj, paintKits,
    musicDefinitions, musicDefinitionsObj, clientLootLists, revolvingLootLists,
    rarities, skinsByCrates: {}, cratesBySkins: {}, skinsByCollections: {},
    cratesByCollections: {}, collectionsBySkins: {}, collectionsByStickers: {},
    souvenirSkins: {}, stattTrakSkins: {}, highlightReels: [], proTeams: {},
    proPlayers: {}, players, cdnImages, textureMap,
  };

  // Helper to extract items from loot lists recursively
  function extractItems(key: string, lootLists: Record<string, any>): Record<string, any> {
    const current = lootLists[key] ?? {};
    let result: Record<string, any> = {};
    for (const subKey of Object.keys(current)) {
      if (subKey.includes("[") || subKey.includes("Commodity Pin")) {
        result[subKey] = current[subKey];
      }
      result = { ...result, ...extractItems(subKey, lootLists) };
    }
    return result;
  }

  function extractRareItems(key: string, lootLists: Record<string, any>): string[] {
    const current = lootLists[key] ?? {};
    for (const subKey of Object.keys(current)) {
      if ((rareSpecials as any)[subKey]) {
        return Object.keys((rareSpecials as any)[subKey]);
      }
    }
    return [];
  }

  // Skins by crates
  const skinsByCrates: Record<string, any[]> = {};
  for (const [, item] of Object.entries(revolvingLootLists)) {
    const lootKey = item as string;
    if (lootKey === "crate_dhw13_promo") {
      skinsByCrates[lootKey] = ["set_dust_2", "set_safehouse", "set_italy", "set_lake", "set_train", "set_mirage"]
        .flatMap((s) => Object.keys(extractItems(s, clientLootLists)).map((k) => getItemFromKey(state, k)).filter(Boolean));
      const revolver = getItemFromKey(state, "[sp_tape]weapon_revolver");
      if (revolver) skinsByCrates[lootKey].push(revolver);
      continue;
    }
    if (lootKey === "crate_ems14_promo") {
      skinsByCrates[lootKey] = ["set_dust_2", "set_safehouse", "set_italy", "set_lake", "set_train", "set_mirage"]
        .flatMap((s) => Object.keys(extractItems(s, clientLootLists)).map((k) => getItemFromKey(state, k)).filter(Boolean));
      continue;
    }
    const extracted = Object.keys(extractItems(lootKey, clientLootLists)).map((k) => getItemFromKey(state, k)).filter(Boolean).flat();
    if (lootKey.includes("_stattrak_") && lootKey.includes("musickit")) {
      skinsByCrates[lootKey] = extracted.map((i: any) => ({ ...i, id: `${i.id}_st`, name: `${i.name}_stattrak` }));
    } else {
      skinsByCrates[lootKey] = extracted;
    }
  }
  skinsByCrates["set_xraymachine"] = [getItemFromKey(state, "[cu_xray_p250]weapon_p250")].filter(Boolean);

  // Rare specials
  for (const [, item] of Object.entries(revolvingLootLists)) {
    const lootKey = item as string;
    skinsByCrates[`rare--${lootKey}`] = extractRareItems(lootKey, clientLootLists).map((k) => getItemFromKey(state, k)).filter(Boolean).flat();
  }
  state.skinsByCrates = skinsByCrates;

  // Crates by skins
  const hardCodedCrates: Record<string, any> = {
    set_xraymachine: { object_id: 4668, item_name: "#CSGO_set_xraymachine", image_inventory: "econ/weapon_cases/crate_xray_p250" },
  };
  const cratesBySkins: Record<string, any[]> = {};
  for (const [crateKey, itemsList] of Object.entries(skinsByCrates)) {
    const cleanKey = crateKey.replace("rare--", "");
    for (const item of itemsList) {
      if (!item?.id) continue;
      if (!(item.id in cratesBySkins)) cratesBySkins[item.id] = [];
      const lootList = Object.entries(revolvingLootLists).find(([, v]) => v === cleanKey);
      const crateItem = hardCodedCrates[cleanKey] ?? items[cleanKey] ??
        Object.values(items).find((i: any) => i.attributes?.["set supply crate series"]?.value == lootList?.[0]);
      if (crateItem) {
        cratesBySkins[item.id].push({
          id: `crate-${crateItem.object_id}`,
          name: crateItem.item_name,
          image: getImageUrl(crateItem?.image_inventory?.toLowerCase()),
        });
      }
    }
  }
  state.cratesBySkins = cratesBySkins;

  // Skins by collections
  const skinsByCollections: Record<string, any[]> = {};
  for (const [key, value] of Object.entries(itemsGame.item_sets ?? {})) {
    skinsByCollections[key] = Object.keys((value as any).items ?? {})
      .map((k) => getItemFromKey(state, k))
      .filter(Boolean)
      .flat();
  }
  state.skinsByCollections = skinsByCollections;

  // Crates by collections
  const cratesByCollections: Record<string, any[]> = {};
  for (const [collection, colItems] of Object.entries(skinsByCollections)) {
    const ids = [...new Set(colItems.map((i: any) => i.id))];
    const crates = ids.flatMap((id) => cratesBySkins[id] ?? []);
    cratesByCollections[collection] = filterUniqueByAttribute(crates, "id" as any);
  }
  state.cratesByCollections = cratesByCollections;

  // Collections by skins
  const collectionsBySkins: Record<string, any[]> = {};
  for (const [crateKey, colItems] of Object.entries(skinsByCollections)) {
    const cleanKey = crateKey.replace("rare--", "");
    for (const item of colItems) {
      if (!item?.id) continue;
      if (!(item.id in collectionsBySkins)) collectionsBySkins[item.id] = [];
      const crateItem = itemsGame.item_sets?.[cleanKey];
      if (crateItem) {
        collectionsBySkins[item.id].push({
          id: `collection-${crateItem.name.replace("#CSGO_", "").replace(/_/g, "-")}`,
          name: crateItem.name_force ?? crateItem.name,
          image: getImageUrl(`econ/set_icons/${crateItem.name.replace("#CSGO_", "")}`),
        });
      }
    }
  }
  state.collectionsBySkins = collectionsBySkins;

  // Collections by stickers
  const collectionsByStickers: Record<string, any[]> = {};
  for (const [colKey, itemSet] of Object.entries(itemsGame.item_sets ?? {})) {
    const is = itemSet as any;
    if (!is.is_collection) continue;
    const stickerKeys = Object.keys(is.items ?? {}).filter((k: string) => k.includes("[") && k.includes("]sticker"));
    for (const sKey of stickerKeys) {
      const stickerItem = getItemFromKey(state, sKey);
      if (stickerItem?.id) {
        if (!(stickerItem.id in collectionsByStickers)) collectionsByStickers[stickerItem.id] = [];
        const fileName = colKey.replace("set_", "");
        collectionsByStickers[stickerItem.id].push({
          id: `collection-set-${fileName.replace(/_/g, "-")}`,
          name: is.name_force ?? is.name,
          image: getImageUrl(`econ/set_icons/set_${fileName}`),
        });
      }
    }
  }
  state.collectionsByStickers = collectionsByStickers;

  // Souvenir skins
  const souvenirSkins: Record<string, boolean> = { "skin-e73d6e7e9004": true };
  for (const item of Object.values(items)) {
    if (item.prefab === "weapon_case_souvenirpkg" || item.prefab?.includes("_souvenir_crate_promo_prefab")) {
      const lootListName = item?.loot_list_name ?? null;
      const attrVal = item.attributes?.["set supply crate series"]?.value ?? null;
      const keyLootList = lootListName ?? revolvingLootLists[attrVal] ?? null;
      const souvenirItems = skinsByCrates?.[item.tags?.ItemSet?.tag_value] ?? skinsByCrates?.[keyLootList] ?? [];
      for (const si of souvenirItems) {
        if (si?.id) souvenirSkins[si.id] = true;
      }
    }
  }
  state.souvenirSkins = souvenirSkins;

  // StatTrak skins
  const stattTrakSkins: Record<string, boolean> = {
    "[cu_m4a1_howling]weapon_m4a1": true,
    "[cu_xray_p250]weapon_p250": true,
  };
  const caseCollections: Record<string, boolean> = {};
  for (const item of Object.values(items)) {
    const prefab = (item.prefab || "").split(" ");
    if (prefab.includes("weapon_case") || prefab.includes("volatile_pricing") || prefab.includes("volatile_pricing_gloves")) {
      const name = item?.tags?.ItemSet?.tag_value;
      if (name) caseCollections[name] = true;
    }
  }
  const skipCollections = ["#CSGO_set_dust_2_2021"];
  for (const itemSet of itemSets) {
    const is = itemSet as any;
    if (is.is_collection && !skipCollections.includes(is.name)) {
      for (const key of Object.keys(is.items ?? {})) {
        if (caseCollections[is.name.replace("#CSGO_", "")] !== undefined) {
          stattTrakSkins[key.toLocaleLowerCase()] = true;
        }
      }
    }
  }
  state.stattTrakSkins = stattTrakSkins;

  // Highlight reels
  const highlightReels: any[] = [];
  for (const [, item] of Object.entries(itemsGame.highlight_reels ?? {})) {
    const h = item as any;
    const tStr = String(h["tournament event id"]).padStart(3, "0");
    const mStr = `${String(h["tournament event team0 id"]).padStart(3, "0")}v${String(h["tournament event team1 id"]).padStart(3, "0")}_${String(h["tournament event stage id"]).padStart(3, "0")}`;
    highlightReels.push({
      id: h.id,
      tournament_event_id: h["tournament event id"],
      tournament_event_team0_id: h["tournament event team0 id"],
      tournament_event_team1_id: h["tournament event team1 id"],
      tournament_event_stage_id: h["tournament event stage id"],
      tournament_event_map: h.map,
      tournament_player: getPlayerNameOfHighlight(h.id, players),
      image: getImageUrl(`econ/keychains/${h.id.split("_")[0]}/kc_${h.id.split("_")[0]}`),
      video: `https://cdn.steamstatic.com/apps/csgo/videos/highlightreels/${tStr}/${mStr}/${tStr}_${mStr}_${h.map}_${h.id}_ww_1080p.webm`,
      thumbnail: `/highlights/thumbnails/${h.id.split("_")[0]}/${h.id}_ww.jpg`,
    });
  }
  state.highlightReels = highlightReels;

  // Pro teams
  const proTeams: Record<string, any> = {};
  for (const [id, item] of Object.entries(itemsGame.pro_teams ?? {})) {
    const t = item as any;
    proTeams[id] = { id: parseInt(id), tag: t.tag, geo: t.geo };
  }
  state.proTeams = proTeams;

  // Pro players
  const proPlayers: Record<string, any> = {};
  for (const [id, item] of Object.entries(itemsGame.pro_players ?? {})) {
    const p = item as any;
    proPlayers[id] = { id: parseInt(id), name: p.name, code: p.code, dob: p.dob, geo: p.geo };
  }
  state.proPlayers = proPlayers;

  logger.success("Game state loaded");
  return state;
}
