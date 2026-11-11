// Excalidraw overlays its properties panel on the canvas. Bounds alone do not
// guarantee that a screen position actually reaches the drawing surface.
async function canvasPoint(page, x, y, width = 0, height = 0) {
  const canvas = page.locator('.notebook-board .excalidraw__canvas.interactive');
  await canvas.waitFor();
  return canvas.evaluate((element, { x, y, width, height }) => {
    const bounds = element.getBoundingClientRect();
    const free = (left, top) => [0, 0.25, 0.5, 0.75, 1].every(dx => [0, 0.5, 1].every(dy => document.elementFromPoint(bounds.x + left + width * dx, bounds.y + top + height * dy) === element));
    for (let top = Math.max(12, y); top + height < bounds.height - 12; top += 20) {
      for (let left = Math.max(12, x); left + width < bounds.width - 12; left += 20) {
        if (free(left, top)) return { x: bounds.x + left, y: bounds.y + top };
      }
    }
    throw new Error('Nenhuma área livre do quadro para o gesto: um painel cobre o canvas ou a janela é pequena demais.');
  }, { x, y, width, height });
}

async function drawRectangle(page, x, y, width = 65, height = 50) {
  await page.locator('[data-testid="toolbar-rectangle"]').check({ force: true });
  const point = await canvasPoint(page, x, y, width, height);
  await page.mouse.move(point.x, point.y); await page.mouse.down();
  await page.mouse.move(point.x + width, point.y + height, { steps: 10 }); await page.mouse.up();
}

async function clickCanvas(page, x, y) {
  const point = await canvasPoint(page, x, y);
  await page.mouse.click(point.x, point.y);
}

async function chooseBoardImage(page, filePath) {
  const control = page.locator('.notebook-board label:has([data-testid="toolbar-image"])');
  const nativePicker = await page.evaluate(() => typeof window.showOpenFilePicker === 'function');
  if (nativePicker) {
    // Playwright's filechooser event covers <input type=file>, not Chromium's
    // File System Access dialog. Supply only the selection; decoding stays real.
    const fs = require('node:fs'), path = require('node:path');
    await page.evaluate(({ bytes, name }) => {
      const original = window.showOpenFilePicker;
      window.showOpenFilePicker = async () => {
        window.showOpenFilePicker = original;
        return [{ kind: 'file', name, getFile: async () => new File([Uint8Array.from(bytes)], name, { type: 'image/png' }) }];
      };
    }, { bytes: [...fs.readFileSync(filePath)], name: path.basename(filePath) });
    await control.click();
  } else {
    const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 15000 }), control.click()]);
    await chooser.setFiles(filePath);
  }
  // File decoding is asynchronous. Place the image only once the cursor preview
  // is ready, instead of racing the FileReader/image cache with a canvas click.
  await page.waitForFunction(() => document.querySelector('.notebook-board .excalidraw__canvas.interactive')?.style.cursor.startsWith('url('), null, { timeout: 15000 });
}

module.exports = { canvasPoint, drawRectangle, clickCanvas, chooseBoardImage };
