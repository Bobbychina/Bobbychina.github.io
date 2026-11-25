(() => {
  const dialog = document.getElementById('game-preview');
  if (typeof dialog.showModal !== 'function') return;

  const grid = document.getElementById('game-shelf');
  const mount = dialog.querySelector('.preview-mount');
  const closeButton = dialog.querySelector('.preview-close');
  const index = document.querySelector('.game-index');
  let current = null;
  let opener = null;
  let shot = 0;

  // The same HTML supplies the native anchor fallback and the modal detail page.
  function selectShot(number) {
    const choices = [...mount.querySelectorAll('.shot-choice')];
    const selected = choices[number];
    if (!selected) return;
    shot = number;
    const picture = mount.querySelector('.shot-full');
    const label = selected.querySelector('span').textContent;
    picture.href = selected.href;
    const image = picture.querySelector('img');
    image.src = selected.href;
    image.alt = label;
    for (const item of choices) {
      if (item === selected) item.setAttribute('aria-current', 'true');
      else item.removeAttribute('aria-current');
    }
  }

  function restoreDetail() {
    if (!current) return;
    current.appendChild(mount.firstElementChild);
    current = null;
  }

  function show(card) {
    if (card === current) return;
    restoreDetail();
    current = card;
    mount.appendChild(card.querySelector('.store-detail'));
    dialog.setAttribute('aria-labelledby', card.id + '-title');
    selectShot(0);
    dialog.showModal();
    dialog.scrollTop = 0;
    document.documentElement.classList.add('preview-open');
    closeButton.focus({preventScroll:true});
  }

  function sync() {
    const card = document.getElementById(location.hash.slice(1));
    if (card && grid.contains(card) && card.matches('.game[id]')) {
      show(card);
    } else if (dialog.open) {
      dialog.close();
      restoreDetail();
      document.documentElement.classList.remove('preview-open');
      if (opener && opener.isConnected) opener.focus({preventScroll:true});
      opener = null;
    }
  }

  function dismiss() {
    if (history.state?.gamePreviewEntry) {
      history.back();
    } else {
      const card = current;
      history.replaceState(history.state, '', location.pathname + location.search);
      sync();
      card?.querySelector('.store-open')?.focus({preventScroll:true});
    }
  }

  for (const link of document.querySelectorAll('.hall-print, #game-index-links a, .store-open')) {
    link.addEventListener('click', event => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      opener = link;
      if (location.hash !== link.hash) {
        history.pushState({...history.state, gamePreviewEntry:true}, '', link.hash);
      }
      sync();
    });
  }
  index.open = Boolean(history.state?.gameIndexOpen);
  index.addEventListener('toggle', () => {
    history.replaceState({...history.state, gameIndexOpen:index.open}, '');
  });
  closeButton.addEventListener('click', dismiss);
  dialog.addEventListener('cancel', event => { event.preventDefault(); dismiss(); });
  dialog.addEventListener('click', event => {
    const choice = event.target.closest('.shot-choice');
    if (!choice || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    selectShot([...mount.querySelectorAll('.shot-choice')].indexOf(choice));
  });
  window.addEventListener('hashchange', sync);
  window.addEventListener('popstate', sync);
  window.addEventListener('pageshow', sync);
  window.I18N?.onChange(() => { if (current) selectShot(shot); });
  document.documentElement.classList.add('store-ready');
  sync();
})();
