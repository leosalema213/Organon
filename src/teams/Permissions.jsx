import React from 'react';

export const emptyGrants = () => Object.fromEntries(['notebooks', 'books', 'kanban', 'financeiro'].map(k => [k, { mode: 'none', ids: [], write: false }]));
export const MODULE_LABELS = { notebooks: 'Cadernos', books: 'Livros', kanban: 'Quadros', financeiro: 'Financeiro' };

export default function Permissions({ value, onChange, catalog = {}, disabled = false }) {
  function change(module, patch) { onChange({ ...value, [module]: { ...value[module], ...patch } }); }
  return <fieldset className="teams-permissions" disabled={disabled}><legend>Acesso compartilhado</legend>
    {Object.entries(MODULE_LABELS).map(([module, label]) => {
      const grant = value[module] || { mode: 'none', ids: [], write: false };
      const selected = module === 'notebooks' || module === 'kanban';
      return <div className="teams-permission" key={module}>
        <label>{label}<select aria-label={`Escopo de ${label}`} value={grant.mode} onChange={e => change(module, { mode: e.target.value, ids: [], write: e.target.value === 'none' ? false : grant.write })}>
          <option value="none">Nenhum</option><option value="all">Todos, incluindo futuros</option>{selected && <option value="selected">Selecionados</option>}
        </select></label>
        {grant.mode !== 'none' && <label className="teams-check"><input type="checkbox" checked={grant.write === true} onChange={e => change(module, { write: e.target.checked })} />Permitir edição</label>}
        {grant.mode === 'selected' && <div className="teams-resource-options">
          {(catalog[module] || []).map(item => <label className="teams-check" key={item.id}><input type="checkbox" checked={grant.ids.includes(item.id)} onChange={e => change(module, { ids: e.target.checked ? [...grant.ids, item.id] : grant.ids.filter(id => id !== item.id) })} />{item.name}</label>)}
          {grant.ids.filter(id => !(catalog[module] || []).some(item => item.id === id)).map(id => <label className="teams-check" key={id}><input type="checkbox" checked onChange={() => change(module, { ids: grant.ids.filter(x => x !== id) })} />Recurso fora do catálogo ({id})</label>)}
          {!(catalog[module] || []).length && <small>Não há recursos disponíveis neste catálogo. Publique os cadernos antes de selecioná-los.</small>}
        </div>}
      </div>;
    })}
    <small>MEI, meu dia, planos, progresso, notas e Anki permanecem pessoais. Cadernos e livros só aparecem para a equipe após a publicação de uma cópia individual.</small>
  </fieldset>;
}
