const path = require('node:path');
const fs = require('node:fs');
const BRAND = 'Organon';
const REPOSITORY = 'leosalema213/Organon';
// Distributed versions validate this exact repository URL; retain it as an update bridge.
const LEGACY_REPOSITORY = 'leosalema213/app-estudos';
const APP_ID = 'br.com.compasso.estudos';
const DEVELOPMENT_APP_ID = APP_ID + '.development';
const INSTALLER_NAMES = ['Organon-Instalar.exe', 'Compasso-Instalar.exe'];
function legacyUserData(appData, exists = fs.existsSync) {
  // Keep the original profile instead of creating an empty Organon profile.
  const candidates = ['compasso-estudos', 'Compasso'];
  const directory = candidates.find(name => exists(path.join(appData, name, 'compasso.json'))) || candidates[0];
  return path.join(appData, directory);
}
function repairDevelopmentShortcut(shell, appData) {
  const shortcut = path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Electron.lnk');
  try {
    const details = shell.readShortcutLink(shortcut);
    if (details.appUserModelId !== APP_ID || path.basename(details.target).toLowerCase() !== 'electron.exe') return false;
    return shell.writeShortcutLink(shortcut, 'update', { appUserModelId: DEVELOPMENT_APP_ID });
  } catch { return false; }
}
module.exports = { BRAND, REPOSITORY, LEGACY_REPOSITORY, APP_ID, DEVELOPMENT_APP_ID, INSTALLER_NAMES, legacyUserData, repairDevelopmentShortcut };
