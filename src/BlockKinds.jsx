import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen, Menu, Plus } from 'lucide-react';
import CoverPicker, { coverIcons } from './CoverPicker.jsx';
import { blockKind, builtInKinds, createKind } from './block-kinds.js';
import './block-kinds.css';

export function BlockIcon({ block, size = 16 }) {
  const Icon = coverIcons[blockKind(block).icon] || BookOpen;
  return <Icon size={size} />;
}

export default function BlockKinds({ kinds, onCreate, onAdd, Modal }) {
  const [columns, setColumns] = useState(3), [panel, setPanel] = useState(null), [name, setName] = useState(''), [icon, setIcon] = useState('brain'), [error, setError] = useState('');
  const grid = useRef(), trigger = useRef();
  const all = [...builtInKinds, ...kinds], capacity = columns * 2;
  useLayoutEffect(() => {
    const measure = () => setColumns(Math.max(1, Math.min(3, Math.floor((grid.current.clientWidth + 8) / 148))));
    measure(); const observer = new ResizeObserver(measure); observer.observe(grid.current); return () => observer.disconnect();
  }, []);
  function close() { setPanel(null); requestAnimationFrame(() => trigger.current?.focus()); }
  function create(event) {
    event.preventDefault(); event.stopPropagation();
    try { const kind = createKind(name, icon, kinds); onCreate(kind); onAdd(kind); close(); }
    catch (error) { setError(error.message); }
  }
  function add(kind) { onAdd(kind); close(); }
  return <>
    <div className="block-kind-toolbar" role="group" aria-label="Adicionar blocos ao plano">
      <div className="block-kind-grid" ref={grid} style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {all.slice(0, capacity).map(kind => {
          const Icon = coverIcons[kind.icon] || BookOpen;
          return <button className="secondary block-kind-chip" key={kind.id} type="button" draggable aria-label={`Adicionar ${kind.name.toLocaleLowerCase('pt-BR')}`} title={`Adicionar ${kind.name}`} onDragStart={event => event.dataTransfer.setData('application/x-organon-block', kind.id)} onClick={() => onAdd(kind)}><Icon size={15} /><span>{kind.name}</span></button>;
        })}
      </div>
      <div className="block-kind-controls">
        <button type="button" className="secondary" aria-label="Criar tipo de atividade" title="Criar tipo de atividade" onClick={event => { trigger.current = event.currentTarget; setName(''); setIcon('brain'); setError(''); setPanel('create'); }}><Plus size={17} /></button>
        {all.length > capacity && <button type="button" className="secondary" aria-label="Todos os tipos de atividade" title="Todos os tipos de atividade" onClick={event => { trigger.current = event.currentTarget; setPanel('all'); }}><Menu size={17} /></button>}
      </div>
    </div>
    {panel && createPortal(<Modal title={panel === 'create' ? 'Novo tipo de atividade' : 'Tipos de atividade'} onClose={close} small className="block-kind-modal">
      {panel === 'create' ? <form className="block-kind-form" onSubmit={create}>
        <label>Nome<input autoFocus aria-label="Nome do tipo de atividade" required maxLength={40} placeholder="Ex.: Revisão" value={name} onChange={event => setName(event.target.value)} /></label>
        <CoverPicker icon={icon} iconOnly context="tipo de atividade" Modal={Modal} onChange={changes => setIcon(changes.icon)} />
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="modal-actions"><button type="button" className="secondary" onClick={close}>Cancelar</button><button type="submit" className="primary">Criar tipo</button></div>
      </form> : <div className="block-kind-list">{all.map(kind => { const Icon = coverIcons[kind.icon] || BookOpen; return <button key={kind.id} type="button" className="secondary" aria-label={`Adicionar ${kind.name.toLocaleLowerCase('pt-BR')}`} onClick={() => add(kind)}><Icon size={18} /><span>{kind.name}</span><Plus size={15} /></button>; })}</div>}
    </Modal>, document.body)}
  </>;
}
