// Execute the production customInit macro in a tiny NSIS probe. It writes one word
// and exits before any installation: no app files, shortcuts or registry changes.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');
const assert = require('node:assert/strict');
const { NsisScriptGenerator } = require('app-builder-lib/out/targets/nsis/nsisScriptGenerator');
const root = path.resolve(__dirname, '..');
const cache = path.join(os.homedir(), 'AppData/Local/electron-builder/Cache');
function find(directory, name) {
  if (!fs.existsSync(directory)) return null;
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, item.name);
    if (item.isFile() && item.name === name && !file.includes('x86-ansi')) return file;
    if (item.isDirectory()) { const result = find(file, name); if (result) return result; }
  }
  return null;
}
const compiler = find(cache, 'makensis.exe');
const plugin = find(cache, 'StdUtils.dll');
if (!compiler || !plugin) throw new Error('Execute npm run dist primeiro para baixar os componentes do NSIS.');
const output = path.join(root, 'test-output/installer-mode'); fs.mkdirSync(output, { recursive: true });
const executable = path.join(output, 'mode-probe.exe');
const result = path.join(output, 'mode.txt');
const script = path.join(output, 'mode-probe.nsi');
const header = path.join(root, 'node_modules/app-builder-lib/templates/nsis/include/StdUtils.nsh');
const macro = fs.readFileSync(path.join(root, 'build/installer.nsh'), 'utf8').match(/!macro customInit\b[\s\S]*?!macroend/)[0];
const flags = new NsisScriptGenerator(); flags.flags(['updated', 'force-run']);
fs.writeFileSync(script, `Unicode true
RequestExecutionLevel user
Name "Organon installer mode probe"
OutFile "${executable}"
SilentInstall normal
!include "LogicLib.nsh"
!addplugindir /x86-unicode "${path.dirname(plugin)}"
!include "${header}"
${flags.build()}
${macro}
Function .onInit
  !insertmacro customInit
  FileOpen $0 "${result}" w
  IfSilent silent normal
  silent:
    FileWrite $0 "silent"
    Goto finished
  normal:
    FileWrite $0 "normal"
  finished:
    FileClose $0
    SetErrorLevel 0
    Quit
FunctionEnd
Section
SectionEnd
`, 'utf8');
cp.execFileSync(compiler, ['/V2', script], { stdio: 'pipe', windowsHide: true });
for (const [label, args, expected] of [
  ['first installation', [], 'normal'],
  ['legacy updater', ['--updated', '--force-run'], 'silent'],
  ['current updater', ['/S', '--updated', '--force-run'], 'silent'],
  ['updated without restart', ['--updated'], 'normal'],
  ['restart without update', ['--force-run'], 'normal'],
]) {
  if (fs.existsSync(result)) fs.unlinkSync(result);
  cp.execFileSync(executable, args, { timeout: 15000, windowsHide: true, stdio: 'pipe' });
  assert.equal(fs.readFileSync(result, 'utf8'), expected, label);
  console.log(`PASS: ${label} → ${expected}`);
}
