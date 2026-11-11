import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import manifest from './scripts/build-manifest.cjs';
import boardFontIntegration from './scripts/board-fonts.cjs';
const boardFonts = path.resolve('node_modules/@excalidraw/excalidraw/dist/prod/fonts');
export default defineConfig({ base: './', optimizeDeps: { exclude: ['@excalidraw/excalidraw'] }, plugins: [react(), {
  name: 'board-offline-fonts',
  enforce: 'pre',
  transform: boardFontIntegration.localizeBoardFonts,
  configureServer(server) {
    server.middlewares.use('/excalidraw/fonts', (request, response, next) => {
      let target;
      try { target = path.resolve(boardFonts, '.' + decodeURIComponent((request.url || '').split('?')[0])); } catch { return next(); }
      if (!target.startsWith(boardFonts + path.sep) || !fs.existsSync(target) || !fs.statSync(target).isFile()) return next();
      response.setHeader('Content-Type', target.endsWith('.woff2') ? 'font/woff2' : 'text/plain');
      fs.createReadStream(target).pipe(response);
    });
  },
}, {
  name: 'pdf-offline-assets',
  closeBundle() {
    for (const directory of ['cmaps', 'standard_fonts', 'wasm']) fs.cpSync(path.resolve('node_modules/pdfjs-dist', directory), path.resolve('dist/pdf-assets', directory), { recursive: true });
    fs.copyFileSync(path.resolve('node_modules/pdfjs-dist/LICENSE'), path.resolve('dist/pdf-assets/LICENSE'));
    fs.cpSync(path.resolve('assets/licenses'), path.resolve('dist/licenses'), { recursive: true });
    fs.cpSync(boardFonts, path.resolve('dist/excalidraw/fonts'), { recursive: true });
    manifest.writeBuildManifest(path.resolve('dist'), JSON.parse(fs.readFileSync('package.json', 'utf8')).version);
  },
}] });
