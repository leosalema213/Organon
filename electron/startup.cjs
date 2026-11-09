class WindowsStartup {
  constructor({ app, path, available }) { this.app = app; this.path = path; this.available = available; this.requested = undefined; this.error = null; }
  status() {
    let enabled = null;
    if (this.available) {
      try { const value = this.app.getLoginItemSettings({ path: this.path, args: ['--autostart'] }); enabled = value.openAtLogin && value.executableWillLaunchAtLogin !== false; }
      catch { this.error = 'Não foi possível consultar a inicialização do Windows.'; }
    }
    return { available: this.available, enabled, preference: this.requested !== false, error: this.error };
  }
  set(value, { preserveSystemChoice = false } = {}) {
    if (typeof value !== 'boolean') throw new Error('Preferência de inicialização inválida.');
    this.requested = value; this.error = null;
    if (this.available) {
      try {
        const current = this.app.getLoginItemSettings({ path: this.path, args: ['--autostart'] });
        const ownItem = item => item.scope === 'user' && item.path?.toLowerCase() === this.path.toLowerCase() && JSON.stringify(item.args) === JSON.stringify(['--autostart']);
        const legacy = current.launchItems?.find(item => item.name === 'Compasso' && ownItem(item));
        if (legacy) {
          const modern = current.launchItems.find(item => item.name === 'Organon' && ownItem(item));
          const enabled = preserveSystemChoice && value ? (modern || legacy).enabled !== false : value;
          this.app.setLoginItemSettings({ openAtLogin: value, enabled, name: 'Organon', path: this.path, args: ['--autostart'] });
          if (value && !this.app.getLoginItemSettings({ path: this.path, args: ['--autostart'] }).launchItems?.some(item => item.name === 'Organon' && ownItem(item) && item.enabled === enabled)) throw new Error('Registro Organon não confirmado.');
          this.app.setLoginItemSettings({ openAtLogin: false, name: 'Compasso', path: this.path, args: ['--autostart'] });
        } else if (!(preserveSystemChoice && value && current.openAtLogin)) this.app.setLoginItemSettings({ openAtLogin: value, enabled: value, name: 'Organon', path: this.path, args: ['--autostart'] });
      } catch { this.error = 'Não foi possível alterar a inicialização do Windows. Tente novamente.'; }
    }
    return this.status();
  }
  sync(settings = {}) {
    const value = settings.startWithWindows !== false;
    return this.requested === value ? undefined : this.set(value, { preserveSystemChoice: true });
  }
}
module.exports = { WindowsStartup };
