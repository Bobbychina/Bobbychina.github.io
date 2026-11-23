'use strict';
const UI = (() => {
  const paths = {
    logo: '<path fill="#68dfb0" stroke="none" d="m12 1 10 5.5v11L12 23 2 17.5v-11z"/><path fill="#16382f" stroke="none" d="m12 4 6.7 3.7L12 11.4 5.3 7.7zm-7 6 5.7 3.2v6L5 16zm8.4 3.2 5.6-3.1v6l-5.6 3.1z"/>',
    layers: '<path d="m3 8 9-5 9 5-9 5zM3 12l9 5 9-5M3 16l9 5 9-5"/>',
    terminal: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="m7 9 3 3-3 3m6 0h4"/>',
    book: '<path d="M12 6c-2-2-6-2.5-9-1v14c3-1.5 7-1 9 1 2-2 6-2.5 9-1V5c-3-1.5-7-1-9 1zm0 0v14"/>',
    play: '<path d="m8 4 12 8-12 8z" fill="currentColor" stroke="none"/>',
    pause: '<path d="M7 5v14m10-14v14" stroke-width="4"/>',
    step: '<path d="m5 5 10 7-10 7zM19 5v14"/>',
    reset: '<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/>',
    arrowRight: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
    workflow:
      '<rect x="2.5" y="4.5" width="7" height="7" rx="1.3"/><rect x="14.5" y="12.5" width="7" height="7" rx="1.3"/><path d="M6 12v4h8"/>',
    cursor: '<path d="m5 3 14 10-6 1-2 6z"/>',
    hand: '<path d="M8 13V7a1.5 1.5 0 0 1 3 0v5-8a1.5 1.5 0 0 1 3 0v8-6a1.5 1.5 0 0 1 3 0v7-4a1.5 1.5 0 0 1 3 0v7c0 4-3 6-6 6h-1c-3 0-4-1-6-4l-3-5c-1-2 1-3 2-2z"/>',
    erase: '<path d="m14 3 7 7-11 11H7l-5-5zM7 11l7 7m-4 3h11"/>',
    axis: '<path d="M5 3v15h15M2 6l3-3 3 3m9 9 3 3-3 3"/>',
    fit: '<path d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5"/>',
    sliders:
      '<path d="M3 6h5m4 0h9M3 12h10m4 0h4M3 18h3m4 0h11"/><circle cx="10" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="8" cy="18" r="2"/>',
    trash: '<path d="M3 6h18M9 6V3h6v3M6 7l1 14h10l1-14M10 10v7m4-7v7"/>',
    search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
    close: '<path d="m5 5 14 14m0-14L5 19"/>',
    screen: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M9 21h6m-3-4v4"/>',
    bag: '<rect x="4" y="7" width="16" height="14" rx="2"/><path d="M8 8V6a4 4 0 0 1 8 0v2M4 13h16"/>',
    score: '<path d="M4 20v-6h4v6m2 0V9h4v11m2 0V4h4v16"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18m-9-9c5 6 5 12 0 18-5-6-5-12 0-18z"/>',
    gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v9h14v-9M12 8v13m0-13C4 9 5 0 10 4zm0 0c8 1 7-8 2-4z"/>',
    text: '<path d="M3 5h18M12 5v15m-5 0h10M3 5v3m18-3v3"/>',
    branch:
      '<circle cx="6" cy="5" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="6" cy="19" r="2"/><path d="M6 7v10m0-2c7 0 12-2 12-7"/>',
    entity: '<path d="m12 2 9 5v10l-9 5-9-5V7zM3 7l9 5 9-5m-9 5v10"/>',
    pin: '<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0z"/><circle cx="12" cy="10" r="2"/>',
    check: '<path d="m4 12 5 5L20 6"/>',
    bolt: '<path d="M13 2 4 14h7l-1 8 10-13h-8z"/>',
    code: '<path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18"/>',
  };
  function icon(k) {
    return (
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      (paths[k] || '') +
      '</svg>'
    );
  }
  function icons(root = document) {
    root.querySelectorAll('[data-icon]').forEach((el) => (el.innerHTML = icon(el.dataset.icon)));
  }
  const esc = (s) =>
    String(s ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  const colors = {
    gold: '#ffce73',
    aqua: '#6befe4',
    green: '#81ef95',
    dark_green: '#479957',
    red: '#ff7770',
    dark_red: '#bd5353',
    yellow: '#fff27a',
    blue: '#7388ff',
    dark_blue: '#596ac0',
    light_purple: '#ffa3ed',
    dark_purple: '#ba77c8',
    white: '#ffffff',
    gray: '#ccc',
    dark_gray: '#777',
    black: '#181818',
    dark_aqua: '#50b1ab',
  };
  const color = (k) => (Object.hasOwn(colors, k) ? colors[k] : /^#[a-f\d]{6}$/i.test(k) ? k : '#ffffff');
  function itemIcon(item, size = 32) {
    const n = ITEM_ICONS[item.id === 'grass_block' ? 'grass_block_side' : item.id];
    if (n === undefined)
      return (
        '<span class="generic-item" style="width:' +
        size +
        'px;height:' +
        size +
        'px">' +
        icon('entity') +
        '</span>'
      );
    return (
      '<span class="item-icon" style="width:' +
      size +
      'px;height:' +
      size +
      'px;background-size:' +
      size * 16 +
      'px auto;background-position:-' +
      (n % 16) * size +
      'px -' +
      Math.floor(n / 16) * size +
      'px"></span>'
    );
  }
  function formatted(parts) {
    const mapping = [
      'black',
      'dark_blue',
      'dark_green',
      'dark_aqua',
      'dark_red',
      'dark_purple',
      'gold',
      'gray',
      'dark_gray',
      'blue',
      'green',
      'aqua',
      'red',
      'light_purple',
      'yellow',
      'white',
    ];
    let legacy = {};
    return (parts || [])
      .map((part) =>
        String(part.text ?? '')
          .split(/(§[0-9a-flmnor])/gi)
          .map((piece) => {
            if (/^§[0-9a-flmnor]$/i.test(piece)) {
              const k = piece[1].toLowerCase();
              if (/[0-9a-f]/.test(k)) legacy = { color: mapping[parseInt(k, 16)] };
              else if (k === 'r') legacy = {};
              else legacy[{ l: 'bold', m: 'strikethrough', n: 'underlined', o: 'italic' }[k]] = true;
              return '';
            }
            const s = { ...part, ...legacy },
              style =
                (s.color ? 'color:' + color(s.color) + ';' : '') +
                (s.bold ? 'font-weight:800;' : '') +
                (s.italic ? 'font-style:italic;' : '') +
                (s.underlined || s.strikethrough
                  ? 'text-decoration:' +
                    [s.underlined ? 'underline' : '', s.strikethrough ? 'line-through' : ''].join(' ') +
                    ';'
                  : '');
            return '<span style="' + style + '">' + esc(piece) + '</span>';
          })
          .join(''),
      )
      .join('');
  }
  return { icon, icons, esc, color, itemIcon, formatted };
})();
