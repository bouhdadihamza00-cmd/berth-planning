import { assistantState } from './documents.js?v=13';

const POSITION_KEY = 'portside-assistant-position';
let removeResize = () => {};
export function clampChatPosition(position, width, height) {
  return {x: Math.max(8, Math.min(position.x, Math.max(8, width - 48))),
          y: Math.max(8, Math.min(position.y, Math.max(8, height - 48)))};
}


export function mountAssistantChat() {
  const { S, esc, icon, api, nav } = window.P;
  const previous = document.querySelector('#assistant-chat');
  if (previous?.dataset.port === S.portId) return;
  removeResize();
  previous?.remove();
  const chat = S.assistantChat?.port === S.portId ? S.assistantChat : (S.assistantChat = {port:S.portId, open:false, messages:[], draft:'', busy:false});
  const root = document.createElement('div');
  root.id = 'assistant-chat';
  root.dataset.port = S.portId;
  document.body.append(root);
  let position = null;
  let drag = null;
  let suppressClick = false;
  let homePosition = null;
  let opening = false;
  try {
    const saved = JSON.parse(localStorage.getItem(POSITION_KEY));
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) position = saved;
  } catch {}
  function positionPanel() {
    const panel = root.querySelector('.assistant-chat-panel');
    if (!panel || panel.hidden) return;
    const button = root.querySelector('.assistant-chat-launcher').getBoundingClientRect();
    const box = panel.getBoundingClientRect();
    panel.style.left = Math.max(8, Math.min(button.right - box.width, innerWidth - box.width - 8)) + 'px';
    const above = button.top - box.height - 10;
    panel.style.top = Math.max(8, Math.min(above >= 8 ? above : button.bottom + 10, innerHeight - box.height - 8)) + 'px';
  }
  function snap(next) {
    const bounded = clampChatPosition(next, innerWidth, innerHeight);
    return {...bounded, x: bounded.x + 20 < innerWidth / 2 ? 8 : Math.max(8, innerWidth - 48)};
  }
  function closeChat() {
    chat.open=false;
    if (homePosition) { move(snap(homePosition)); homePosition=null; }
    draw();
  }
  async function toggleChat() {
    if (opening) return;
    if (chat.open) { closeChat(); return; }
    const rect=root.getBoundingClientRect();
    homePosition=snap({x:rect.left,y:rect.top});
    opening=true;
    // Establish pixel coordinates so the first move from the default dock animates.
    move(homePosition);
    root.getBoundingClientRect();
    move({x:homePosition.x,y:innerHeight-48});
    await new Promise(resolve=>setTimeout(resolve,180));
    opening=false;
    if (!current()) return;
    chat.open=true;
    draw();
    root.querySelector('textarea').focus();
  }
  function move(next, save = false) {
    position = clampChatPosition(next, innerWidth, innerHeight);
    Object.assign(root.style, {left: position.x + 'px', top: position.y + 'px', right:'auto', bottom:'auto'});
    positionPanel();
    if (save) { try { localStorage.setItem(POSITION_KEY, JSON.stringify(position)); } catch {} }
  }
  root.onpointerdown = event => {
    if (!event.target.closest('.assistant-chat-launcher') || event.button !== 0 || !event.isPrimary) return;
    const rect = root.getBoundingClientRect();
    drag = {id:event.pointerId, x:event.clientX, y:event.clientY, left:rect.left, top:rect.top, moved:false};
    root.querySelector('.assistant-chat-launcher').setPointerCapture(event.pointerId);
  };
  root.onpointermove = event => {
    if (!drag || drag.id !== event.pointerId) return;
    const dx=event.clientX-drag.x, dy=event.clientY-drag.y;
    if (!drag.moved && Math.hypot(dx,dy)<5) return;
    drag.moved=true;
    root.dataset.dragging='true';
    move({x:drag.left+dx,y:drag.top+dy});
  };
  root.onpointerup = event => {
    if (!drag || drag.id !== event.pointerId) return;
    suppressClick=drag.moved;
    if (drag.moved) { const dock=snap(position); if(chat.open) homePosition=dock; move(dock,true); }
    drag=null;
    delete root.dataset.dragging;
    if (root.hasPointerCapture(event.pointerId)) root.releasePointerCapture(event.pointerId);
  };
  root.onpointercancel = () => { if (drag?.moved) move(snap(position),true); drag=null; suppressClick=false; delete root.dataset.dragging; };
  root.addEventListener('click', event => {
    if (suppressClick) { suppressClick=false; event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  root.addEventListener('keydown', event => {
    if (!event.altKey || !event.target.closest('.assistant-chat-launcher') || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const rect=root.getBoundingClientRect();
    move(snap({x:event.key==='ArrowRight'?innerWidth-48:event.key==='ArrowLeft'?8:rect.left,
          y:rect.top+(event.key==='ArrowDown'?10:event.key==='ArrowUp'?-10:0)}),true);
  });
  const resize = () => {
    if (!root.isConnected) { removeResize(); return; }
    if (homePosition) { homePosition=snap(homePosition); move({x:homePosition.x,y:innerHeight-48}); }
    else if (position) move(snap(position),true);
    else positionPanel();
  };
  window.addEventListener('resize',resize);
  removeResize=()=>window.removeEventListener('resize',resize);
  if (position) move(snap(position),true);
  const current = () => S.portId === chat.port && S.assistantChat === chat && root.isConnected;
  const help = question => {
    if (!/help|how (do|can|to)|where (do|can|is)/i.test(question)) return null;
    if (/planning|reschedul|duration|resize/i.test(question)) return 'In Berth planning, drag a vessel card to change its time or berth. Drag the left or right handle to change its start or end. Select Save drafts and enter a reason. The published card stays in place; purple dashed cards show proposed changes. Review and submit them in Workflow center → Approvals.';
    if (/approval|draft/i.test(question)) return 'Open Workflow center → Approvals. Tickets are ordered newest first. Search by ticket, vessel or requester, or filter by status. Open Review details to inspect a change. Submit drafts for review; approved changes must then be published by an authorized user.';
    if (/report|export/i.test(question)) return 'Open Workflow center → Reports. Choose the dataset and date interval, open the filter dropdowns, select the fields you need, then generate a preview before downloading.';
    return 'I can help review operational findings and recommend next steps. For planning, open Berth planning; for approval tickets, notifications and reports, open Workflow center. Use Open assistant for the full operational analysis. Ask “How do I change planning duration?” or “How do approvals work?” for specific steps.';
  };
  async function send(question) {
    question = question.trim();
    if (!question || chat.busy) return;
    chat.messages.push({role:'user', text:question});
    chat.draft = '';
    chat.busy = true;
    draw();
    try {
      const guidance = help(question);
      if (guidance) chat.messages.push({role:'assistant', text:guidance});
      else {
        const recent = chat.messages.slice(-7,-1).map(m => `${m.role}: ${m.text}`).join('\n').slice(-6000);
        const answer = await api('/ports/' + encodeURIComponent(chat.port) + '/intelligence/explain', 'POST', {question: recent ? `Conversation context:\n${recent}\n\nCurrent question: ${question}`.slice(-4000) : question});
        if (!current()) return;
        chat.messages.push({role:'assistant', text:answer.answer || answer.summary || '', citations:answer.citations || []});
        const shared = assistantState();
        shared.question = question;
        shared.answer = answer;
      }
    } catch (error) {
      if (current()) chat.messages.push({role:'error',text:error.message || 'Unable to reach the assistant. Please try again.'});
    } finally {
      chat.busy = false;
      if (current()) { draw(); root.querySelector('textarea')?.focus(); }
    }
  }
  function draw() {
    root.innerHTML = `<section class="assistant-chat-panel" ${chat.open ? '' : 'hidden'} aria-label="Operational assistant chat"><div class="assistant-chat-head"><strong>${icon('brain-circuit')}Operational assistant</strong><button type="button" class="icon-btn" data-chat-close aria-label="Close assistant chat">${icon('x')}</button></div><div class="assistant-chat-context">${esc(S.data.port.name)} · Insights & help</div><div class="assistant-chat-messages" role="log" aria-live="polite">${chat.messages.length ? chat.messages.map(m=>`<div class="assistant-chat-message ${m.role}"><small>${m.role === 'user' ? 'You' : m.role === 'error' ? 'Connection issue' : 'Assistant'}</small><div>${esc(m.text)}</div>${m.citations?.length ? `<small>Finding references: ${m.citations.map(esc).join(', ')}</small>` : ''}</div>`).join('') : '<p>Ask about current operations, review your options, or get help using the platform.</p>'}${chat.busy ? '<p class="subtle">Reviewing your question…</p>' : ''}</div><div class="assistant-chat-prompts">${['What needs attention?', 'What should we prioritize?', 'Help with planning'].map(q=>`<button class="btn small" type="button" data-chat-prompt="${esc(q)}" ${chat.busy ? 'disabled' : ''}>${q}</button>`).join('')}</div><form class="assistant-chat-form"><label class="sr-only" for="assistant-chat-question">Ask the operational assistant</label><textarea id="assistant-chat-question" rows="2" maxlength="2000" required placeholder="Ask for insights or help…">${esc(chat.draft)}</textarea><div class="assistant-chat-actions"><button class="btn small" type="button" data-chat-open-full>Open assistant ${icon('arrow-up-right')}</button><button class="btn primary" type="submit" ${chat.busy ? 'disabled' : ''}>${icon('send')}Send</button></div></form><div class="assistant-chat-foot"><span>Recommendations are advisory.</span></div></section><button type="button" class="assistant-chat-launcher" title="Drag to move · Alt + arrow keys to reposition" aria-label="${chat.open ? 'Close' : 'Open'} operational assistant chat" aria-expanded="${chat.open}" aria-controls="assistant-chat-question">${icon(chat.open ? 'x' : 'messages-square')}</button>`;
    root.querySelector('.assistant-chat-launcher').onclick = toggleChat;
    root.querySelector('[data-chat-close]').onclick = () => {closeChat();root.querySelector('.assistant-chat-launcher').focus();};
    root.querySelector('[data-chat-open-full]').onclick = async () => {closeChat();await nav('assistant');};
    root.querySelector('textarea').oninput = e => {chat.draft=e.target.value;};
    root.querySelector('form').onsubmit = e => {e.preventDefault();send(chat.draft);};
    root.querySelectorAll('[data-chat-prompt]').forEach(b=>b.onclick=()=>send(b.dataset.chatPrompt));
    root.onkeydown = e => {if(e.key==='Escape' && chat.open){e.stopPropagation();closeChat();root.querySelector('.assistant-chat-launcher').focus();}};
    window.P.icons();
    positionPanel();
    const log=root.querySelector('.assistant-chat-messages');log.scrollTop=log.scrollHeight;
  }
  draw();
}
