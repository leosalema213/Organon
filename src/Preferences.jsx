import { useEffect, useRef, useState } from 'react';
import { Bell, Check, Download, Monitor, Moon, Palette, Sun, Upload } from 'lucide-react';
import { themePresets } from './model.js';
import { UpdateSettings } from './Updates.jsx';
import { CloudPanel } from './CloudAccount.jsx';
import PluginSettings from './plugin-system/PluginSettings.jsx';

const allSections = [['appearance', 'Aparência'], ['general', 'Geral'], ['account', 'Conta'], ['plugins', 'Plugins'], ['backup', 'Backup'], ['updates', 'Atualizações']];
const modes = [['system', 'Dispositivo', Monitor], ['light', 'Claro', Sun], ['dark', 'Escuro', Moon], ['custom', 'Personalizado', Palette]];

export default function Preferences({ settings, onChange, onClose, onTestSound, onBackup, onImport, onTutorial, updates, account, Modal }) {
  const [tab, setTab] = useState(account?.status?.user ? 'account' : 'appearance');
  const sections = allSections.filter(([key]) => key !== 'account' || account?.status?.enabled !== false);
  const [startup, setStartup] = useState(null);
  const [startupBusy, setStartupBusy] = useState(false);
  useEffect(() => { window.desktop?.startup?.status().then(setStartup).catch(() => setStartup({ error: 'Não foi possível consultar a inicialização do Windows.' })); }, []);
  async function changeStartup() {
    if (!window.desktop?.startup) return;
    const enabled = !settings.startWithWindows; setStartupBusy(true);
    try { const result = await window.desktop.startup.set(enabled); setStartup(result); if (!result.error) onChange({ startWithWindows: enabled }); }
    catch { setStartup({ error: 'Não foi possível alterar a inicialização do Windows. Tente novamente.' }); }
    finally { setStartupBusy(false); }
  }
  const tabRefs = useRef([]);
  function navigate(event, index) {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? sections.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + sections.length) % sections.length;
    setTab(sections[next][0]); tabRefs.current[next]?.focus();
  }
  return <Modal panel title="Preferências" onClose={onClose} className="preferences-modal">
    <div className="preferences-tabs" role="tablist" aria-label="Categorias de preferências">{sections.map(([key, label], i) => <button key={key} ref={el => tabRefs.current[i] = el} role="tab" id={`preferences-tab-${key}`} aria-controls={`preferences-panel-${key}`} aria-selected={tab === key} tabIndex={tab === key ? 0 : -1} onClick={() => setTab(key)} onKeyDown={e => navigate(e, i)}>{label}</button>)}</div>
    <section className="preferences-panel" role="tabpanel" id={`preferences-panel-${tab}`} aria-labelledby={`preferences-tab-${tab}`} tabIndex={0}>
      {tab === 'appearance' && <>
        <div className="preference-section"><h3>Tema</h3><div className="theme-modes" role="group" aria-label="Tema do aplicativo">{modes.map(([key, label, Icon]) => <button key={key} className={settings.theme === key ? 'selected' : ''} aria-pressed={settings.theme === key} onClick={() => onChange({ theme: key })}><Icon size={18} /><span>{label}</span>{settings.theme === key && <Check size={12} />}</button>)}</div>
          {settings.theme === 'custom' && <div className="theme-presets" role="group" aria-label="Temas personalizados">{themePresets.map(preset => <button key={preset.id} className={`theme-preset ${settings.palette === preset.id ? 'selected' : ''}`} aria-pressed={settings.palette === preset.id} style={{ '--swatch-bg': preset.background, '--swatch-surface': preset.surface, '--swatch-accent': preset.accent, '--swatch-text': preset.text }} onClick={() => onChange({ palette: preset.id })}><span className="theme-sample"><i /><span><b /><i /><i /></span></span><span className="theme-preset-label">{preset.name}{settings.palette === preset.id && <Check size={13} />}</span></button>)}</div>}
        </div>
        <div className="preference-section"><h3>Espaçamento</h3><div className="density-options" role="group" aria-label="Espaçamento da interface">{[['minimal', 'Mínimo', 'Mais conteúdo'], ['compact', 'Compacto', 'Padrão'], ['comfortable', 'Confortável', 'Mais espaço']].map(([key, label, hint]) => <button key={key} className={settings.density === key ? 'selected' : ''} aria-pressed={settings.density === key} onClick={() => onChange({ density: key })}><strong>{label}</strong><small>{hint}</small></button>)}</div></div>
      </>}
      {tab === 'general' && <>
        <div className="preference-section"><div className="setting-row"><div><h3>Iniciar com o Windows</h3><p>Abre o Organon automaticamente ao entrar na sua conta do Windows.</p></div><button className={`toggle ${settings.startWithWindows ? 'on' : ''}`} role="switch" aria-checked={settings.startWithWindows} aria-label="Iniciar com o Windows" disabled={startupBusy || !window.desktop?.startup} onClick={changeStartup}><i /></button></div>{startup?.error && <p role="alert">{startup.error}</p>}{startup?.available === false && <p>A preferência será aplicada quando o Organon estiver instalado.</p>}{startup?.available && settings.startWithWindows && startup.enabled === false && <p>A inicialização está desativada nas configurações do Windows.</p>}</div>
        <div className="preference-section"><div className="setting-row"><div><h3>Tempo ao concluir manualmente</h3><p>Ao dar check, completa o tempo cadastrado no bloco sem somar duas vezes. Desfazer o check retira apenas esse acréscimo manual.</p></div><button className={`toggle ${settings.creditManualTime ? 'on' : ''}`} role="switch" aria-checked={settings.creditManualTime} aria-label="Contabilizar tempo ao concluir manualmente" onClick={() => onChange({ creditManualTime: !settings.creditManualTime })}><i /></button></div></div>
        <div className="preference-section"><div className="setting-row"><div><h3>Som de conclusão</h3><p>Um aviso quando a aula ou o descanso terminar.</p></div><button className={`toggle ${settings.sound ? 'on' : ''}`} role="switch" aria-checked={settings.sound} aria-label="Som de conclusão" onClick={() => onChange({ sound: !settings.sound })}><i /></button></div><button className="secondary" onClick={onTestSound}><Bell size={15} />Testar som</button></div>
        <div className="preference-section"><h3>Como funciona</h3><p>O próximo bloco começa quando você der play. Fechar o aplicativo pausa a sessão.</p><button className="secondary" onClick={onTutorial}>Como usar o Organon</button></div>
      </>}
      {tab === 'account' && <CloudPanel account={account} Modal={Modal} />}
      {tab === 'plugins' && <PluginSettings />}
      {tab === 'backup' && <div className="preference-section"><h3>Seus dados pessoais</h3><p>Exporte planos, histórico, anotações e imagens em um único arquivo. O backup permite restaurar seus dados ou levá-los para outro computador.</p><p>Espaços, quadros, financeiro, MEI e cópias compartilhadas ficam na conta online e não entram neste arquivo. O financeiro e o MEI têm suas próprias opções de exportação.</p><div className="button-row"><button className="primary" onClick={onBackup}><Download size={16} />Exportar backup</button>{window.desktop ? <button className="secondary" onClick={() => onImport()}><Upload size={16} />Importar backup</button> : <label className="secondary file-label"><Upload size={16} />Importar backup<input type="file" accept=".json" onChange={e => e.target.files[0] && onImport(e.target.files[0])} /></label>}</div></div>}
      {tab === 'updates' && <div className="preference-section"><h3>Versão e atualizações</h3><UpdateSettings updates={updates} /><p>Novas versões são verificadas ao abrir. Você escolhe quando baixar e aplicar a atualização.</p></div>}
    </section>
    <div className="preferences-footer"><span>Preferências salvas automaticamente</span><button className="secondary" onClick={onClose}>Concluir</button></div>
  </Modal>;
}
