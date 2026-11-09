// Render the editable SVG with Chromium and package PNG frames into a Windows ICO.
const { _electron: electron } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const root = path.resolve(__dirname, '..');
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
(async () => {
  const app = await electron.launch({ args: [root, `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), 'organon-icon-'))}`], env });
  try {
    const page = await app.firstWindow();
    const svg = fs.readFileSync(path.join(root, 'assets/icon.svg'), 'utf8');
    const frames = [];
    for (const size of [16, 24, 32, 48, 64, 128, 256]) {
      const data = await page.evaluate(async ({ svg, size }) => {
        const img = new Image();
        img.src = 'data:image/svg+xml;base64,' + btoa(svg);
        await img.decode();
        const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
        canvas.getContext('2d').drawImage(img, 0, 0, size, size);
        return canvas.toDataURL('image/png').split(',')[1];
      }, { svg, size });
      const png = Buffer.from(data, 'base64');
      frames.push({ size, png });
      if (size === 256) fs.writeFileSync(path.join(root, 'assets/icon.png'), png);
    }
    const header = Buffer.alloc(6 + frames.length * 16);
    header.writeUInt16LE(1, 2); header.writeUInt16LE(frames.length, 4);
    let offset = header.length;
    frames.forEach(({ size, png }, i) => {
      const entry = 6 + i * 16;
      header[entry] = header[entry + 1] = size === 256 ? 0 : size;
      header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6);
      header.writeUInt32LE(png.length, entry + 8); header.writeUInt32LE(offset, entry + 12);
      offset += png.length;
    });
    fs.writeFileSync(path.join(root, 'assets/icon.ico'), Buffer.concat([header, ...frames.map(f => f.png)]));
    console.log('Created icon.ico with 7 sizes, icon.png and editable icon.svg.');
  } finally { await app.close(); }
})().catch(err => { console.error(err); process.exitCode = 1; });
