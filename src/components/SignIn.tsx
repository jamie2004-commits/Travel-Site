import { useState } from 'react';
import { authAvailable, sendSignInLink, signOut, useAuth } from '../lib/auth';

/**
 * Sign in by emailed link. Renders nothing at all when Supabase is not
 * configured, since there would be nothing to sign into.
 */
export function SignIn() {
  const { email, loading } = useAuth();
  const [value, setValue] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [open, setOpen] = useState(false);

  if (!authAvailable || loading) return null;

  if (email) {
    return (
      <span className="signin signed-in">
        <span className="signin-who" title={email}>
          {email}
        </span>
        <button type="button" className="signin-link" onClick={() => void signOut()}>
          退出 Sign out
        </button>
      </span>
    );
  }

  if (!open) {
    return (
      <button type="button" className="signin-link" onClick={() => setOpen(true)}>
        登入 Sign in
      </button>
    );
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSending(true);
    setNote(null);
    const result = await sendSignInLink(value);
    setNote(result.message);
    setSending(false);
  };

  return (
    <form className="signin" onSubmit={(e) => void submit(e)}>
      <input
        type="email"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="you@example.com"
        aria-label="Email for the sign in link"
        autoComplete="email"
        required
      />
      <button type="submit" disabled={sending}>
        {sending ? '寄送中…' : '寄連結 Send link'}
      </button>
      {note && <span className="signin-note">{note}</span>}
    </form>
  );
}
