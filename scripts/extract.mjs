#!/usr/bin/env node
// Reads the five guide files and the planner in source/ and writes typed data
// files into src/data/, plus supabase/seed.sql. Nothing here is hand copied:
// every name, description, price and address is pulled out of the HTML. The only
// judgement encoded in this file is classification (which card is a sight and
// which is an activity, which district a place sits in) plus the small text
// trims noted inline.
//
// Run with: npm run extract

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, byClass, byTag, text, classes } from './lib/minidom.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'source');
const OUT = join(ROOT, 'src', 'data');

const warnings = [];
const warn = (topic, detail) => warnings.push({ topic, detail });

// ---------------------------------------------------------------- utilities

const CJK = /[㐀-鿿豈-﫿]/;

function slug(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const usedIds = new Set();
function uniqueId(preferred, fallback) {
  let base = slug(preferred) || slug(fallback) || 'place';
  if (!base) base = 'place';
  let id = base;
  let n = 2;
  while (usedIds.has(id)) id = `${base}-${n++}`;
  usedIds.add(id);
  return id;
}

const WORD_NUMBERS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

/**
 * Pull a price range out of the free text the guides use. Returns
 * { min, max } with either side possibly undefined, plus `ok` when the string
 * carried no usable number at all.
 */
function parsePrice(raw) {
  if (!raw) return { ok: false };
  const s = raw.replace(/[–—]/g, '-').replace(/\bto\b/g, '-');
  if (/^\s*(free)\b/i.test(s.trim())) return { ok: true, min: 0, max: 0 };

  const range = s.match(/¥\s*([\d,]+)\s*-\s*¥?\s*([\d,]+)/);
  if (range) {
    return { ok: true, min: num(range[1]), max: num(range[2]) };
  }
  const openEnded = s.match(/¥\s*([\d,]+)\s*\+/);
  if (openEnded) return { ok: true, min: num(openEnded[1]) };

  const single = s.match(/¥\s*([\d,]+)/);
  if (single) {
    const v = num(single[1]);
    return { ok: true, min: v, max: v };
  }
  if (/\bfree\b/i.test(s)) return { ok: true, min: 0, max: 0 };
  return { ok: false };
}

const num = (s) => Number(String(s).replace(/,/g, ''));

/** "1–2 hours", "~1 hour", "two hours" -> minutes. Longest reading wins. */
function parseDuration(raw) {
  if (!raw) return undefined;
  const s = raw.replace(/[–—]/g, '-');
  const numeric = s.match(/(\d+)\s*(?:-\s*(\d+)\s*)?hours?/i);
  if (numeric) return (numeric[2] ? Number(numeric[2]) : Number(numeric[1])) * 60;
  const worded = s.match(/\b(one|two|three|four|five|six)\s+hours?\b/i);
  if (worded) return WORD_NUMBERS[worded[1].toLowerCase()] * 60;
  const mins = s.match(/(\d+)\s*(?:-\s*(\d+)\s*)?min/i);
  if (mins) return mins[2] ? Number(mins[2]) : Number(mins[1]);
  return undefined;
}

/** "Peak Racing (极烽赛车)" / "魔方剧情密室 (Cube Story)" -> { zh, en }. */
function splitName(title) {
  const bracketed = title.match(/^(.*?)\s*[（(]([^)）]+)[)）]\s*$/);
  if (bracketed) {
    const [, outer, inner] = bracketed;
    if (CJK.test(inner) && !CJK.test(outer)) return { zh: inner.trim(), en: outer.trim() };
    if (CJK.test(outer) && !CJK.test(inner)) return { zh: outer.trim(), en: inner.trim() };
  }
  // Mixed in one run, e.g. "UMEPLAY 逃脱艺术" or "MC 精品真人密室逃脱".
  const enFirst = title.match(/^([^㐀-鿿]*?)\s*([㐀-鿿][\s\S]*)$/);
  if (enFirst && enFirst[1].trim() && CJK.test(enFirst[2])) {
    return { zh: enFirst[2].trim(), en: enFirst[1].trim() };
  }
  // The other way round, e.g. "湖滨银泰 in77".
  const zhFirst = title.match(/^([\s\S]*[㐀-鿿])\s+([^㐀-鿿]+)$/);
  if (zhFirst && zhFirst[2].trim()) {
    return { zh: zhFirst[1].trim(), en: zhFirst[2].trim() };
  }
  if (CJK.test(title)) return { zh: title.trim(), en: '' };
  return { zh: '', en: title.trim() };
}

// ---------------------------------------------------- districts, from source

const DISTRICT_ACCENTS = {};
const districts = [];

/**
 * Ordered district hints. Every key is a phrase that appears literally in the
 * source files; the first hit wins, so the specific entries come first.
 */
const DISTRICT_HINTS = [
  ['shanghai', 'xuhui', ['West Bund', 'Xuhui', 'French Concession', 'Hengshan Road', 'Wukang', 'Anfu Road', '武康路']],
  ['shanghai', 'huangpu', ['Huangpu', 'the Bund', 'The Bund', 'Bund', '外滩', 'Yu Garden', 'Yuyuan', "People's Square", 'Nanjing Road', 'Nanjing East', 'Shiliupu']],
  ['shanghai', 'jingan', ["Jing'an"]],
  ['shanghai', 'pudong', ['Pudong', 'Lujiazui', '陆家嘴']],
  ['shanghai', 'putuo', ['Putuo', 'Moganshan']],
  ['shanghai', 'yangpu', ['Yangpu', 'Wujiaochang']],
  ['shanghai', 'changning', ['Changning']],
  ['hangzhou', 'xihu', ['West Lake', '西湖', 'Xihu', 'Lingyin', '灵隐', 'Longjing', '龙井', 'Botanical Garden']],
  ['hangzhou', 'shangcheng', ['Hubin', '湖滨', 'Hefang', 'Qingtai']],
  ['hangzhou', 'gongshu', ['Gongshu', 'Grand Canal', 'Shengli River']],
  ['hangzhou', 'xiaoshan', ['Xiaoshan']],
  ['hangzhou', 'binjiang', ['Binjiang', 'Qiantang']],
];

function guessDistrict(city, hintText, label) {
  for (const [c, id, needles] of DISTRICT_HINTS) {
    if (c !== city) continue;
    if (needles.some((n) => hintText.includes(n))) return id;
  }
  warn('district-unresolved', `${label}: no district named in the source, filed under "${city}-other"`);
  return `${city}-other`;
}

// ------------------------------------------------- 1. the food guide (46-ish)

const places = [];

function readFoodGuide() {
  const html = readFileSync(join(SRC, 'shanghai-hangzhou-food-guide.html'), 'utf8');
  const start = html.indexOf('const DATA = {');
  const end = html.indexOf('\n};', start);
  if (start === -1 || end === -1) throw new Error('food guide: could not locate the DATA literal');
  const literal = html.slice(start + 'const DATA = '.length, end + 2);
  // The literal is plain JSON-ish JavaScript with no expressions in it.
  const DATA = new Function(`return (${literal});`)();

  for (const city of ['shanghai', 'hangzhou']) {
    const block = DATA[city];
    if (!block) throw new Error(`food guide: missing city ${city}`);
    for (const d of block.districts) {
      districts.push({
        id: d.id,
        city,
        nameZh: d.cnName,
        nameEn: d.name,
        accentColor: d.bar,
      });
      DISTRICT_ACCENTS[d.id] = d.bar;

      for (const p of d.places) {
        const price = parsePrice(p.price);
        if (!price.ok) warn('price-unparsed', `${p.cn || p.name} (${city}/${d.id}): "${p.price}"`);
        const nameEn = p.name.trim();
        const nameZh = (p.cn || '').trim() || nameEn;
        if (!p.cn) warn('name-zh-missing', `${nameEn}: source has no Chinese name, English reused`);
        places.push({
          id: uniqueId(nameEn, nameZh),
          nameZh,
          nameEn,
          city,
          district: d.id,
          category: 'food',
          description: p.desc.trim(),
          tags: dedupeTags([p.cat, p.badge, ...(p.tags ?? [])]),
          priceMin: price.min,
          priceMax: price.max,
          addressZh: p.addr?.trim() || undefined,
          metro: p.metro?.trim() || undefined,
          source: 'food-guide',
        });
      }
    }
  }
  // The guide gives addresses romanised, not in Chinese.
  warn(
    'address-not-chinese',
    'food guide: addresses are romanised in the source, so addressZh carries the source string verbatim',
  );
}

function dedupeTags(list) {
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const t = String(raw ?? '').trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

// --------------------------------------- 2 & 3. the Shanghai sight/fun guides

/** Detail lines of a card: { label, value } from every <strong> in it. */
function detailLines(card) {
  const out = [];
  for (const p of [...byTag(card, 'p'), ...byTag(card, 'div')]) {
    const strong = byTag(p, 'strong')[0];
    if (!strong) continue;
    const label = text(strong).replace(/:$/, '').trim();
    const whole = text(p);
    const value = whole.slice(whole.indexOf(text(strong)) + text(strong).length).trim();
    if (label && value) out.push({ label, value });
  }
  return out;
}

const LOCATION_LABELS = new Set([
  'Location', 'Locations', 'Metro', 'Departs from', 'Key streets', 'Track', 'Vibe', 'Also nearby', 'Highlights',
]);

function readCardGuide({ file, cardClass, city, classify, kinds }) {
  const root = parse(readFileSync(join(SRC, file), 'utf8'));

  for (const card of byClass(root, cardClass)) {
    const h3 = byTag(card, 'h3')[0];
    if (!h3) continue;
    const title = text(h3);
    const { zh, en } = splitName(title);
    const nameEn = en || title;
    const nameZh = zh || nameEn;
    if (!zh) warn('name-zh-missing', `${nameEn} (${file}): source has no Chinese name, English reused`);

    const body = byTag(card, 'p').find((p) => !byTag(p, 'strong').length && text(p).length > 40);
    const description = body ? text(body) : '';
    if (!description) warn('description-missing', `${nameEn} (${file}): no description paragraph found`);

    const details = detailLines(card);
    const priceNode = byClass(card, 'price-pill')[0] ?? byClass(card, 'price-tag')[0];
    const priceRaw = priceNode ? text(priceNode) : '';
    const price = parsePrice(priceRaw);
    if (priceRaw && !price.ok) warn('price-unparsed', `${nameEn} (${file}): "${priceRaw}"`);

    // The activities page files a place under the first of its tags, so a kind
    // goes in front where the guide leads with a badge instead.
    const kind = kinds?.[title];
    const tags = dedupeTags([
      ...(kind ? [kind] : []),
      ...byClass(card, 'cat-tag').map(text),
      ...byClass(card, 'tag').map(text),
    ]);
    const category = classify(tags, title);

    const hintParts = details.filter((d) => LOCATION_LABELS.has(d.label)).map((d) => d.value);
    const hint = (hintParts.join(' · ') || `${title} ${description}`).trim();
    const district = guessDistrict(city, hint, `${nameEn} (${file})`);

    const metroLine = details.find((d) => d.label === 'Metro');
    const locationLine = details.find((d) => d.label === 'Location' || d.label === 'Locations');
    const durationLine = details.find((d) => d.label === 'Duration' || d.label === 'Time needed');

    places.push({
      id: uniqueId(nameEn, nameZh),
      nameZh,
      nameEn,
      city,
      district,
      category,
      description,
      tags,
      priceMin: price.min,
      priceMax: price.max,
      addressZh: locationLine?.value,
      metro: metroLine?.value,
      durationMinutes: parseDuration(durationLine?.value),
      source: file,
    });
  }
}

function classifyClassic(tags, title) {
  if (tags.some((t) => /^shopping$/i.test(t))) return 'shopping';
  if (tags.some((t) => /Evening Essential|Cultural Show|Live Music|Iconic$/i.test(t)) && /Cruise|Show|Bars|Jazz/.test(title)) {
    return 'activity';
  }
  if (tags.some((t) => /Must Try|Nostalgic|Food Tour|Seasonal/i.test(t))) return 'food';
  return 'sight';
}

/**
 * What each Hangzhou fun guide card is, in the vocabulary the activities page
 * groups on. The guide leads every card with a badge ("Next-Gen", "Mall-Based")
 * rather than a kind, which would file the lot under "Everything else".
 *
 * Listed rather than matched on the text, for the same reason the planner
 * aliases are: no pattern loose enough to catch a walk from its description is
 * tight enough to leave 垂云通天河 alone. The two cards with no kind here, a
 * caving park and a camp running six different activities, are not one kind of
 * thing.
 */
const HANGZHOU_FUN_KINDS = {
  '暴风岛次时代密室 (Storm Island Next-Gen Escape Rooms)': 'Escape Room',
  '幻觉沉浸式剧场 (Hallucination Immersive Theatre)': 'Immersive Theatre',
  '宋城 · 千古情 (Songcheng Romance Show)': 'Show',
  '印象西湖 · 最忆是杭州 (Impression West Lake)': 'Show',
  'Grand Canal Water Bus': 'Transport',
  '小河直街 (Xiaohe Straight Street)': 'Old Street',
  '桥西历史街区 (Qiaoxi Historic Block)': 'Old Street',
  '九溪十八涧 (Nine Creeks and Eighteen Gullies)': 'Hike',
  '云栖竹径 (Yunqi Bamboo Path)': 'Hike',
  '良渚古城遗址公园 (Liangzhu Ancient City Ruins Park)': 'Heritage Site',
  '南宋德寿宫遗址博物馆 (Deshou Palace Museum)': 'Museum',
  '六和塔 (Liuhe Pagoda)': 'Heritage Site',
  '太子湾公园 (Taiziwan Park)': 'Park',
  '满觉陇 (Manjuelong Osmanthus Valley)': 'Park',
};

/** The Hangzhou classic guide's food-dish cards carry their own tag vocabulary. */
function classifyClassicHangzhou(tags) {
  if (tags.some((t) => /^(Signature Dish|Delicate|Traditional|Classic|Noodles|Where to Eat)$/i.test(t))) {
    return 'food';
  }
  return 'sight';
}

function readXiaolongbaoCards() {
  // The soup dumpling block is a plain three-up grid rather than a card class.
  const root = parse(readFileSync(join(SRC, 'classic-shanghai-guide.html'), 'utf8'));
  const headings = byTag(root, 'h3').filter((h) => text(h).includes('Xiaolongbao'));
  if (!headings.length) {
    warn('section-missing', 'classic guide: the xiaolongbao block was not found');
    return;
  }
  const panel = byTag(root, 'div').find((d) => byTag(d, 'h3').includes(headings[0]) && classes(d).includes('rounded-2xl'));
  if (!panel) return;
  for (const cell of byTag(panel, 'div').filter((d) => classes(d).includes('rounded-xl'))) {
    const ps = byTag(cell, 'p');
    if (ps.length < 2) continue;
    const nameEn = text(ps[0]);
    const description = text(ps[1]);
    warn('name-zh-missing', `${nameEn} (classic guide, xiaolongbao block): no Chinese name in source`);
    const price = parsePrice(description);
    places.push({
      id: uniqueId(nameEn, nameEn),
      nameZh: nameEn,
      nameEn,
      city: 'shanghai',
      district: guessDistrict('shanghai', description, `${nameEn} (classic guide)`),
      category: 'food',
      description,
      tags: dedupeTags(['Xiaolongbao', text(headings[0]).replace(/\s*[—-].*$/, '').trim()]),
      priceMin: price.min,
      priceMax: price.max,
      source: 'classic-shanghai-guide.html',
    });
  }
}

// ------------------------------- 4. the planner: the catalog and the itinerary

/**
 * itinerary.html is the planner app, and it carries its own data rather than
 * only a rendered page: LIB is the catalog, DAYS_SEED the days, FIXED the
 * anchors that do not move (flights, check ins), PLAN the suggested stops.
 * Reading those beats scraping the rendered timeline, which is how names like
 * "MC" / "精品真人密室逃脱" were arrived at: a split down the middle of one
 * title. Here every name is stated.
 */
function plannerData() {
  const html = readFileSync(join(SRC, 'itinerary.html'), 'utf8');

  /** The literal after `const NAME =`, balanced across nested brackets. */
  const literal = (name) => {
    const start = html.indexOf(`const ${name}`);
    if (start < 0) throw new Error(`itinerary.html: no ${name}`);
    const open = html.indexOf('=', start) + 1;
    let i = open;
    while (' \n\r\t'.includes(html[i])) i++;
    const closers = { '[': ']', '{': '}' };
    const close = closers[html[i]];
    if (!close) throw new Error(`itinerary.html: ${name} is not a literal`);
    let depth = 0;
    let inString = null;
    for (let j = i; j < html.length; j++) {
      const c = html[j];
      if (inString) {
        if (c === '\\') j++;
        else if (c === inString) inString = null;
        continue;
      }
      if (c === '"' || c === "'") inString = c;
      else if (c === html[i]) depth++;
      else if (c === close && --depth === 0) return html.slice(i, j + 1);
    }
    throw new Error(`itinerary.html: ${name} never closes`);
  };

  // LIB is JSON. The others are hand written object literals with unquoted
  // keys and single quotes, so they go through Function rather than JSON.
  const evaluate = (name) => Function(`"use strict";return (${literal(name)})`)();

  return {
    lib: JSON.parse(literal('LIB')),
    days: evaluate('DAYS_SEED'),
    fixed: evaluate('FIXED'),
    plan: evaluate('PLAN'),
  };
}

/** LIB's `kind`, plus its `cat` for the two that are really shopping. */
function plannerCategory(entry) {
  if (entry.cat === 'Shopping') return 'shopping';
  if (entry.kind === 'food') return 'food';
  if (entry.kind === 'sight') return 'sight';
  return 'activity';
}

/**
 * LIB names its district in Chinese. Two of them, Jiading and Songjiang, only
 * appear here: the karting tracks sit well outside the city the guides cover.
 */
const PLANNER_DISTRICTS = [
  ['黄浦区', 'huangpu', 'shanghai', 'Huangpu', '#ea580c'],
  ['徐汇区', 'xuhui', 'shanghai', 'Xuhui / French Concession', '#16a34a'],
  ['静安区', 'jingan', 'shanghai', "Jing'an", '#d97706'],
  ['浦东新区', 'pudong', 'shanghai', 'Pudong', '#0d9488'],
  ['杨浦区', 'yangpu', 'shanghai', 'Yangpu', '#7c3aed'],
  ['长宁区', 'changning', 'shanghai', 'Changning', '#2563eb'],
  ['普陀区', 'putuo', 'shanghai', 'Putuo', '#059669'],
  ['嘉定区', 'jiading', 'shanghai', 'Jiading', '#b45309'],
  ['松江区', 'songjiang', 'shanghai', 'Songjiang', '#be123c'],
  ['西湖区', 'xihu', 'hangzhou', 'Xihu / West Lake', '#0d9488'],
  ['上城区', 'shangcheng', 'hangzhou', 'Shangcheng / Hubin', '#c4693d'],
  ['拱墅区', 'gongshu', 'hangzhou', 'Gongshu / Canal', '#d97706'],
  ['萧山区', 'xiaoshan', 'hangzhou', 'Xiaoshan', '#dc2626'],
  ['滨江区', 'binjiang', 'hangzhou', 'Binjiang / Qiantang', '#7c3aed'],
];

function plannerDistrict(city, area, label) {
  const row = PLANNER_DISTRICTS.find(([zh, , c]) => zh === area && c === city);
  if (!row) {
    // '上海' and the like: named as a city, not a district.
    warn('district-unresolved', `${label}: planner gives the area as "${area}", filed under "${city}-other"`);
    return `${city}-other`;
  }
  const [nameZh, id, , nameEn, accent] = row;
  if (!districts.some((d) => d.id === id)) {
    districts.push({ id, city, nameZh, nameEn, accentColor: DISTRICT_ACCENTS[id] ?? accent });
  }
  return id;
}

/**
 * The same place, written differently by a guide and by the planner. Names
 * that only a comparison this loose would join are listed rather than matched
 * by similarity: "MC" and "MC Escape Rooms" join, "West Lake" and "West Lake
 * Rowing Boat" must not, and no threshold tells those two cases apart.
 */
const PLANNER_ALIASES = {
  s_shanghai_tower_deck: 'Shanghai Tower Observation Deck',
  n_bund_rooftop_bars: 'Rooftop Bars on the Bund',
  f_umeplay_escape_art: 'UMEPLAY',
  f_mc_escape_rooms: 'MC',
  f_storm_island_immersive_centre: 'Storm Island Immersive Center',
  f_sic_kart_land: 'Shanghai International Circuit Kart Land',
};

/** Same place, named differently by a guide and by the planner. */
const comparable = (s) =>
  (s ?? '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9㐀-鿿]+/g, '');

/**
 * The catalog, corrected against the planner. A place already read out of a
 * guide keeps its slug, because the slug is what the database rows are keyed
 * on and what a saved itinerary points at; everything else about it is taken
 * from the planner, which states names, prices and addresses rather than
 * leaving them to be inferred from a sentence.
 */
function readPlannerLibrary(lib) {
  const bySlug = new Map();

  for (const entry of lib) {
    const city = entry.city.toLowerCase();
    const nameZh = entry.cn || entry.name;
    const nameEn = entry.name;
    const category = plannerCategory(entry);
    const price = parsePrice(entry.price);
    const tags = dedupeTags([entry.cat, entry.badge, ...(entry.tags ?? [])]);

    // English first: two branches of one restaurant share a Chinese name and
    // are told apart only by the "(Lujiazui)" on the end of the English one.
    const alias = PLANNER_ALIASES[entry.id];
    const sameZh = places.filter((p) => comparable(p.nameZh) === comparable(nameZh));
    const existing =
      places.find((p) => comparable(p.nameEn) === comparable(nameEn)) ??
      (alias ? places.find((p) => comparable(p.nameEn) === comparable(alias)) : undefined) ??
      (sameZh.length === 1 ? sameZh[0] : undefined);
    if (sameZh.length > 1 && !existing) {
      warn('name-zh-shared', `${nameEn}: "${nameZh}" names ${sameZh.length} places, matched on the English name alone`);
    }
    if (alias && !existing) {
      warn('alias-unused', `${nameEn}: no guide entry named "${alias}" to merge with`);
    }

    const place = existing ?? { id: uniqueId(nameEn, nameZh) };
    Object.assign(place, {
      nameZh,
      nameEn,
      city,
      district: plannerDistrict(city, entry.area, `${nameEn} (planner)`),
      category,
      description: entry.desc,
      tags,
      priceMin: price.min,
      priceMax: price.max,
      addressZh: entry.addr || undefined,
      metro: entry.metro || undefined,
      durationMinutes:
        parseDuration(`${(entry.tags ?? []).join(' ')} ${entry.desc}`) ?? place.durationMinutes,
      source: 'itinerary.html',
    });
    if (!price.ok) {
      warn('price-unparsed', `${nameEn}: planner prices it as "${entry.price}"`);
    }
    if (!existing) places.push(place);
    bySlug.set(entry.id, place.id);
  }

  return bySlug;
}

/**
 * The days. FIXED holds what cannot move, PLAN what is suggested; the planner
 * shows them as one timeline, so they merge here and sort by time. An entry
 * with a `ref` points into LIB, which is how an item links to a place without
 * matching on its title.
 */
function readPlannerItinerary({ days, fixed, plan }, slugOf) {
  const built = days.map((day, i) => {
    const rows = [...(fixed[day.date] ?? []), ...(plan[day.date] ?? [])].sort((a, b) =>
      (a.time ?? '').localeCompare(b.time ?? ''),
    );

    const items = rows.map((row, j) => {
      const placeId = row.ref ? slugOf.get(row.ref) : undefined;
      if (row.ref && !placeId) {
        warn('ref-unresolved', `${day.date} ${row.time}: no library entry for "${row.ref}"`);
      }
      const place = placeId ? places.find((p) => p.id === placeId) : undefined;
      const note = row.note || place?.description;
      const cost = parsePrice(note ?? '');

      return {
        id: `d${i}-${String(j + 1).padStart(2, '0')}`,
        placeId,
        customTitle: placeId ? undefined : row.cn,
        startTime: row.time,
        note: note || undefined,
        estCostMin: placeId ? place?.priceMin : cost.min,
        estCostMax: placeId ? place?.priceMax : cost.max,
      };
    });

    return { id: `d${i}`, date: day.date, label: day.cn, items };
  });

  return { name: 'Hangzhou/Shanghai', days: built };
}

/**
 * The guides repeat themselves: the food guide lists No. 3 Warehouse under two
 * branches, and the classic guide's xiaolongbao block names a shop the food
 * guide already covered. Two rows for one place means two cards in the library
 * and two rows in the database, so the later one folds into the first and only
 * fills in what the first is missing.
 */
function mergeDuplicates() {
  const kept = [];
  for (const place of places) {
    const first = kept.find(
      (k) => k.city === place.city && comparable(k.nameEn) === comparable(place.nameEn),
    );
    if (!first) {
      kept.push(place);
      continue;
    }
    for (const [key, value] of Object.entries(place)) {
      if (key === 'id') continue;
      const blank = first[key] === undefined || first[key] === '';
      if (blank && value !== undefined && value !== '') first[key] = value;
    }
    if (CJK.test(place.nameZh) && !CJK.test(first.nameZh)) first.nameZh = place.nameZh;
    first.tags = dedupeTags([...first.tags, ...place.tags]);
    warn('duplicate-merged', `"${place.nameEn}" (${place.id}) folded into "${first.nameEn}" (${first.id})`);
  }
  places.length = 0;
  places.push(...kept);
}

function readPlanner() {
  const data = plannerData();
  const slugOf = readPlannerLibrary(data.lib);
  return readPlannerItinerary(data, slugOf);
}

// ------------------------------------------------------------------- writing

function lit(value) {
  return JSON.stringify(value);
}

function placeLiteral(p) {
  const parts = [
    `id: ${lit(p.id)}`,
    `nameZh: ${lit(p.nameZh)}`,
    `nameEn: ${lit(p.nameEn)}`,
    `city: ${lit(p.city)}`,
    `district: ${lit(p.district)}`,
    `category: ${lit(p.category)}`,
    `description: ${lit(p.description)}`,
    `tags: ${lit(p.tags)}`,
  ];
  if (p.priceMin !== undefined) parts.push(`priceMin: ${p.priceMin}`);
  if (p.priceMax !== undefined) parts.push(`priceMax: ${p.priceMax}`);
  if (p.addressZh) parts.push(`addressZh: ${lit(p.addressZh)}`);
  if (p.metro) parts.push(`metro: ${lit(p.metro)}`);
  if (p.durationMinutes !== undefined) parts.push(`durationMinutes: ${p.durationMinutes}`);
  return `  { ${parts.join(', ')} },`;
}

function itemLiteral(it) {
  const parts = [`id: ${lit(it.id)}`];
  if (it.placeId) parts.push(`placeId: ${lit(it.placeId)}`);
  if (it.customTitle) parts.push(`customTitle: ${lit(it.customTitle)}`);
  if (it.startTime) parts.push(`startTime: ${lit(it.startTime)}`);
  if (it.note) parts.push(`note: ${lit(it.note)}`);
  if (it.estCostMin !== undefined) parts.push(`estCostMin: ${it.estCostMin}`);
  if (it.estCostMax !== undefined) parts.push(`estCostMax: ${it.estCostMax}`);
  return `      { ${parts.join(', ')} },`;
}

const BANNER = `// Generated by scripts/extract.mjs from the files in source/.
// Do not edit by hand: run \`npm run extract\` instead.
`;


// ------------------------------------------------------ supabase seed output

const sqlText = (v) =>
  v === undefined || v === null || v === '' ? 'null' : `'${String(v).replace(/'/g, "''")}'`;
const sqlNum = (v) => (v === undefined || v === null ? 'null' : String(v));
const sqlTextArray = (list) =>
  list.length ? `array[${list.map(sqlText).join(', ')}]::text[]` : `'{}'::text[]`;

/**
 * An idempotent seed, keyed on the slug. Re-running it after a source edit
 * updates the row in place, so a place keeps its uuid and anything pointing at
 * that uuid keeps working.
 */
function seedSql() {
  const lines = [
    '-- Generated by scripts/extract.mjs from the files in source/.',
    '-- Do not edit by hand: run `npm run extract` instead.',
    '--',
    '-- Idempotent. Re-running updates rows in place and keeps their uuids.',
    '',
    'begin;',
    '',
    '-- districts',
  ];

  for (const d of districts) {
    lines.push(
      `insert into public.districts (id, city, name_zh, name_en, accent_color) values (` +
        [d.id, d.city, d.nameZh, d.nameEn, d.accentColor].map(sqlText).join(', ') +
        `)\n  on conflict (id) do update set ` +
        `city = excluded.city, name_zh = excluded.name_zh, ` +
        `name_en = excluded.name_en, accent_color = excluded.accent_color;`,
    );
  }

  lines.push('', '-- places');
  for (const p of places) {
    const columns = [
      sqlText(p.id),
      sqlText(p.nameZh),
      sqlText(p.nameEn),
      sqlText(p.city),
      sqlText(p.district),
      sqlText(p.category),
      sqlText(p.description),
      sqlText(p.tags.join(', ')),
      sqlNum(p.priceMin),
      sqlNum(p.priceMax),
      sqlText(p.addressZh),
      sqlText(p.metro),
      sqlNum(p.durationMinutes),
      sqlText(p.source),
      sqlText('CN'),
    ];
    lines.push(
      `insert into public.places (slug, name_zh, name_en, city, district_id, category, ` +
        `description, tags, price_min, price_max, address, metro, duration_minutes, source, country)\n` +
        `  values (${columns.join(', ')})\n` +
        `  on conflict (slug) do update set ` +
        `name_zh = excluded.name_zh, name_en = excluded.name_en, city = excluded.city, ` +
        `district_id = excluded.district_id, category = excluded.category, ` +
        `description = excluded.description, tags = excluded.tags, ` +
        `price_min = excluded.price_min, price_max = excluded.price_max, ` +
        `address = excluded.address, metro = excluded.metro, ` +
        `duration_minutes = excluded.duration_minutes, source = excluded.source, ` +
        `country = excluded.country;`,
    );
  }

  lines.push('', 'commit;', '');
  return lines.join('\n');
}

function main() {
  readFoodGuide();

  readCardGuide({
    file: 'classic-shanghai-guide.html',
    cardClass: 'classic-card',
    city: 'shanghai',
    classify: classifyClassic,
  });
  readXiaolongbaoCards();

  readCardGuide({
    file: 'shanghai-fun-guide.html',
    cardClass: 'activity-card',
    city: 'shanghai',
    classify: () => 'activity',
  });

  readCardGuide({
    file: 'classic-hangzhou-guide.html',
    cardClass: 'classic-card',
    city: 'hangzhou',
    classify: classifyClassicHangzhou,
  });

  readCardGuide({
    file: 'hangzhou-fun-guide.html',
    cardClass: 'activity-card',
    city: 'hangzhou',
    classify: () => 'activity',
    kinds: HANGZHOU_FUN_KINDS,
  });

  // Before the planner, so the row it corrects is the one that survives.
  mergeDuplicates();
  const itinerary = readPlanner();

  // A catch-all district per city for places the sources do not locate.
  for (const city of ['shanghai', 'hangzhou']) {
    if (places.some((p) => p.district === `${city}-other`)) {
      districts.push({
        id: `${city}-other`,
        city,
        nameZh: '其他',
        nameEn: 'Elsewhere',
        accentColor: '#5f6b62',
      });
    }
  }

  mkdirSync(OUT, { recursive: true });

  writeFileSync(
    join(OUT, 'districts.ts'),
    `${BANNER}
import type { District } from '../types';

export const districts: District[] = [
${districts.map((d) => `  { id: ${lit(d.id)}, city: ${lit(d.city)}, nameZh: ${lit(d.nameZh)}, nameEn: ${lit(d.nameEn)}, accentColor: ${lit(d.accentColor)} },`).join('\n')}
];
`,
  );

  writeFileSync(
    join(OUT, 'places.ts'),
    `${BANNER}
import type { Place } from '../types';

export const places: Place[] = [
${places.map(placeLiteral).join('\n')}
];
`,
  );

  writeFileSync(
    join(OUT, 'starterItinerary.ts'),
    `${BANNER}
import type { Itinerary } from '../types';

export const starterItinerary: Itinerary = {
  name: ${lit(itinerary.name)},
  days: [
${itinerary.days
  .map(
    (d) => `    {
      id: ${lit(d.id)},${d.date ? `\n      date: ${lit(d.date)},` : ''}
      label: ${lit(d.label)},
      items: [
${d.items.map(itemLiteral).join('\n')}
      ],
    },`,
  )
  .join('\n')}
  ],
};
`,
  );

  mkdirSync(join(ROOT, 'supabase'), { recursive: true });
  writeFileSync(join(ROOT, 'supabase', 'seed.sql'), seedSql());

  report(itinerary);
}

function report(itinerary) {
  const byCity = (c) => places.filter((p) => p.city === c).length;
  const byCat = (c) => places.filter((p) => p.category === c).length;

  console.log('\nExtraction report');
  console.log('=================');
  console.log(`places        ${places.length}  (shanghai ${byCity('shanghai')}, hangzhou ${byCity('hangzhou')})`);
  console.log(`  by category food ${byCat('food')}, sight ${byCat('sight')}, activity ${byCat('activity')}, shopping ${byCat('shopping')}`);
  console.log(`districts     ${districts.length}`);
  console.log(`days          ${itinerary.days.length}`);
  console.log('seed          supabase/seed.sql');
  console.log(`items         ${itinerary.days.reduce((n, d) => n + d.items.length, 0)}`);
  console.log(`  linked to a place ${itinerary.days.reduce((n, d) => n + d.items.filter((i) => i.placeId).length, 0)}`);
  console.log(`missing a price     ${places.filter((p) => p.priceMin === undefined).length}`);
  console.log(`missing metro       ${places.filter((p) => !p.metro).length}`);
  console.log(`missing a duration  ${places.filter((p) => p.durationMinutes === undefined).length}`);

  const grouped = new Map();
  for (const w of warnings) {
    if (!grouped.has(w.topic)) grouped.set(w.topic, []);
    grouped.get(w.topic).push(w.detail);
  }
  console.log('\nIncomplete or worth a look');
  console.log('--------------------------');
  for (const [topic, details] of [...grouped].sort()) {
    console.log(`\n${topic}  (${details.length})`);
    for (const d of details) console.log(`  - ${d}`);
  }

  // Half the job. seed.sql has just been rewritten and the database has not
  // heard about it, which is silent: the site keeps serving the old catalog
  // with no error anywhere. That gap once left the live database 21 places
  // short for days, so say it every run rather than trusting anyone to
  // remember.
  console.log('\nNext');
  console.log('----');
  console.log('  supabase/seed.sql has been rewritten. Run it in the Supabase SQL editor,');
  console.log('  or the database keeps serving the previous catalog and says nothing.');
  console.log('  Removing a place needs a retirement migration too: see 0004 and 0005.');
  console.log('');
}

main();
