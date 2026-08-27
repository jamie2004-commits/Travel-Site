import { useEffect, useState } from 'react';
import type { City } from './types';
import LibraryPane from './components/LibraryPane';

export default function App() {
  const [city, setCity] = useState<City>('hangzhou');

  // Drives the per city accent pair in index.css.
  useEffect(() => {
    document.documentElement.dataset.city = city;
  }, [city]);

  return (
    <div className="flex h-full flex-col" style={{ background: 'var(--bg)' }}>
      <header
        className="shrink-0 border-b px-4 py-4"
        style={{ borderColor: 'var(--line)', background: 'var(--mist)' }}
      >
        <p className="eyebrow">Itinerary Builder</p>
        <h1 className="zh text-[26px] leading-tight font-black">行程编排</h1>
      </header>

      <main className="min-h-0 flex-1">
        <LibraryPane city={city} onCityChange={setCity} />
      </main>
    </div>
  );
}
