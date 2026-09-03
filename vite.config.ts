import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  // Pinned, not left to Vite's default 5173: the sign in link Supabase emails
  // comes back to the project's Site URL, which is http://localhost:3000 out
  // of the box. On any other port the link lands on nothing and the browser
  // says the connection was refused. strictPort makes a busy port an error
  // rather than a silent hop to 3001, which would break the link the same way.
  server: { port: 3000, strictPort: true },
});
