const P = () => window.P;
const types = kind => [
  ['max_loa', 'Maximum vessel length (m)'],
  ['max_draft', 'Maximum vessel draft (m)'],
  kind === 'berths' ? ['buffer_hours', 'Minimum safety gap (h)'] : ['capacity', 'Maximum handling rate (t/h)'],
];
export function renderAssetConstraints(kind) {
  const { S, esc, cardHead, can, icon } = P();
  const rows = (S.data.port.rules.asset_constraints || []).filter(r => r.kind === kind);
  return `<button class="btn small" id="rule-categories-back">← Rule categories</button><section class="card rule-list-page">${cardHead(kind === 'berths' ? 'Physical constraints' : 'Equipment constraints', kind === 'berths' ? 'anchor' : 'construction')}<div class="rule-category-intro"><p>Add limits for existing ${kind === 'berths' ? 'berths' : 'equipment'}. Additional constraints tighten the asset’s base limits; removing a constraint keeps the infrastructure.</p></div><div class="toolbar"><span class="subtle">${rows.length} constraints</span><div class="spacer"></div>${can('config.edit') ? `<button class="btn primary" id="add-asset-constraint">${icon('plus')}Add constraint</button>` : ''}</div><div class="table-scroll"><table><thead><tr><th scope=\"col\">Constraint</th><th scope=\"col\">Applies to</th><th scope=\"col\">Limit</th><th scope=\"col\">Status</th><th scope=\"col\">Actions</th></tr></thead><tbody>${rows.map(r => `<tr><td><strong>${esc(r.name)}</strong></td><td>${esc(S.data[kind].find(x => x.id === r.asset_id)?.name || 'Unavailable asset')}</td><td>${esc(types(kind).find(([id]) => id === r.field)?.[1])}: ${esc(r.value)}</td><td>${r.enabled ? 'Enabled' : 'Disabled'}</td><td>${can('config.edit') ? `<button class="btn small" data-constraint-edit="${esc(r.id)}">Edit</button><button class="btn small danger" data-constraint-remove="${esc(r.id)}">Remove</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5">No additional constraints. Base asset limits still apply.</td></tr>'}</tbody></table></div></section>`;
}
export function bindAssetConstraints(kind) {
  const { S, api, path, modal, field, select, handleForm, closeModal, refresh, toast, esc } = P();
  const rules = S.data.port.rules;
  const save = async constraints => {
    await api(path('/configuration/rules'), 'POST', { port_revision: S.data.port.revision, rules: { ...rules, asset_constraints: constraints }, berths: [] });
    closeModal(); await refresh();
  };
  const edit = existing => {
    const r = existing || { id: crypto.randomUUID(), name: '', asset_id: '', field: 'max_loa', value: '', enabled: true };
    modal(existing ? 'Edit constraint' : 'Add constraint', `<form id="asset-constraint-form"><div class="form-grid">${field('Constraint name', 'name', r.name, 'text', 'required maxlength="160"')}${select(kind === 'berths' ? 'Berth' : 'Equipment', 'asset_id', [['', 'Choose an existing asset'], ...S.data[kind].map(x => [x.id, (x.code ? x.code + ' · ' : '') + x.name])], r.asset_id)}${select('Constraint type', 'field', types(kind), r.field)}${field('Limit (units shown in constraint type)', 'value', r.value, 'number', 'min="0" step="any" required')}${select('Status', 'enabled', [['true','Enabled'],['false','Disabled']], String(r.enabled))}</div><div class="form-actions"><button class="btn primary" type="submit">Save constraint</button></div></form>`);
    handleForm('#asset-constraint-form', async d => {
      if (!d.asset_id) throw Error('Choose an existing asset');
      const item = { id:r.id, kind, name:d.name.trim(), asset_id:d.asset_id, field:d.field, value:Number(d.value), enabled:d.enabled === 'true' };
      await save([...(rules.asset_constraints || []).filter(x => x.id !== r.id), item]); toast('Constraint saved');
    });
  };
  document.querySelector('#add-asset-constraint')?.addEventListener('click', () => edit());
  document.querySelectorAll('[data-constraint-edit]').forEach(b => b.onclick = () => edit(rules.asset_constraints.find(r => r.id === b.dataset.constraintEdit)));
  document.querySelectorAll('[data-constraint-remove]').forEach(b => b.onclick = () => {
    const r = rules.asset_constraints.find(r => r.id === b.dataset.constraintRemove);
    modal('Remove constraint', `<form id="remove-constraint-form"><p>Remove ${esc(r.name)}? The asset and its base limits remain.</p><div class="form-actions"><button class="btn" type="button" id="cancel-constraint-remove">Cancel</button><button class="btn danger" type="submit">Remove constraint</button></div></form>`);
    document.querySelector('#cancel-constraint-remove').onclick = closeModal;
    handleForm('#remove-constraint-form', async () => { await save(rules.asset_constraints.filter(x => x.id !== r.id)); toast('Constraint removed'); });
  });
}
