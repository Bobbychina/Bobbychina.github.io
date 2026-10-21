(() => {
  'use strict';
  const status = document.getElementById('thanks-status');
  const list = document.getElementById('sponsor-list');
  const updated = document.getElementById('thanks-updated');
  const retry = document.getElementById('thanks-retry');
  let state = 'loading', data = null, requestId = 0;
  const lang = () => I18N.current();
  const t = key => I18N.t('sponsor.' + key);
  const validMonth = value => typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
  const validAmount = value => value === undefined || value === null || (typeof value === 'string' && /^(?:0|[1-9]\d{0,6})\.\d{2}$/.test(value) && Number(value) > 0);

  function validate(input) {
    if (!input || input.version !== 1 || !Array.isArray(input.sponsors) || input.sponsors.length > 1000) throw new Error('Invalid list');
    if (input.updatedAt !== null && (typeof input.updatedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.updatedAt) || Number.isNaN(Date.parse(input.updatedAt)))) throw new Error('Invalid date');
    for (const item of input.sponsors) {
      if (!item || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 40 || /[\x00-\x1f\x7f]/.test(item.name) || !validMonth(item.month) || !validAmount(item.amountCny)) throw new Error('Invalid sponsor');
    }
    return {updatedAt:input.updatedAt, sponsors:input.sponsors.map(item => ({name:item.name.trim(),month:item.month,amountCny:item.amountCny || null}))};
  }
  function render() {
    list.replaceChildren(); list.hidden = true; updated.hidden = true;
    status.hidden = false; retry.hidden = state !== 'error';
    if (state !== 'ready') { status.textContent = t(state === 'error' ? 'error' : 'loading'); return; }
    if (!data.sponsors.length) { status.textContent = t('empty'); return; }
    status.hidden = true; list.hidden = false;
    for (const item of [...data.sponsors].sort((a,b) => b.month.localeCompare(a.month))) {
      const row = document.createElement('li'); row.className = 'sponsor-row';
      const mark = document.createElement('span'); mark.className = 'sponsor-mark'; mark.setAttribute('aria-hidden','true'); mark.textContent = '♡';
      const person = document.createElement('div'); person.className = 'sponsor-person';
      const name = document.createElement('span'); name.className = 'sponsor-name'; name.textContent = item.name;
      const month = document.createElement('time'); month.className = 'sponsor-month'; month.dateTime = item.month;
      const [year, number] = item.month.split('-'); month.textContent = I18N.date(new Date(Number(year),Number(number)-1,1),{year:'numeric',month:'long'});
      person.append(name,month); row.append(mark,person);
      if (item.amountCny) { const amount=document.createElement('span'); amount.className='sponsor-amount'; amount.textContent=I18N.number(Number(item.amountCny),{style:'currency',currency:'CNY'}); row.append(amount); }
      list.append(row);
    }
    if (data.updatedAt) { updated.textContent=I18N.t('sponsor.updatedDate',{date:I18N.date(data.updatedAt,{year:'numeric',month:'long',day:'numeric',timeZone:'UTC'})}); updated.hidden=false; }
  }
  function translate() {
    for (const element of document.querySelectorAll('[data-sponsor-text]')) element.textContent=t(element.dataset.sponsorText);
    for (const element of document.querySelectorAll('[data-sponsor-alt]')) element.alt=t(element.dataset.sponsorAlt);
    document.title=`${t('title')} · Bobbychina`;
    list.setAttribute('aria-label',t('thanks'));
    render();
  }
  async function load() {
    const id=++requestId, controller=new AbortController();
    state='loading'; render();
    const timer=setTimeout(() => controller.abort(),8000);
    try {
      const response=await fetch('/sponsor/thanks.json',{cache:'no-store',credentials:'omit',signal:controller.signal});
      if (!response.ok) throw new Error('List unavailable');
      const next=validate(await response.json());
      if (id!==requestId) return;
      data=next; state='ready';
    } catch { if(id===requestId) state='error'; }
    finally { clearTimeout(timer); if(id===requestId) render(); }
  }
  retry.addEventListener('click',load);
  if (window.I18N?.onChange) I18N.onChange(translate);
  translate(); load();
})();
