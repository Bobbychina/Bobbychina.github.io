(function () {
  'use strict';
  const button = document.getElementById('lanButton');
  if (!button) return;
  button.replaceChildren(document.createTextNode('线上论剑'));
  const arrow = document.createElement('span');
  arrow.setAttribute('aria-hidden', 'true'); arrow.textContent = '↗'; button.append(arrow);
  button.addEventListener('click', event => {
    event.preventDefault(); event.stopImmediatePropagation();
    location.assign(new URL('online/', location.href));
  }, true);
})();
