// Evaluate in Chrome at desktop, laptop and mobile widths; saved preferences are restored.
async () => {
  const assert = (condition, message) => { if (!condition) throw Error(message); };
  for (let i = 0; i < 30 && !document.querySelector('.hmi-main'); i++)
    await new Promise(resolve => setTimeout(resolve, 100));
  const key = 'jph-interface-preferences:' + window.P.S.user.id;
  const saved = localStorage.getItem(key);
  localStorage.setItem(key, JSON.stringify({...JSON.parse(saved || '{}'), fontSize:18}));
  window.P.renderApp();
  try {
  assert(document.documentElement.style.getPropertyValue('--app-font-size') === '18px', 'Select 18px before running the layout check');
  const rect = selector => document.querySelector(selector).getBoundingClientRect();
  const checks = [];
  await window.P.nav('overview');
  for (let i = 0; i < 30 && document.querySelector('.map-weather').textContent.includes('Loading'); i++)
    await new Promise(resolve => setTimeout(resolve, 100));
  assert(rect('main').top >= rect('.topbar').bottom - 1, 'Header overlaps the workspace');
  const port = rect('.port-switch');
  assert(port.top >= rect('.topbar').top && port.bottom <= rect('.topbar').bottom, 'Selected port is clipped');
  const controls = [...document.querySelectorAll('.map-top-left > button,.map-top-left > .map-search')];
  for (let i = 0; i < controls.length; i++) for (let j = i + 1; j < controls.length; j++) {
    const a = controls[i].getBoundingClientRect(), b = controls[j].getBoundingClientRect();
    assert(a.right <= b.left + 1 || b.right <= a.left + 1 || a.bottom <= b.top + 1 || b.bottom <= a.top + 1, 'Map search overlaps a map control');
  }
  assert(rect('.map-top-left').bottom <= rect('.map-weather').top + 1, 'Weather overlaps the map controls');
  assert(rect('.map-weather').bottom <= rect('.map-legend').top + 1, 'Weather overlaps the legend');
  assert(rect('.map-legend').bottom <= rect('.port-map-wrap').bottom + 1, 'Map legend is clipped');
  for (const el of document.querySelectorAll('.metric,.throughput-product'))
    if (el.clientHeight) assert(el.scrollHeight <= el.clientHeight + 1, 'Dashboard summary content is clipped');
  checks.push('header', 'map overlays', 'dashboard summaries');
  for (const page of ['planning', 'center', 'configuration']) {
    await window.P.nav(page);
    if (page === 'center') { window.P.S.tab = 'reports'; window.P.renderApp(); }
    if (page === 'configuration') { window.P.S.configTab = 'rules'; window.P.S.ruleCategory = null; window.P.S.ruleEditor = null; window.P.renderApp(); }
    assert(document.documentElement.scrollWidth <= innerWidth, page + ' overflows horizontally');
    for (const button of document.querySelectorAll('main .btn'))
      if (button.clientWidth) assert(button.scrollWidth <= button.clientWidth + 1, page + ' has a clipped button');
    checks.push(page);
  }
  await window.P.nav('overview');
  return { viewport: innerWidth, fontSize: 18, passed: checks };
  } finally {
    if (saved === null) localStorage.removeItem(key); else localStorage.setItem(key, saved);
    window.P.renderApp();
  }
}
