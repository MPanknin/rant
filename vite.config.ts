import {defineConfig} from 'vite';

export default defineConfig({
  server: {allowedHosts: ['terminal.local']},
  build: {rollupOptions: {input: ['index.html', 'cases/rellis/index.html']}},
});
