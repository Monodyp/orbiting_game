import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  envDir: '../..',
  // Only the explicitly supplied character directory is served as runtime GLB assets.
  publicDir: '../../assets/character',
  server: {
  strictPort: true,
  allowedHosts: true,
},
});
