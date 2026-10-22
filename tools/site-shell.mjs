// Shared online-game shell. Standalone game sources remain playable offline.
export function injectSiteAuth(html) {
  const shellScript = /<script\b[^>]*\bsrc=["']\/games\/(?:auth-config|site-auth|site-saves)\.js(?:\?[^"']*)?["'][^>]*>\s*<\/script>\s*/gi;
  const account = /<script\b[^>]*\bsrc=["']\/games\/account\.js(?:\?[^"']*)?["'][^>]*>\s*<\/script>/i;
  const existing = html.match(account);
  const defer = existing && /\bdefer\b/.test(existing[0]) ? ' defer' : '';
  const tags = ['auth-config', 'site-auth', 'site-saves'].map(name => `<script${defer} src="/games/${name}.js?v=20261021res1"></script>`).join('\n');
  const i18n = /<script\b[^>]*\bsrc=["']\/i18n\/i18n\.js(?:\?[^"']*)?["'][^>]*>\s*<\/script>\s*/gi;
  let cleaned = html.replace(shellScript, '').replace(i18n,'').replace(/<head>\s*/i,'<head>\n<script src="/i18n/i18n.js?v=20261021res1"></script>\n');
  if (!cleaned.includes('id="site-language"') && cleaned.includes('</body>')) cleaned = cleaned.replace('</body>', '<aside id="site-language" data-i18n-switch aria-label="Language" data-i18n-attr="aria-label:common.language" style="position:fixed;right:12px;bottom:12px;z-index:10000;padding:6px;background:var(--bg,#121110);border-radius:8px"></aside>\n</body>');
  if (existing) return cleaned.replace(account, tags + '\n' + existing[0]);
  if (!cleaned.includes('</head>')) throw new Error('Game page has no </head>');
  return cleaned.replace('</head>', tags + '\n</head>');
}
