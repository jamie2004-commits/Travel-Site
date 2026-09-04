import { describe, it, expect } from 'vitest';
import { buildCatalog, itemTitle } from './catalog';
import type { Place } from '../types';

/**
 * itemTitle used to return an empty string for a stop whose place had left the
 * catalog, so the row rendered as a time with nothing beside it. Migrations
 * 0004 and 0005 delete slugs, so that is reachable from any trip saved before
 * them. These pin the fallback, and pin the field it must not use: two callers
 * read `en` as the name, so a status phrase in there makes them say it.
 */

const place: Place = {
  id: 'west-lake-and-bai-causeway',
  nameZh: '西湖',
  nameEn: 'West Lake',
  city: 'hangzhou',
  district: 'xihu',
  category: 'sight',
  description: '',
  tags: [],
};

const catalog = buildCatalog([place], [], 'bundled');

describe('itemTitle', () => {
  it('names a place that is in the catalog', () => {
    expect(itemTitle(catalog, place.id)).toEqual({ zh: '西湖', en: 'West Lake' });
  });

  it('drops the English name when it repeats the Chinese one', () => {
    const same = buildCatalog([{ ...place, id: 'p', nameEn: '西湖' }], [], 'bundled');
    expect(itemTitle(same, 'p')).toEqual({ zh: '西湖', en: '' });
  });

  it('uses a custom title for an item with no place', () => {
    expect(itemTitle(catalog, undefined, 'Nap')).toEqual({ zh: 'Nap', en: '' });
  });

  it('reads a name back out of a slug the catalog has lost', () => {
    const t = itemTitle(catalog, 'lingyin-temple');
    expect(t.zh).toBe('Lingyin Temple');
    expect(t.note).toBe('no longer in the library');
  });

  it('never puts the note in en, because two callers read en as the name', () => {
    const t = itemTitle(catalog, 'lingyin-temple');
    expect(t.en).toBe('');
    // What EditPage's drag chip and ItemRow's aria-labels resolve to.
    expect(t.zh || t.en).toBe('Lingyin Temple');
  });

  it('says so plainly for a browser-added place, which has no name in its id', () => {
    const t = itemTitle(catalog, 'user:m4x1a-q7f2b');
    expect(t.zh).toBe('Added place');
    expect(t.note).toBe('no longer in the library');
  });

  it('prefers a custom title over reading the slug', () => {
    expect(itemTitle(catalog, 'lingyin-temple', 'Temple morning')).toEqual({
      zh: 'Temple morning',
      en: '',
    });
  });

  it('returns nothing for an item with neither, which is what an empty row is', () => {
    expect(itemTitle(catalog)).toEqual({ zh: '', en: '' });
  });

  it('never throws on an odd slug, and always leaves something to render', () => {
    for (const slug of ['---', 'a', '7', 'in77', '萝春阁', 'x'.repeat(300)]) {
      const t = itemTitle(catalog, slug);
      expect(() => t).not.toThrow();
      // Either a recovered name or the note: never a row with nothing in it.
      expect(Boolean(t.zh || t.note)).toBe(true);
    }
  });

  it('recovers every slug migration 0004 retired', () => {
    const recovered = [
      'west-lake',
      'lingyin-temple',
      'in77',
      'tea-plantation-day',
      'lujiazui-skyline',
      'disneyland',
      'nanxiang-steamed-bun-2',
    ].map((s) => itemTitle(catalog, s).zh);
    expect(recovered).toEqual([
      'West Lake',
      'Lingyin Temple',
      'In77',
      'Tea Plantation Day',
      'Lujiazui Skyline',
      'Disneyland',
      'Nanxiang Steamed Bun 2',
    ]);
  });
});
