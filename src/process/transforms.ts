import type { Config } from "../config.js";
import type { GameState } from "./parser.js";
import type { TextureRef } from "./texture-parser.js";
import type { TranslationContext } from "./languages.js";
import { $t, $tc } from "./languages.js";
import specialNotes from "./data/special-notes.json" with { type: "json" };
import {
  getWeaponName, isNotWeapon, getCategory, getWears, getDopplerPhase,
  isExclusive, getRarityColor, getCollectibleRarity, skinMarketHashName,
  formatSkinImage, getFinishStyleLink, getGraffitiVariations,
  getPlayerNameOfHighlight, filterUniqueByAttribute, getImageUrl, KNIVES,
} from "./helpers.js";

type TransformFn = (state: GameState, ctx: TranslationContext, config: Config) => any[];

function addSpecialNotes(item: any): any {
  const notes = (specialNotes as Record<string, any[]>)[item.id];
  if (notes) item.special_notes = notes;
  return item;
}

function translateRef(ctx: TranslationContext, item: any): any {
  if (!item) return item;
  const out = { ...item };

  if (typeof out.name === "object" && out.name !== null) {
    const n = out.name;
    const weapon = $t(ctx, n.weapon) ?? n.weapon ?? "";
    const pattern = n.pattern ? ($t(ctx, n.pattern) ?? n.pattern) : "";
    if (n.tKey) {
      const data: Record<string, string> = { item_name: weapon };
      if (pattern) data.pattern = pattern;
      out.name = $tc(ctx, n.tKey, data);
    } else {
      out.name = pattern ? `${weapon} | ${pattern}` : weapon;
    }
  } else if (typeof out.name === "string" && out.name.startsWith("#")) {
    out.name = $t(ctx, out.name) ?? out.name;
  }

  if (typeof out.rarity === "string") {
    const rid = out.rarity;
    out.rarity = { id: rid, name: $t(ctx, rid) ?? rid, color: getRarityColor(rid) };
  }

  return out;
}

function translateRefs(ctx: TranslationContext, items: any[]): any[] {
  return items.map((i) => translateRef(ctx, i));
}

function getTeam(item: any): string | null {
  const classes = item?.used_by_classes;
  if (!classes || typeof classes !== "object") return null;
  const keys = Object.keys(classes);
  if (keys.length === 0) return null;
  if (keys.includes("terrorists") && keys.includes("counter-terrorists")) return "both";
  if (keys.includes("terrorists")) return "terrorists";
  if (keys.includes("counter-terrorists")) return "counter-terrorists";
  return null;
}

function getMaterialPath(pk: any): string | null {
  if (pk.vcompmat) return `/${pk.vcompmat}`;
  if (pk.vmt_path) return `/${pk.vmt_path}`;
  if (pk.name) return `/weapons/paints/legacy/${pk.name}.vcompmat`;
  return null;
}

function getTextures(pk: any, textureMap: Record<string, TextureRef[]>): TextureRef[] {
  const pkName: string = pk.name?.toLowerCase();
  if (!pkName) return [];
  const refs = textureMap[pkName];
  if (!refs) return [];
  return refs.map((t) => ({ type: t.type, file: `/${t.file}` }));
}

function getWeaponImage(weaponId: string): string {
  return `/panorama/images/econ/weapons/base_weapons/${weaponId}_png.png`;
}

// ─── SKINS (grouped by weapon) ───
function skinsTransform(state: GameState, ctx: TranslationContext, config: Config): any[] {
  const { itemsGame, items, paintKits, rarities, stattTrakSkins, souvenirSkins, collectionsBySkins, cratesBySkins, textureMap } = state;
  const weaponIcons = itemsGame.alternate_icons2?.weapon_icons ?? {};
  const result: any[] = [];

  for (const [iconId, iconData] of Object.entries(weaponIcons)) {
    const iconPath = (iconData as any).icon_path;
    const skinId = iconPath?.match(/econ\/default_generated\/(.*?)_light$/i);
    if (!skinId) continue;

    const weapon = getWeaponName(skinId[1]);
    if (!weapon) continue;
    const patternStr = skinId[1].replace(`${weapon}_`, "");
    if (patternStr === "newcs2") continue;

    const pk = paintKits[patternStr.toLowerCase()];
    if (!pk) continue;

    const isKnife = weapon.includes("weapon_knife") || weapon.includes("weapon_bayonet");
    const rarity = !isNotWeapon(weapon)
      ? rarities[`[${patternStr}]${weapon}`]?.rarity ? `rarity_${rarities[`[${patternStr}]${weapon}`].rarity}_weapon` : null
      : isKnife ? "rarity_ancient_weapon" : "rarity_ancient";

    if (!rarity) continue;

    const weaponName = !isNotWeapon(weapon)
      ? $t(ctx, items[weapon]?.item_name_prefab) ?? $t(ctx, items[weapon]?.item_name) ?? weapon
      : $t(ctx, items[weapon]?.item_name) ?? weapon;
    const patternName = $t(ctx, pk.description_tag) ?? patternStr;
    const phase = getDopplerPhase(pk.paint_index);
    const category = getCategory(weapon);
    const wears = getWears(parseFloat(pk.wear_remap_min), parseFloat(pk.wear_remap_max));
    const hasStatTrak = stattTrakSkins[`[${patternStr}]${weapon}`.toLowerCase()] ?? false;
    const hasSouvenir = souvenirSkins[`skin-${iconId}`] ?? false;

    const description = $t(ctx, pk.description_tag) ?? patternStr;
    const weaponItem = items[weapon];
    const team = getTeam(weaponItem);
    const styleId = parseInt(pk.style_id) || 0;

    const item: any = {
      id: `skin-${iconId}`,
      type: "Skin",
      name: `${weaponName} | ${patternName}`,
      description: $t(ctx, weaponItem?.item_description) ?? null,
      weapon: {
        id: weapon,
        name: weaponName,
        weapon_id: weaponItem?.weapon_id ? parseInt(weaponItem.weapon_id) : undefined,
        object_id: weaponItem?.object_id ? parseInt(weaponItem.object_id) : undefined,
        sticker_count: weaponItem?.sticker_count ? parseInt(weaponItem.sticker_count) : undefined,
        image: getWeaponImage(weapon),
      },
      pattern: { id: patternStr, name: patternName },
      category: category ? ($t(ctx, category) ?? category) : null,
      min_float: parseFloat(pk.wear_remap_min),
      max_float: parseFloat(pk.wear_remap_max),
      rarity: { id: rarity, name: $t(ctx, rarity) ?? rarity, color: getRarityColor(rarity) },
      stattrak: hasStatTrak,
      souvenir: hasSouvenir,
      paint_index: pk.paint_index,
      wears: wears.map((w) => ({ id: w, name: $t(ctx, w) ?? w })),
      collections: translateRefs(ctx, collectionsBySkins[`skin-${iconId}`] ?? []),
      crates: translateRefs(ctx, cratesBySkins[`skin-${iconId}`] ?? []),
      market_hash_name: `${$t(ctx, items[weapon]?.item_name_prefab, true) ?? $t(ctx, items[weapon]?.item_name, true) ?? weapon} | ${$t(ctx, pk.description_tag, true) ?? patternStr}`,
      team: team ? { id: team, name: $t(ctx, team) ?? team } : null,
      style: {
        id: styleId,
        name: $t(ctx, pk.style_name) ?? pk.style_name,
        description: $t(ctx, `${pk.style_name}_desc`) ?? null,
      },
      legacy_model: pk.legacy_model,
      vcompmat: getMaterialPath(pk),
      image: getImageUrl(iconPath.toLowerCase()),
      original: { name: weapon },
      textures: getTextures(pk, textureMap),
    };
    if (phase) item.phase = phase;
    addSpecialNotes(item);
    result.push(item);
  }

  // Vanilla knives
  for (const knife of KNIVES) {
    const knifeItem: any = {
      id: `skin-vanilla-${knife.name}`,
      type: "Skin",
      name: isNotWeapon(knife.name)
        ? $tc(ctx, "rare_special_vanilla", { item_name: $t(ctx, knife.item_name) ?? knife.name })
        : $t(ctx, knife.item_name) ?? knife.name,
      weapon: { id: knife.name, name: $t(ctx, knife.item_name) ?? knife.name, image: getWeaponImage(knife.name) },
      pattern: { id: "vanilla", name: "Vanilla" },
      category: $t(ctx, "sfui_invpanel_filter_melee") ?? "Melee",
      rarity: { id: "rarity_ancient_weapon", name: $t(ctx, "rarity_ancient_weapon") ?? "Covert", color: getRarityColor("rarity_ancient_weapon") },
      stattrak: true,
      souvenir: false,
      wears: [],
      collections: [],
      crates: translateRefs(ctx, cratesBySkins[`skin-vanilla-${knife.name}`] ?? []),
      image: getImageUrl(`econ/weapons/base_weapons/${knife.name}`),
    };
    result.push(knifeItem);
  }

  return result;
}

// ─── SKINS NOT GROUPED (individual variants with wear) ───
function skinsNotGroupedTransform(state: GameState, ctx: TranslationContext, config: Config): any[] {
  const { itemsGame, items, paintKits, rarities, stattTrakSkins, souvenirSkins, collectionsBySkins, cratesBySkins, textureMap } = state;
  const weaponIcons = itemsGame.alternate_icons2?.weapon_icons ?? {};
  const result: any[] = [];

  for (const [iconId, iconData] of Object.entries(weaponIcons)) {
    const iconPath = (iconData as any).icon_path;
    const skinId = iconPath?.match(/econ\/default_generated\/(.*?)_light$/i);
    if (!skinId) continue;

    const weapon = getWeaponName(skinId[1]);
    if (!weapon) continue;
    const patternStr = skinId[1].replace(`${weapon}_`, "");
    if (patternStr === "newcs2") continue;

    const pk = paintKits[patternStr.toLowerCase()];
    if (!pk) continue;

    const isKnife = weapon.includes("weapon_knife") || weapon.includes("weapon_bayonet");
    const rarity = !isNotWeapon(weapon)
      ? rarities[`[${patternStr}]${weapon}`]?.rarity ? `rarity_${rarities[`[${patternStr}]${weapon}`].rarity}_weapon` : null
      : isKnife ? "rarity_ancient_weapon" : "rarity_ancient";
    if (!rarity) continue;

    const weaponItem = items[weapon];
    const weaponName = !isNotWeapon(weapon)
      ? $t(ctx, weaponItem?.item_name_prefab) ?? $t(ctx, weaponItem?.item_name) ?? weapon
      : $t(ctx, weaponItem?.item_name) ?? weapon;
    const patternName = $t(ctx, pk.description_tag) ?? patternStr;
    const wears = getWears(parseFloat(pk.wear_remap_min), parseFloat(pk.wear_remap_max));
    const hasStatTrak = stattTrakSkins[`[${patternStr}]${weapon}`.toLowerCase()] ?? false;
    const hasSouvenir = souvenirSkins[`skin-${iconId}`] ?? false;
    const isWeapon = !isNotWeapon(weapon);
    const image = getImageUrl(iconPath.toLowerCase());
    const category = getCategory(weapon);
    const phase = getDopplerPhase(pk.paint_index);
    const team = getTeam(weaponItem);
    const styleId = parseInt(pk.style_id) || 0;
    const description = $t(ctx, weaponItem?.item_description) ?? null;

    const types: string[] = ["skin"];
    if (hasStatTrak) types.push("skin_stattrak");
    if (hasSouvenir) types.push("skin_souvenir");

    for (const type of types) {
      for (let i = 0; i < wears.length; i++) {
        const wear = wears[i];
        const wearName = $t(ctx, wear) ?? wear;
        const isStatTrak = type === "skin_stattrak";
        const isSouvenir = type === "skin_souvenir";
        const suffix = isStatTrak ? "_st" : isSouvenir ? "_so" : "";

        const mhn = skinMarketHashName({
          itemName: weaponName, pattern: patternName, wear: wearName,
          isStatTrak, isSouvenir, isWeapon, isVanilla: false,
        });

        const entry: any = {
          id: `skin-${iconId}_${i}${suffix}`,
          skin_id: `skin-${iconId}`,
          type,
          name: mhn,
          description,
          weapon: {
            id: weapon,
            name: weaponName,
            weapon_id: weaponItem?.weapon_id ? parseInt(weaponItem.weapon_id) : undefined,
            object_id: weaponItem?.object_id ? parseInt(weaponItem.object_id) : undefined,
            sticker_count: weaponItem?.sticker_count ? parseInt(weaponItem.sticker_count) : undefined,
            image: getWeaponImage(weapon),
          },
          category: category ? ($t(ctx, category) ?? category) : null,
          pattern: { id: patternStr, name: patternName },
          min_float: parseFloat(pk.wear_remap_min),
          max_float: parseFloat(pk.wear_remap_max),
          wear: { id: wear, name: wearName },
          stattrak: isStatTrak,
          souvenir: isSouvenir,
          paint_index: pk.paint_index,
          rarity: { id: rarity, name: $t(ctx, rarity) ?? rarity, color: getRarityColor(rarity) },
          collections: translateRefs(ctx, collectionsBySkins[`skin-${iconId}`] ?? []),
          crates: translateRefs(ctx, cratesBySkins[`skin-${iconId}`] ?? []),
          market_hash_name: mhn,
          team: team ? { id: team, name: $t(ctx, team) ?? team } : null,
          style: {
            id: styleId,
            name: $t(ctx, pk.style_name) ?? pk.style_name,
            description: $t(ctx, `${pk.style_name}_desc`) ?? null,
          },
          legacy_model: pk.legacy_model,
          vcompmat: getMaterialPath(pk),
          image: formatSkinImage(image, wear),
          original: { name: weapon },
          textures: getTextures(pk, textureMap),
        };
        if (phase) entry.phase = phase;
        result.push(entry);
      }
    }
  }

  return result;
}

// ─── STICKERS ───
function stickersTransform(state: GameState, ctx: TranslationContext, config: Config): any[] {
  const { stickerKits, collectionsByStickers, cratesBySkins } = state;
  return stickerKits
    .filter((item) => {
      if (!item.sticker_material) return false;
      if (!item.item_name?.toLowerCase().includes("stickerkit_")) return false;
      if (item.item_name?.toLowerCase().includes("spray_")) return false;
      if (typeof item.name === "string" && item.name.includes("spray_")) return false;
      return true;
    })
    .map((item) => {
      const name = $t(ctx, item.item_name) ?? str(item.name);
      const description = $t(ctx, item.description_string);
      const rarity = item.item_rarity ? `rarity_${item.item_rarity}` : "rarity_default";
      const effect = getEffectFromName(name);
      const tournament = item.tournament_event_id ? parseInt(item.tournament_event_id) : undefined;

      return addSpecialNotes({
        id: `sticker-${item.object_id}`,
        type: "Sticker",
        name, description,
        rarity: { id: rarity, name: $t(ctx, rarity) ?? rarity, color: getRarityColor(rarity) },
        effect,
        tournament_event_id: tournament,
        market_hash_name: name,
        image: getImageUrl(`econ/stickers/${item.sticker_material}`),
        collections: translateRefs(ctx, collectionsByStickers[`sticker-${item.object_id}`] ?? []),
        crates: translateRefs(ctx, cratesBySkins[`sticker-${item.object_id}`] ?? []),
      });
    });
}

function str(val: unknown): string {
  if (typeof val === "string") return val;
  if (val == null) return "";
  return String(val);
}

function getEffectFromName(name: unknown): string | null {
  const s = str(name);
  if (!s) return null;
  if (s.includes("(Holo)")) return "Holo";
  if (s.includes("(Foil)")) return "Foil";
  if (s.includes("(Gold)")) return "Gold";
  if (s.includes("(Glitter)")) return "Glitter";
  if (s.includes("(Lenticular)")) return "Lenticular";
  return null;
}

// ─── STICKER SLABS ───
function stickerSlabsTransform(state: GameState, ctx: TranslationContext, config: Config): any[] {
  const { stickerKits, cdnImages } = state;
  return stickerKits
    .filter((item) => {
      if (!item.sticker_material) return false;
      if (!item.item_name?.toLowerCase().includes("stickerkit_")) return false;
      if (typeof item.name === "string" && item.name.includes("spray_")) return false;
      if (item.sticker_material?.startsWith("team_roles_capsule") &&
          item.sticker_material?.endsWith("_foil") &&
          item.sticker_material !== "team_roles_capsule/pro_foil") return false;
      if (["232", "234", "235", "236"].includes(item.object_id)) return false;
      return true;
    })
    .map((item) => {
      const name = $t(ctx, item.item_name) ?? str(item.name);
      const imgKey = `econ/stickers/${item.sticker_material}_1355_37`;
      const image = cdnImages[imgKey] ? getImageUrl(imgKey) : getImageUrl(`econ/stickers/${item.sticker_material}_1355_37`);

      return {
        id: `sticker_slab-${item.object_id}`,
        type: "Sticker Slab",
        name, image,
        rarity: item.item_rarity ? `rarity_${item.item_rarity}` : "rarity_default",
      };
    });
}

// ─── CRATES ───
function cratesTransform(state: GameState, ctx: TranslationContext, config: Config): any[] {
  const { items, prefabs, skinsByCrates, revolvingLootLists } = state;
  const result: any[] = [];

  for (const item of Object.values(items)) {
    if (!isCrate(item, prefabs)) continue;

    const name = $t(ctx, item.item_name) ?? $t(ctx, item.item_name_prefab) ?? str(item.name);
    const description = $t(ctx, item.item_description) ?? $t(ctx, item.item_description_prefab);
    const crateType = getCrateType(item, prefabs);
    if (crateType === null && !item.item_name?.startsWith("#CSGO_storageunit")) continue;

    const firstSaleDate = getFirstSaleDate(item, prefabs);
    const image = item.image_inventory ? getImageUrl(item.image_inventory.toLowerCase()) : null;
    const lootListName = item?.loot_list_name ?? null;
    const attrVal = item.attributes?.["set supply crate series"]?.value ?? null;
    const keyLootList = lootListName ?? revolvingLootLists[attrVal] ?? null;

    const contains = translateRefs(ctx, skinsByCrates?.[item.tags?.ItemSet?.tag_value] ?? skinsByCrates?.[keyLootList] ?? []);
    const containsRare = translateRefs(ctx, skinsByCrates?.[`rare--${keyLootList}`] ?? []);

    result.push(addSpecialNotes({
      id: `crate-${item.object_id}`,
      type: crateType ?? "Case",
      name, description,
      first_sale_date: firstSaleDate,
      image, contains, contains_rare: containsRare,
      market_hash_name: $t(ctx, item.item_name, true) ?? name,
    }));
  }

  return result;
}

function isCrate(item: any, prefabs: any): boolean {
  if (item.attributes?.["set supply crate series"]) return true;
  if (item.item_name?.startsWith("#CSGO_storageunit")) return true;
  if (item.item_name?.startsWith("#CSGO_crate")) return true;
  const prefab = item.prefab ?? "";
  if (prefab.includes("weapon_case") || prefab.includes("sticker_capsule")) return true;
  if (item.loot_list_name) return true;
  return false;
}

function getCrateType(item: any, prefabs: any): string | null {
  const prefab = item.prefab ?? "";
  if (prefab === "weapon_case") return "Case";
  if (prefab === "weapon_case_souvenirpkg" || prefab.includes("_souvenir_crate_promo_prefab")) return "Souvenir";
  if (prefab.includes("sticker_capsule")) return "Sticker Capsule";
  if (prefab === "graffiti_box") return "Graffiti";
  if (typeof item.name === "string" && item.name.startsWith("crate_pins")) return "Pins";
  if (typeof item.name === "string" && item.name.startsWith("crate_musickit")) return "Music Kit Box";
  if (item.item_name?.startsWith("#CSGO_storageunit")) return null;
  if (item.prefab?.includes("keychain")) return "Keychain Capsule";
  return "Case";
}

function getFirstSaleDate(item: any, prefabs: any): string | null {
  if (item.first_sale_date) return item.first_sale_date;
  if (item.prefab && prefabs[item.prefab]?.first_sale_date) return prefabs[item.prefab].first_sale_date;
  return null;
}

// ─── COLLECTIONS ───
function collectionsTransform(state: GameState, ctx: TranslationContext, config: Config): any[] {
  const { itemSets, skinsByCollections, cratesByCollections, items } = state;
  const result: any[] = [];

  for (const itemSet of itemSets) {
    const is = itemSet as any;
    if (!is.is_collection) continue;

    const name = $t(ctx, is.name_force ?? is.name) ?? str(is.name);
    const setKey = (typeof is.name === "string" ? is.name.replace("#CSGO_", "") : "");

    result.push({
      id: `collection-${setKey.replace(/_/g, "-")}`,
      type: "Collection",
      name,
      image: getImageUrl(`econ/set_icons/${setKey}`),
      contains: translateRefs(ctx, skinsByCollections[setKey] ?? []),
      crates: translateRefs(ctx, cratesByCollections[setKey] ?? []),
    });
  }

  // Self-opening collections
  for (const item of Object.values(items)) {
    if (!item.item_name?.startsWith("#CSGO_crate")) continue;
    if (item.item_type !== "self_opening_purchase") continue;
    const prefab = item.prefab ?? "";
    if (!prefab.includes("graffiti") && !prefab.includes("sticker") && !prefab.includes("keychain")) continue;

    result.push({
      id: `collection-${item.object_id}`,
      type: "Collection",
      name: $t(ctx, item.item_name) ?? str(item.name),
      image: item.image_inventory ? getImageUrl(item.image_inventory.toLowerCase()) : null,
    });
  }

  return result;
}

// ─── GRAFFITI ───
function graffitiTransform(state: GameState, ctx: TranslationContext, config: Config): any[] {
  const { stickerKits, collectionsBySkins, cratesBySkins } = state;
  const result: any[] = [];

  for (const item of stickerKits) {
    const isGraffiti = (typeof item.name === "string" && item.name.startsWith("spray_")) ||
      item.item_name?.toLowerCase().startsWith("#spraykit_") ||
      item.sticker_material?.includes("_graffiti");
    if (!isGraffiti) continue;

    const variations = getGraffitiVariations(item.name);
    const indices = variations.length === 0 ? [0]
      : variations[0] === 0 ? Array.from({ length: 19 }, (_, i) => i + 1)
      : variations;

    const baseName = $t(ctx, item.item_name) ?? str(item.name);

    for (const idx of indices) {
      const id = idx === 0 ? `graffiti-${item.object_id}` : `graffiti-${item.object_id}_${idx}`;
      const imageSuffix = idx === 0 ? "" : `_${idx}`;

      result.push(addSpecialNotes({
        id,
        type: "Graffiti",
        name: baseName,
        rarity: item.item_rarity ? `rarity_${item.item_rarity}` : "rarity_default",
        image: getImageUrl(`econ/stickers/${item.sticker_material}${imageSuffix}`),
        collections: translateRefs(ctx, collectionsBySkins[id] ?? []),
        crates: translateRefs(ctx, cratesBySkins[id] ?? []),
      }));
    }
  }

  return result;
}

// ─── MUSIC KITS ───
function musicKitsTransform(state: GameState, ctx: TranslationContext, config: Config): any[] {
  const { musicDefinitions } = state;
  const kitsOnlyStattrak = ["beartooth_02", "blitzkids_01"];
  const result: any[] = [];

  for (const item of musicDefinitions) {
    const exclusive = isExclusive(item.name);

    // Valve kits merge
    let locName = item.loc_name;
    if (item.name === "valve_02") {
      locName = "#musickit_valve_csgo_01";
    }

    const name = exclusive ? ($t(ctx, locName) ?? item.name) : ($t(ctx, item.coupon_name) ?? item.name);
    const description = $t(ctx, item.loc_description);

    if (!kitsOnlyStattrak.includes(item.name)) {
      result.push({
        id: `music_kit-${item.object_id}`,
        type: "Music Kit",
        name, description,
        exclusive,
        image: item.image_inventory ? getImageUrl(item.image_inventory) : null,
        market_hash_name: name,
      });
    }

    // StatTrak version
    result.push({
      id: `music_kit-${item.object_id}_st`,
      type: "Music Kit",
      name: `StatTrak™ ${name}`,
      description,
      exclusive,
      stattrak: true,
      image: item.image_inventory ? getImageUrl(item.image_inventory) : null,
      market_hash_name: `StatTrak™ ${name}`,
    });
  }

  return result;
}

// ─── COLLECTIBLES ───
function collectiblesTransform(state: GameState, ctx: TranslationContext, config: Config): any[] {
  const { items, prefabs } = state;
  return Object.values(items)
    .filter((item) => {
      const in_ = item.item_name ?? "";
      return in_.startsWith("#CSGO_Collectible") || in_.startsWith("#CSGO_TournamentJournal") ||
        in_.startsWith("#CSGO_TournamentPass") || in_.startsWith("#CSGO_Ticket_");
    })
    .map((item) => {
      const name = $t(ctx, item.item_name) ?? str(item.name);
      const description = $t(ctx, item.item_description);
      const type = getCollectibleType(item);
      const prefab = item.prefab ?? "";
      const rarity = getCollectibleRarity(prefab) ?? "rarity_common";

      return addSpecialNotes({
        id: `collectible-${item.object_id}`,
        type: type ?? "Collectible",
        name, description,
        rarity: { id: rarity, name: $t(ctx, rarity) ?? rarity, color: getRarityColor(rarity) },
        image: item.image_inventory ? getImageUrl(item.image_inventory.toLowerCase()) : null,
        market_hash_name: $t(ctx, item.item_name, true) ?? name,
      });
    });
}

function getCollectibleType(item: any): string | null {
  const inv = item.image_inventory ?? "";
  const in_ = item.item_name ?? "";
  if (inv.includes("service_medal")) return "Service Medal";
  if (in_.startsWith("#CSGO_Collectible_Map")) return "Map Contributor Coin";
  if (in_.startsWith("#CSGO_TournamentJournal")) return "Pick'Em Coin";
  if (in_.startsWith("#CSGO_TournamentPass")) return "Tournament Pass";
  if (in_.startsWith("#CSGO_Ticket_")) return "Tournament Pass";
  if (in_.startsWith("#CSGO_Collectible")) return "Collectible Coin";
  return "Collectible";
}

// ─── KEYS ───
function keysTransform(state: GameState, ctx: TranslationContext, config: Config): any[] {
  const { items } = state;
  const result: any[] = [];

  // Generic key
  result.push({
    id: "key-generic",
    type: "Key",
    name: $t(ctx, "csgo_tool_weapon_case_key") ?? "Case Key",
    description: $t(ctx, "csgo_tool_weapon_case_key_desc"),
    image: getImageUrl("econ/tools/crate_key"),
    market_hash_name: $t(ctx, "csgo_tool_weapon_case_key", true) ?? "Case Key",
  });

  for (const item of Object.values(items)) {
    const prefab = item.prefab ?? "";
    if (!prefab.includes("weapon_case_key")) continue;
    if (typeof item.name === "string" && item.name.includes("contestwinner")) continue;
    if (typeof item.name === "string" && item.name.includes("storepromo_key")) continue;

    const name = $t(ctx, item.item_name) ?? str(item.name);

    result.push({
      id: `key-${item.object_id}`,
      type: "Key",
      name,
      description: $t(ctx, item.item_description),
      image: item.image_inventory ? getImageUrl(item.image_inventory.toLowerCase()) : null,
      market_hash_name: $t(ctx, item.item_name, true) ?? name,
    });
  }

  return result;
}

// ─── REGISTRY ───
export const TRANSFORMS: Record<string, TransformFn> = {
  skins: skinsTransform,
  skinsNotGrouped: skinsNotGroupedTransform,
  stickers: stickersTransform,
  stickerSlabs: stickerSlabsTransform,
  crates: cratesTransform,
  collections: collectionsTransform,
  graffiti: graffitiTransform,
  musicKits: musicKitsTransform,
  collectibles: collectiblesTransform,
  keys: keysTransform,
};
