import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderTemplate, headerSafe } from './templates';

test("headerSafe coupe les sauts de ligne — injection d'en-tete", () => {
  assert.equal(headerSafe('Bonjour\r\nBcc: attaquant@evil.com'), 'Bonjour Bcc: attaquant@evil.com');
  assert.equal(headerSafe('a\nb'), 'a b');
  assert.equal(headerSafe('a\u2028b'), 'a b'); // separateur de ligne unicode
  assert.equal(headerSafe('a\u0000b'), 'a b'); // NUL
  assert.equal(headerSafe(null), '');
});

test("aucun champ d'en-tete rendu ne porte de CR/LF", () => {
  const evil = 'Titre\r\nBcc: attaquant@evil.com\r\nX-Injecte: oui';
  for (const template of ['notification', 'welcome', 'form-submission'] as const) {
    const r = renderTemplate(template, { title: evil, subject: evil, preheader: evil }, { appName: evil });
    for (const field of ['subject', 'preheader', 'fromName'] as const) {
      assert.ok(!/[\r\n]/.test(r[field]), `${template}.${field} porte un saut de ligne`);
    }
  }
});

test("le corps HTML echappe les variables fournies par l'appelant", () => {
  const r = renderTemplate(
    'notification',
    {
      title: '<img src=x onerror=alert(1)>',
      body: '<script>alert(2)</script>',
      ctaUrl: 'javascript:alert(3)',
      ctaLabel: 'Clic',
    },
    { appName: 'Test' },
  );
  assert.ok(!r.html.includes('<img src=x'), 'balise img brute dans le HTML');
  assert.ok(!r.html.includes('<script>alert(2)'), 'balise script brute dans le HTML');
  assert.ok(!r.html.includes('javascript:alert(3)'), 'href javascript: conserve');
  assert.ok(r.html.includes('&lt;img src=x'), 'la valeur echappee devrait etre presente');
});
