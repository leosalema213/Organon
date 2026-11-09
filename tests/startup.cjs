const { _electron: electron } = require('playwright');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
(async () => {
  for (const file of process.argv.slice(2)) {
    if (!fs.existsSync(path.join(path.dirname(path.resolve(file)), 'resources/app.asar'))) {
      throw new Error('Meça o executável direto na pasta win-unpacked, sem o extrator portátil.');
    }
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'organon-start-'));
    const start = performance.now();
    let app;
    try {
      app = await electron.launch({ executablePath: path.resolve(file), args: [`--user-data-dir=${userData}`], env, timeout: 60000 });
      const page = await app.firstWindow();
      await page.getByRole('heading', { name: 'Meu dia', exact: true }).waitFor();
      const result = { file, readyMs: Math.round(performance.now() - start), userData: await app.evaluate(({ app }) => app.getPath('userData')) };
      console.log(JSON.stringify(result));
      fs.appendFileSync(path.resolve(__dirname, '../test-output/startup.jsonl'), JSON.stringify(result) + '\n');
    } finally { if (app) await app.close(); }
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
