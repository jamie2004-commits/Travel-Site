import type { Itinerary } from '../types';
import { addMinutes, formatCostSum, formatPrice, sumCosts } from './format';
import { districtById, itemTitle, placeById } from './places';

const esc = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function itemLines(itinerary: Itinerary) {
  return itinerary.days.map((day) => ({
    day,
    rows: day.items.map((item) => {
      const title = itemTitle(item.placeId, item.customTitle);
      const place = item.placeId ? placeById[item.placeId] : undefined;
      const district = place ? districtById[place.district] : undefined;
      const end =
        item.startTime && item.durationMinutes
          ? addMinutes(item.startTime, item.durationMinutes)
          : undefined;
      const when = item.startTime
        ? end
          ? `${item.startTime} to ${end}`
          : item.startTime
        : '';
      const cost =
        item.estCostMin === undefined && item.estCostMax === undefined
          ? ''
          : formatPrice(item.estCostMin, item.estCostMax);
      return { item, title, place, district, when, cost };
    }),
  }));
}

/** Plain text, for pasting into a chat. */
export function toText(itinerary: Itinerary): string {
  const out: string[] = [itinerary.name, '='.repeat(Math.max(4, itinerary.name.length)), ''];

  itemLines(itinerary).forEach(({ day, rows }, i) => {
    const cost = formatCostSum(sumCosts(day.items));
    out.push(`Day ${i + 1} · ${day.label}${day.date ? ` · ${day.date}` : ''}  [${cost}]`);
    if (!rows.length) out.push('  (nothing planned)');
    for (const row of rows) {
      const name = row.title.en ? `${row.title.zh} ${row.title.en}` : row.title.zh;
      out.push(`  ${row.when ? `${row.when}  ` : ''}${name}${row.cost ? `  ${row.cost}` : ''}`);
      if (row.place?.metro) out.push(`      Metro: ${row.place.metro}`);
      if (row.item.note) out.push(`      ${row.item.note}`);
    }
    out.push('');
  });

  out.push(`Total: ${formatCostSum(sumCosts(itinerary.days.flatMap((d) => d.items)))}`);
  return out.join('\n');
}

/**
 * A standalone page in the visual language of the source itinerary sheet.
 * Fonts are linked but every family has a local fallback, so the file reads
 * fine offline and can just be sent to someone.
 */
export function toHtml(itinerary: Itinerary): string {
  const grand = sumCosts(itinerary.days.flatMap((d) => d.items));
  const sections = itemLines(itinerary);

  const nav = sections
    .map(
      ({ day }, i) =>
        `<a href="#d${i}"><b>${esc(day.label)}</b> <span>Day ${i + 1}</span></a>`,
    )
    .join('');

  const days = sections
    .map(({ day, rows }, i) => {
      const cost = formatCostSum(sumCosts(day.items));
      const items = rows.length
        ? `<ol class="tl">${rows
            .map(
              (row) => `<li>
      <span class="time">${esc(row.when || '·')}</span>
      <div class="what"><span class="zh">${esc(row.title.zh)}</span>${
        row.title.en ? ` <span class="en">${esc(row.title.en)}</span>` : ''
      }</div>
      ${row.item.note ? `<div class="note">${esc(row.item.note)}</div>` : ''}
      ${row.place?.metro ? `<div class="note">Metro: ${esc(row.place.metro)}</div>` : ''}
      ${row.cost ? `<span class="cost">${esc(row.cost)}</span>` : ''}
    </li>`,
            )
            .join('')}</ol>`
        : '<p class="empty">Nothing planned for this day.</p>';

      return `<section class="day" id="d${i}">
    <div class="dayhead">
      <div class="daynum">Day ${i + 1}${day.date ? `<span>${esc(day.date)}</span>` : ''}</div>
      <div class="daytitle"><div class="zh">${esc(day.label)}</div></div>
      <div class="daycost">${esc(cost)}</div>
    </div>
    ${items}
  </section>`;
    })
    .join('\n');

  const budgetRows = sections
    .map(({ day }, i) => {
      const s = sumCosts(day.items);
      return `<tr><td>Day ${i + 1}</td><td class="zh">${esc(day.label)}</td><td class="num">¥${s.min}</td><td class="num">¥${s.max}</td></tr>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(itinerary.name)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;600;900&family=Space+Grotesk:wght@400;500;700&display=swap" rel="stylesheet">
<style>
:root{--ink:#12211f;--mist:#eef1e9;--paper:#f7f8f3;--jade:#2f6f5e;--jade-soft:#dde9e2;--plum:#8c3a48;--gold:#b98a2e;--line:#cfd6cb;--muted:#5f6b62}
*{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{background:var(--paper);color:var(--ink);font-family:"Space Grotesk",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.6;-webkit-font-smoothing:antialiased}
.zh{font-family:"Noto Serif SC",serif}
header{padding:56px 28px 36px;border-bottom:1px solid var(--line);background:radial-gradient(120% 90% at 8% 0%,#e6eee7 0%,transparent 60%),radial-gradient(90% 80% at 95% 10%,#f0e8e2 0%,transparent 55%),var(--mist)}
.wrap{max-width:1000px;margin:0 auto}
.eyebrow{font-size:11px;letter-spacing:.28em;text-transform:uppercase;color:var(--muted);margin-bottom:18px}
h1{font-size:clamp(36px,7vw,72px);font-weight:900;line-height:1.02;letter-spacing:.03em}
.sub{margin-top:12px;font-size:13px;letter-spacing:.16em;text-transform:uppercase;color:var(--muted)}
nav{position:sticky;top:0;z-index:20;background:rgba(247,248,243,.94);backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
.navrow{max-width:1000px;margin:0 auto;display:flex;gap:2px;overflow-x:auto;padding:0 12px;scrollbar-width:none}
.navrow::-webkit-scrollbar{display:none}
nav a{flex:0 0 auto;padding:12px 14px;text-decoration:none;color:var(--muted);font-size:12px;letter-spacing:.06em;border-bottom:2px solid transparent;white-space:nowrap}
nav a b{color:var(--ink);font-weight:600;font-family:"Noto Serif SC",serif}
nav a:hover{color:var(--ink);border-bottom-color:var(--jade)}
main{max-width:1000px;margin:0 auto;padding:0 24px 80px}
section.day{padding-top:52px;border-top:1px solid var(--line);margin-top:44px}
section.day:first-of-type{border-top:none;margin-top:0}
.dayhead{display:flex;align-items:flex-start;gap:20px;flex-wrap:wrap}
.daynum{font-size:13px;font-weight:700;letter-spacing:.2em;color:var(--jade);padding-top:8px;min-width:120px;text-transform:uppercase}
.daynum span{display:block;font-size:11px;letter-spacing:.12em;color:var(--muted);font-weight:400}
.daytitle .zh{font-size:30px;font-weight:900;line-height:1.15}
.daycost{margin-left:auto;background:var(--jade-soft);color:#254e42;padding:4px 10px;font-size:13px}
ol.tl{list-style:none;margin:26px 0 0;padding:0 0 0 24px;border-left:1px solid var(--line)}
ol.tl>li{position:relative;padding:0 0 24px 26px}
ol.tl>li::before{content:"";position:absolute;left:-29px;top:9px;width:9px;height:9px;background:var(--paper);border:1px solid var(--jade);border-radius:50%}
.time{font-size:12px;font-weight:700;letter-spacing:.12em;color:var(--jade);display:block;margin-bottom:2px}
.what{font-size:17px;font-weight:500}
.what .zh{font-weight:600}
.what .en{color:var(--muted);font-size:13px}
.note{font-size:14px;color:var(--muted);margin-top:5px;max-width:62ch}
.cost{display:inline-block;margin-top:7px;font-size:12px;background:var(--jade-soft);color:#254e42;padding:3px 9px}
.empty{margin-top:20px;font-size:14px;color:var(--muted)}
.budget{margin-top:64px;padding-top:48px;border-top:1px solid var(--line)}
h2{font-size:28px;font-weight:900}
h2 span{display:block;font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:var(--muted);font-weight:400;font-family:"Space Grotesk",sans-serif;margin-top:6px}
table{width:100%;border-collapse:collapse;margin-top:24px;font-size:14px}
th,td{text-align:left;padding:10px;border-bottom:1px solid var(--line)}
th{font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--muted);font-weight:500}
td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
tfoot td{font-weight:700;border-bottom:none;border-top:2px solid var(--ink)}
.fine{margin-top:14px;font-size:12px;color:var(--muted);max-width:70ch}
footer{padding:30px 24px 56px;text-align:center;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--muted)}
@media (max-width:640px){header{padding:40px 20px 28px}main{padding:0 18px 56px}.daynum{min-width:auto;padding-top:0}}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
</style>
</head>
<body>
<header>
  <div class="wrap">
    <div class="eyebrow">${itinerary.days.length} days · ${itinerary.days.reduce((n, d) => n + d.items.length, 0)} items</div>
    <h1 class="zh">${esc(itinerary.name)}</h1>
    <div class="sub">Estimated ${esc(formatCostSum(grand))} per person</div>
  </div>
</header>

<nav><div class="navrow">${nav}<a href="#budget"><b>预算</b> <span>Budget</span></a></div></nav>

<main>
${days}

<section class="budget" id="budget">
  <h2 class="zh">预算估算 <span>Estimated spend per person</span></h2>
  <table>
    <thead><tr><th>Day</th><th>What</th><th class="num">Low</th><th class="num">High</th></tr></thead>
    <tbody>${budgetRows}</tbody>
    <tfoot><tr><td colspan="2">Total</td><td class="num">¥${grand.min}</td><td class="num">¥${grand.max}</td></tr></tfoot>
  </table>
  <p class="fine">Summed from the per item estimates in the builder.${
    grand.unknown ? ` ${grand.unknown} item${grand.unknown > 1 ? 's carry' : ' carries'} no estimate and count as zero here.` : ''
  }</p>
</section>
</main>

<footer><span class="zh">一路顺风</span> · Safe travels</footer>
</body>
</html>
`;
}

export function download(filename: string, contents: string, type: string) {
  const url = URL.createObjectURL(new Blob([contents], { type: `${type};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the download has taken the reference.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Escaped ranges, for the same reason as hasCjk in ItemRow. */
export function fileStem(name: string) {
  const ascii = name.replace(/[^-\w\u4e00-\u9fff]+/g, '-').replace(/^-+|-+$/g, '');
  return ascii || 'itinerary';
}
