const P = () => window.P;
export function confirmRemoval(url, label, detail, after = () => P().refresh(), payload) {
  const { modal, esc, handleForm, api, closeModal, toast } = P();
  modal('Remove entry', `<form id="remove-entry-form"><p>Remove <strong>${esc(label)}</strong>?</p><p class="config-description">${esc(detail)}</p><div class="form-actions"><button class="btn" type="button" id="cancel-remove-entry">Cancel</button><button class="btn danger" type="submit">Remove entry</button></div></form>`);
  document.querySelector('#cancel-remove-entry').onclick = closeModal;
  handleForm('#remove-entry-form', async () => {
    await api(url, 'DELETE', payload);
    closeModal();
    await after();
    toast('Entry removed');
  });
}
