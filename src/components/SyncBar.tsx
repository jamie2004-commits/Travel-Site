import { useEffect, useState } from 'react';
import type { SyncState } from '../lib/tripSync';

/**
 * What the server knows, said only when it is worth saying.
 *
 * Invisible in the steady state. A permanent "Saved" chip on a document that
 * saves itself is noise, and noise is what people learn to stop reading. This
 * appears when something is genuinely different: the connection is gone and
 * work is waiting, or another device changed the trip and somebody has to
 * choose.
 */
export default function SyncBar({ sync }: { sync: SyncState }) {
  // "Saving" only after a moment. Otherwise it flickers on every keystroke
  // burst, which reads as instability rather than as progress.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (sync.status !== 'saving') {
      setSlow(false);
      return;
    }
    const t = window.setTimeout(() => setSlow(true), 800);
    return () => window.clearTimeout(t);
  }, [sync.status]);

  if (sync.conflict) {
    const when = sync.conflict.savedAt ? sync.conflict.savedAt.slice(11, 16) : '';
    const days = sync.conflict.theirs.days?.length ?? 0;
    return (
      <div className="sync-conflict" role="alert">
        <span>
          This trip was also changed somewhere else{when ? ` at ${when}` : ''}. That copy has{' '}
          {days} {days === 1 ? 'day' : 'days'}.
        </span>
        <span className="sync-actions">
          <button type="button" onClick={sync.keepMine}>
            Keep this one
          </button>
          <button type="button" onClick={sync.keepTheirs}>
            Use the other
          </button>
        </span>
      </div>
    );
  }

  if (sync.status === 'offline') {
    return (
      <div className="sync-note">
        Saved on this device. Not reaching the server{sync.message ? `: ${sync.message}` : ''}.
        <button type="button" onClick={sync.retry}>
          Try now
        </button>
      </div>
    );
  }

  if (sync.status === 'error') {
    return (
      <div className="sync-note">
        Not syncing{sync.message ? `: ${sync.message}` : ''}.
        <button type="button" onClick={sync.retry}>
          Try again
        </button>
      </div>
    );
  }

  if (sync.status === 'saving' && slow) {
    return <div className="sync-note quiet">Saving</div>;
  }

  return null;
}
