// Evaluate in the running app; this checks UI behavior without changing operational data.
async () => {
  const assert = (value, message) => { if (!value) throw Error(message); };
  await window.P.nav('overview');
  const row = document.querySelector('tr[data-vessel]');
  const trigger = row.querySelector('button.record-link');
  assert(trigger && trigger.tabIndex === 0, 'Vessel action must be a native keyboard-accessible button');
  trigger.focus(); trigger.click();
  const dialog = document.querySelector('dialog:modal');
  assert(dialog && !dialog.hasAttribute('role') && !dialog.hasAttribute('aria-modal'), 'Use native dialog semantics');
  const background = document.querySelector('[data-nav="planning"]');
  background.focus();
  assert(dialog.contains(document.activeElement), 'Background must not receive focus while modal');
  window.P.modal('Confirm removal test', '<form><button id="cancel-test" type="button">Cancel</button><button class="danger" type="submit">Remove</button></form>');
  assert(document.querySelector('dialog:modal') === dialog, 'Replacing modal content must preserve the original invoker');
  assert(document.activeElement.id === 'cancel-test', 'Destructive confirmation must focus the safe action');
  window.P.closeModal();
  assert(document.activeElement === trigger, 'Closing must return focus to the invoker');
  await new Promise(resolve => setTimeout(resolve, 50));
  assert(!document.querySelector('#overlay dialog'), 'Closed dialog must be cleaned up');
  const titles = [];
  for (const page of ['overview', 'planning', 'configuration']) {
    await window.P.nav(page);
    const heading = document.querySelector('main h1').textContent.trim();
    assert(document.title === heading + ' | Portside', 'Browser title must follow the visible page heading');
    titles.push(document.title);
  }
  assert(new Set(titles).size === 3, 'Pages need distinguishable browser titles');
  await window.P.nav('overview');
  return { passed:['native dialog', 'focus containment', 'safe initial focus', 'focus restoration', 'keyboard-accessible record buttons', 'page titles'] };
}
