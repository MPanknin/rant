import { defineConfig } from 'vite';

// Cross-origin isolation raises performance.now() resolution from 100 µs to 5 µs in Chrome,
// which the upload and CPU metrics need. `credentialless` keeps the CORS fetches of sweep data working.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
};

export default defineConfig({
  server: { headers: isolation },
  preview: { headers: isolation },
});
