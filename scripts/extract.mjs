#!/usr/bin/env node
// Reads the four guide files in source/ and writes typed data files into
// src/data/. Nothing here is hand copied: every name, description, price and
// address is pulled out of the HTML. The only judgement encoded in this file
// is classification (which card is a sight and which is an activity, which
// district a place sits in) plus the small text trims noted inline.
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
  ['hangzhou', 'xihu', ['West Lake', '西湖', 'Lingyin', '灵隐', 'Longjing', '龙井', 'Botanical Garden']],
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

function readCardGuide({ file, cardClass, city, classify }) {
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

    const tags = dedupeTags([...byClass(card, 'cat-tag').map(text), ...byClass(card, 'tag').map(text)]);
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

// ------------------------------------------- 4. the itinerary: days and items

/**
 * Which timeline entries in itinerary.html describe a place worth putting in
 * the library, and what they are. Everything except this classification is
 * read out of the entry itself. `trim` removes the connective wording that
 * makes the entry read as a schedule line rather than a name.
 */
const ITINERARY_PLACE_RULES = [
  { day: 'd1', time: '16:00', category: 'sight', city: 'hangzhou', trim: /^Out to\s*/ },
  { day: 'd3', time: '11:00', category: 'activity', city: 'hangzhou', trim: /\s+with the group$/, zhFrom: 'note' },
  { day: 'd3', time: '19:30', category: 'shopping', city: 'hangzhou', trim: /^Shopping at\s*/ },
  { day: 'd4', time: '09:00', category: 'sight', city: 'hangzhou', trim: /,\s*optional$/ },
  { day: 'd4', time: '17:30', category: 'sight', city: 'shanghai', trim: /^Activity \w+:\s*/ },
  { day: 'd4', time: '20:30', category: 'sight', city: 'shanghai', trim: /^Activity \w+:\s*|\s+at night$/g },
  { day: 'd5', time: '14:00', category: 'sight', city: 'shanghai', trim: /^Activity \w+:\s*/ },
  { day: 'd6', time: '08:00', category: 'activity', city: 'shanghai', nameFrom: 'day', trim: /^\w+\s*·\s*|,\s*all day$/g },
];

const PERSONAL_PATTERNS = [
  /confirmation number/i,
  /booking (?:ref|reference|number)/i,
  /\bprepaid\b/i,
  /Booked online/i,
];

function zhSpans(node) {
  return byClass(node, 'zh').map(text).filter((t) => CJK.test(t));
}

/** Latin remainder of an element once its Chinese spans are taken out. */
function latinPart(node) {
  const whole = text(node);
  let rest = whole;
  for (const z of zhSpans(node)) rest = rest.replace(z, ' ');
  return rest.replace(/\s+/g, ' ').trim();
}

function readItinerary() {
  const root = parse(readFileSync(join(SRC, 'itinerary.html'), 'utf8'));
  const tripName = text(byTag(root, 'h1')[0] ?? { text: 'Trip' });
  const year = (text(byClass(root, 'eyebrow')[0] ?? { text: '' }).match(/(20\d\d)/) ?? [])[1];

  const days = [];
  const linkRequests = [];

  for (const sec of byTag(root, 'section')) {
    if (!classes(sec).includes('day')) continue;
    const dayId = sec.attrs.id;
    const dayNum = text(byClass(sec, 'daynum')[0] ?? { text: '' });
    const titleNode = byClass(sec, 'daytitle')[0];
    const labelZh = titleNode ? text(byTag(titleNode, 'div').find((d) => classes(d).includes('zh')) ?? { text: '' }) : '';
    const labelEn = titleNode ? text(byTag(titleNode, 'div').find((d) => classes(d).includes('en')) ?? { text: '' }) : '';

    const dm = dayNum.match(/(\d+)\s*\/\s*(\d+)/);
    const date = dm && year ? `${year}-${dm[2].padStart(2, '0')}-${dm[1].padStart(2, '0')}` : undefined;
    if (!date) warn('date-missing', `${dayId}: could not read a date from "${dayNum}"`);

    const list = byClass(sec, 'tl')[0];
    const rawItems = [];
    for (const li of byTag(list ?? { children: [] }, 'li')) {
      const timeNode = byClass(li, 'time')[0];
      const whatNode = byClass(li, 'what')[0];
      const noteNode = byClass(li, 'note')[0];
      const costNode = byClass(li, 'cost')[0];
      if (!whatNode) continue;
      rawItems.push({
        time: timeNode ? text(timeNode) : '',
        whatNode,
        what: text(whatNode),
        note: noteNode ? text(noteNode) : '',
        cost: costNode ? text(costNode) : '',
      });
    }

    const items = rawItems.map((raw, i) => {
      // "15:28", "15:30 to 20:00" and "20:00 onward" all start at a clock
      // time; "Through the day" and "Afternoon" do not.
      const clock = raw.time.match(/^(\d{1,2}:\d{2})/);
      const startTime = clock ? clock[1] : undefined;
      const spanEnd = raw.time.match(/^\d{1,2}:\d{2}\s*to\s*(\d{1,2}:\d{2})/);
      if (!startTime && raw.time) {
        warn('time-not-a-clock', `${dayId} "${raw.what}": start time reads "${raw.time}", left unset`);
      }

      // Cost lines list several options separated by "·". The first option is
      // the estimate; the rest is folded into the note so nothing is lost.
      const segments = raw.cost.split('·').map((s) => s.trim()).filter(Boolean);
      const price = parsePrice(segments[0] ?? '');
      if (raw.cost && !price.ok) warn('price-unparsed', `${dayId} "${raw.what}": "${raw.cost}"`);
      let note = raw.note;
      if (segments.length > 1) note = note ? `${note} Costs: ${raw.cost}` : `Costs: ${raw.cost}`;

      for (const pattern of PERSONAL_PATTERNS) {
        if (pattern.test(note) || pattern.test(raw.what)) {
          warn('personal-scrubbed', `${dayId} "${raw.what}": booking wording removed from the note`);
          note = note.replace(pattern, '').replace(/\s{2,}/g, ' ').trim();
        }
      }

      // Duration comes from the gap to the next timed entry on the same day.
      let durationMinutes;
      if (spanEnd) {
        durationMinutes = toMinutes(spanEnd[1]) - toMinutes(startTime);
      } else {
        const next = rawItems.slice(i + 1).map((r) => r.time.match(/^(\d{1,2}:\d{2})/)).find(Boolean);
        if (startTime && next) {
          const mins = toMinutes(next[1]) - toMinutes(startTime);
          if (mins >= 15 && mins <= 480) durationMinutes = mins;
        }
      }

      const rule = ITINERARY_PLACE_RULES.find((r) => r.day === dayId && r.time === raw.time);
      const item = {
        id: `${dayId}-${String(i + 1).padStart(2, '0')}`,
        customTitle: raw.what,
        startTime,
        durationMinutes,
        note: note || undefined,
        estCostMin: price.min,
        estCostMax: price.max,
      };
      if (rule) {
        linkRequests.push({ rule, raw, item, dayId, labelZh, labelEn });
      }
      return item;
    });

    days.push({
      id: dayId,
      date,
      label: labelZh || labelEn || dayId,
      labelEn,
      items,
    });
  }

  // Build the places the rules point at, then link the items to them.
  for (const req of linkRequests) {
    const { rule, raw, item } = req;
    let nameZh;
    let nameEn;

    if (rule.nameFrom === 'day') {
      nameZh = req.labelZh;
      nameEn = req.labelEn.replace(rule.trim ?? /$^/g, '').trim();
    } else {
      const zh = zhSpans(raw.whatNode);
      nameZh = rule.zhFrom === 'note' ? (raw.note.match(/[㐀-鿿]+/) ?? [])[0] : zh[0];
      nameEn = latinPart(raw.whatNode).replace(rule.trim ?? /$^/g, '').trim();
    }
    // A single run may hold both scripts, e.g. "湖滨银泰 in77".
    if (nameZh && !nameEn) {
      const split = splitName(nameZh);
      if (split.zh && split.en) {
        nameZh = split.zh;
        nameEn = split.en;
      }
    }
    if (!nameZh) {
      nameZh = nameEn;
      warn('name-zh-missing', `${req.dayId} "${raw.what}": no Chinese name in the entry, English reused`);
    }
    if (!nameEn) nameEn = nameZh;

    const existing = places.find(
      (p) => p.nameZh === nameZh || p.nameEn.toLowerCase() === nameEn.toLowerCase(),
    );
    if (existing) {
      item.placeId = existing.id;
      delete item.customTitle;
      warn('duplicate-merged', `${req.dayId} "${raw.what}" reuses the existing place "${existing.nameZh}"`);
      continue;
    }

    const price = parsePrice(raw.cost.split('·')[0] ?? '');
    const place = {
      id: uniqueId(nameEn, nameZh),
      nameZh,
      nameEn,
      city: rule.city,
      district: guessDistrict(rule.city, `${raw.what} ${raw.note}`, `${nameEn} (itinerary ${req.dayId})`),
      category: rule.category,
      description: raw.note,
      tags: dedupeTags([rule.category === 'sight' ? 'Sight' : rule.category === 'shopping' ? 'Shopping' : 'Activity']),
      priceMin: price.min,
      priceMax: price.max,
      durationMinutes: parseDuration(raw.note) ?? item.durationMinutes,
      source: 'itinerary.html',
    };
    places.push(place);
    item.placeId = place.id;
    delete item.customTitle;
  }

  // Chinese names mentioned in notes but never turned into a place.
  for (const day of days) {
    for (const item of day.items) {
      const mentions = (item.note ?? '').match(/[㐀-鿿]{2,}/g) ?? [];
      for (const m of mentions) {
        if (!places.some((p) => p.nameZh.includes(m))) {
          warn('mention-not-extracted', `${day.id}: note mentions "${m}", which has no place record`);
        }
      }
    }
  }

  warn(
    'stay-blocks-dropped',
    'itinerary.html: the nightly hotel blocks were not extracted, they carry booking and payment wording',
  );

  return { name: tripName, days };
}

const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

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
  if (it.durationMinutes !== undefined) parts.push(`durationMinutes: ${it.durationMinutes}`);
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
      sqlTextArray(p.tags),
      sqlNum(p.priceMin),
      sqlNum(p.priceMax),
      sqlText(p.addressZh),
      sqlText(p.metro),
      sqlNum(p.durationMinutes),
      sqlText(p.source),
    ];
    lines.push(
      `insert into public.places (slug, name_zh, name_en, city, district_id, category, ` +
        `description, tags, price_min, price_max, address_zh, metro, duration_minutes, source)\n` +
        `  values (${columns.join(', ')})\n` +
        `  on conflict (slug) do update set ` +
        `name_zh = excluded.name_zh, name_en = excluded.name_en, city = excluded.city, ` +
        `district_id = excluded.district_id, category = excluded.category, ` +
        `description = excluded.description, tags = excluded.tags, ` +
        `price_min = excluded.price_min, price_max = excluded.price_max, ` +
        `address_zh = excluded.address_zh, metro = excluded.metro, ` +
        `duration_minutes = excluded.duration_minutes, source = excluded.source;`,
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

  const itinerary = readItinerary();

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
  console.log('');
}

main();
