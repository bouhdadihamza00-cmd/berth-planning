// Evaluate at desktop, laptop and mobile widths. No operational records are changed.
async () => {
  const P=window.P;
  const assert=(condition,message)=>{if(!condition)throw Error(message);};
  const key='jph-interface-preferences:'+P.S.user.id, saved=localStorage.getItem(key);
  const view=Object.fromEntries(['page','tab','configTab','ruleCategory','ruleEditor'].map(name=>[name,P.S[name]]));
  localStorage.setItem(key,JSON.stringify({...JSON.parse(saved||'{}'),fontSize:18}));
  const passed=[];
  const check=label=>{
    assert(document.documentElement.scrollWidth<=innerWidth,label+' overflows the viewport');
    assert(document.querySelector('#workspace-heading'),label+' has no skip target');
    assert(document.querySelector('main').getBoundingClientRect().top>=document.querySelector('.topbar').getBoundingClientRect().bottom-1,label+' overlaps the header');
    for(const b of document.querySelectorAll('main .btn'))if(b.clientWidth)
      assert(b.scrollWidth<=b.clientWidth+1 && b.scrollHeight<=b.clientHeight+1,label+' has a clipped action: '+b.textContent.trim());
    for(const th of document.querySelectorAll('main thead th'))assert(th.scope==='col',label+' has an unscoped column header');
    passed.push(label);
  };
  try {
    for(const page of ['overview','planning','assistant']){
      await P.nav(page);
      if(page==='assistant')for(const tab of document.querySelectorAll('[data-assistant-tab]')){tab.click();check('assistant/'+tab.dataset.assistantTab);}
      else check(page);
    }
    await P.nav('center');
    for(const tab of ['alerts','notifications','approvals','reports']){P.S.tab=tab;P.renderApp();await new Promise(r=>setTimeout(r,100));check('workflow/'+tab);}
    await P.nav('configuration');
    for(const tab of ['general','users','departments','ports','assets','geography','products','rules','imports','integrations']){
      P.S.configTab=tab;P.S.ruleCategory=null;P.S.ruleEditor=null;P.renderApp();await new Promise(r=>setTimeout(r,150));check('configuration/'+tab);
    }
    P.S.configTab='rules';
    for(const category of ['approvals','physical','equipment','cargo','planning','validation']){
      P.S.ruleCategory=category;P.S.ruleEditor=null;P.renderApp();check('rules/'+category);
    }
    return {width:innerWidth,fontSize:18,passed};
  } finally {
    if(saved===null)localStorage.removeItem(key);else localStorage.setItem(key,saved);
    Object.assign(P.S,view);P.renderApp();
  }
}
