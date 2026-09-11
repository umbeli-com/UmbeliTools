/**
 * Branded email templates for the Umbelium suite.
 *
 * The HTML shell, the brand tokens and the auth copy are lifted from
 * UmbeliumManager/backend/src/services/email.service.js (brandedEmail /
 * renderAuthEmail / brandedText), so every app in the suite sends the same
 * looking email. The form-submission table mirrors the one Webum hand-builds
 * in apps/api/src/services/notification.service.ts (formatSubmissionHtml) —
 * with every value HTML-escaped, which the Webum original does not do.
 *
 * Rules that matter here:
 *  - Table-based layout + inline styles only (no flex/grid/float): survives
 *    Outlook's Word rendering engine. Bulletproof VML button for MSO.
 *  - EVERY interpolated value goes through esc() / safeUrl() / safeColor():
 *    template vars carry end-user input (form submissions, display names).
 *  - Every template returns an html AND a text/plain alternative.
 */

import type { EmailBranding, EmailTemplateName, EmailTemplateVars, RenderedEmail } from './types';

/** The templates this module can render (published in the tool's actions schema). */
export const EMAIL_TEMPLATES: EmailTemplateName[] = [
  'auth.signup',
  'auth.recovery',
  'auth.magiclink',
  'auth.email_change',
  'auth.invite',
  'notification',
  'form-submission',
  'welcome',
];

/** Templates whose whole point is a one-click action link. */
export const ACTION_LINK_TEMPLATES: EmailTemplateName[] = [
  'auth.signup',
  'auth.recovery',
  'auth.magiclink',
  'auth.email_change',
  'auth.invite',
];

// ── design tokens (Umbelium DA: one company color, deep indigo) ───────────────

const TOKENS = {
  primary: '#030174',
  ink: '#1E2330',
  muted: '#5D6472',
  subtle: '#7E8594',
  border: '#E2E5EF',
  page: '#EEF1EE',
  surface: '#FFFFFF',
  zebra: '#F7F8FC',
  font: "'Manrope', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  companyName: 'Umbelium',
  supportEmail: 'contact@umbeli.com',
};

// ── escaping / sanitizing ────────────────────────────────────────────────────

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** HTML-escape any interpolated value. Never skip this on caller-supplied data. */
export function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

/**
 * Rendre une valeur sûre pour un en-tête d'e-mail.
 *
 * Un CR ou un LF dans un sujet, c'est de l'injection d'en-tête : « Bonjour\r\n
 * Bcc: attaquant@example.com » ajoute un destinataire caché si le transport
 * recopie la valeur telle quelle. Nodemailer et l'API Mailjet encodent leurs
 * en-têtes, mais `render-template` rend SANS envoyer et l'appelant est libre de
 * passer le sujet à son propre transport — l'endroit correct pour couper, c'est
 * ici, une seule fois, pour tout le monde.
 */
export function headerSafe(value: unknown): string {
  return String(value ?? '')
    .replace(/[\r\n\u0000\u2028\u2029]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 500);
}

/** Strip tags (used to turn a small piece of copy into its text/plain twin). */
export function stripTags(value: unknown): string {
  return String(value ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

/**
 * Only http(s) and mailto links ever reach an href. Anything else
 * (javascript:, data:, vbscript:) becomes '' so the button/link is dropped.
 */
export function safeUrl(value: unknown): string {
  const raw = String(value ?? '')
    .trim()
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/\s/g, '%20');
  if (!raw) return '';
  if (!/^(https?:\/\/|mailto:)/i.test(raw)) return '';
  return esc(raw);
}

/** Colors are interpolated into style="" — accept only literal hex. */
export function safeColor(value: unknown, fallback: string): string {
  const raw = String(value ?? '').trim();
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(raw) ? raw : fallback;
}

/** Mix a hex color toward white (ratio 0..1) — used for the soft tint blocks. */
function towardWhite(hex: string, ratio: number): string {
  const full = hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex;
  const n = parseInt(full.slice(1), 16);
  const mix = (channel: number) => Math.round(channel + (255 - channel) * ratio);
  const r = mix((n >> 16) & 0xff);
  const g = mix((n >> 8) & 0xff);
  const b = mix(n & 0xff);
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Escaped text: blank lines become paragraphs, single newlines become <br>. */
function paragraphs(text: unknown): string {
  const blocks = String(text ?? '')
    .split(/\r?\n\s*\r?\n/)
    .map((b) => b.trim())
    .filter(Boolean);
  if (!blocks.length) return '';
  return blocks
    .map((block, i) => {
      const body = esc(block).replace(/\r?\n/g, '<br>');
      const margin = i < blocks.length - 1 ? '0 0 12px' : '0';
      return `<p style="margin:${margin}">${body}</p>`;
    })
    .join('');
}

// ── brand resolution ─────────────────────────────────────────────────────────

export interface ResolvedBrand {
  appName: string;
  displayName: string;
  companyName: string;
  supportEmail: string;
  logoUrl: string;
  baseUrl: string;
  locale: 'fr' | 'en';
  primary: string;
  soft: string;
  ink: string;
  muted: string;
  subtle: string;
  border: string;
  page: string;
  surface: string;
  zebra: string;
  font: string;
  fromName: string;
  tagline: string;
}

export function resolveBrand(branding: EmailBranding = {}): ResolvedBrand {
  const primary = safeColor(branding.primaryColor, TOKENS.primary);
  const appName = String(branding.appName ?? '').trim().slice(0, 60);
  const companyName = String(branding.companyName ?? '').trim().slice(0, 60) || TOKENS.companyName;
  const locale: 'fr' | 'en' = branding.locale === 'en' ? 'en' : 'fr';
  return {
    appName,
    displayName: appName || companyName,
    companyName,
    supportEmail: String(branding.supportEmail ?? '').trim() || TOKENS.supportEmail,
    logoUrl: safeUrl(branding.logoUrl),
    baseUrl: safeUrl(branding.baseUrl),
    locale,
    primary,
    soft: towardWhite(primary, 0.9),
    ink: TOKENS.ink,
    muted: TOKENS.muted,
    subtle: TOKENS.subtle,
    border: TOKENS.border,
    page: TOKENS.page,
    surface: TOKENS.surface,
    zebra: TOKENS.zebra,
    font: TOKENS.font,
    fromName: appName ? `${appName} · ${companyName}` : companyName,
    tagline:
      locale === 'en'
        ? `${esc(companyName)} — the toolbox for agencies &amp; freelancers.`
        : `${esc(companyName)} — la suite d'outils pour agences &amp; freelances.`,
  };
}

// ── shell pieces ─────────────────────────────────────────────────────────────

function lockup(b: ResolvedBrand): string {
  if (b.logoUrl) {
    return `<table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr>
      <td style="vertical-align:middle"><img src="${b.logoUrl}" alt="${esc(b.displayName)}" height="40" style="display:block;height:40px;max-height:40px;width:auto;border:0;outline:none;text-decoration:none"></td>
    </tr></table>`;
  }
  if (b.appName) {
    const initial = esc(b.appName.slice(0, 1).toUpperCase());
    return `<table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr>
      <td style="vertical-align:middle"><span style="display:inline-block;width:40px;height:40px;line-height:40px;text-align:center;background:${b.primary};color:#ffffff;border-radius:11px;font-family:${b.font};font-size:19px;font-weight:800">${initial}</span></td>
      <td style="vertical-align:middle;padding-left:12px;text-align:left">
        <div style="font-family:${b.font};font-size:20px;font-weight:800;letter-spacing:-.02em;color:${b.primary};line-height:1.15">${esc(b.appName)}</div>
        <div style="font-family:${b.font};font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${b.subtle};line-height:1.3">${b.locale === 'en' ? 'by' : 'par'} ${esc(b.companyName)}</div>
      </td>
    </tr></table>`;
  }
  return `<table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr>
    <td style="vertical-align:middle"><span style="display:inline-block;width:34px;height:34px;line-height:34px;text-align:center;background:${b.primary};color:#ffffff;border-radius:9px;font-size:16px;font-weight:700">&#10022;</span></td>
    <td style="vertical-align:middle;padding-left:10px"><span style="font-family:${b.font};font-size:19px;font-weight:800;letter-spacing:-.02em;color:${b.primary}">${esc(b.companyName)}</span></td>
  </tr></table>`;
}

/** Bulletproof CTA: VML roundrect for Outlook/Word, padded anchor everywhere else. */
function button(b: ResolvedBrand, cta: { label: string; url: string }): string {
  const url = safeUrl(cta.url);
  if (!url) return '';
  const label = esc(cta.label);
  const width = Math.min(360, Math.max(180, 56 + String(cta.label).length * 9));
  return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:26px 0 4px"><tr><td>
    <!--[if mso]>
    <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${url}" style="height:44px;v-text-anchor:middle;width:${width}px;" arcsize="27%" stroke="f" fillcolor="${b.primary}">
      <w:anchorlock/>
      <center style="color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;">${label}</center>
    </v:roundrect>
    <![endif]-->
    <!--[if !mso]><!-- -->
    <table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr>
      <td align="center" bgcolor="${b.primary}" style="border-radius:12px;background:${b.primary}">
        <a href="${url}" target="_blank" rel="noopener" style="display:inline-block;padding:13px 28px;font-family:${b.font};font-size:15px;font-weight:700;line-height:1;color:#ffffff;text-decoration:none;border-radius:12px">${label}</a>
      </td>
    </tr></table>
    <!--<![endif]-->
  </td></tr></table>`;
}

/** The key/value table Webum builds for every site form submission. */
export function fieldTable(b: ResolvedBrand, fields: Array<{ label: string; value: string }>): string {
  if (!fields.length) return '';
  const rows = fields
    .map((f, i) => {
      const bg = i % 2 ? b.surface : b.zebra;
      const value = esc(f.value).replace(/\r?\n/g, '<br>') || '&mdash;';
      return `<tr>
          <td width="38%" style="padding:9px 12px;border:1px solid ${b.border};background:${bg};font-family:${b.font};font-size:13px;font-weight:700;color:${b.ink};vertical-align:top">${esc(f.label)}</td>
          <td style="padding:9px 12px;border:1px solid ${b.border};background:${bg};font-family:${b.font};font-size:13px;color:${b.muted};vertical-align:top">${value}</td>
        </tr>`;
    })
    .join('');
  return `<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:16px 0 4px">${rows}</table>`;
}

interface ShellInput {
  brand: ResolvedBrand;
  preheader?: string;
  heading: string;
  bodyHtml: string;
  cta?: { label: string; url: string } | null;
  footerNote?: string;
}

/** Table-based shell: preheader, lockup, white card, CTA, footer. */
export function shell({ brand: b, preheader = '', heading, bodyHtml, cta = null, footerNote = '' }: ShellInput): string {
  const site = b.baseUrl
    ? `&nbsp;·&nbsp; <a href="${b.baseUrl}" style="color:${b.subtle};text-decoration:underline">${esc(
        String(b.baseUrl).replace(/^https?:\/\//i, '').replace(/\/$/, ''),
      )}</a>`
    : '';
  return `<!doctype html>
<html lang="${b.locale}" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"><head>
<meta charset="utf-8"/>
<meta http-equiv="X-UA-Compatible" content="IE=edge"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="color-scheme" content="light only"/>
<meta name="supported-color-schemes" content="light"/>
<title>${esc(stripTags(heading))}</title>
<!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
<style>
  :root { color-scheme: light only; }
  body,table,td,a { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
  table,td { mso-table-lspace:0pt; mso-table-rspace:0pt; }
  img { -ms-interpolation-mode:bicubic; border:0; outline:none; text-decoration:none; }
  @media only screen and (max-width:620px) {
    .u-card { padding:24px 20px !important; }
    .u-shell { padding:16px !important; }
  }
  a { color:${b.primary}; }
</style>
</head>
<body style="margin:0;padding:0;background:${b.page};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;font-size:1px;line-height:1px">${esc(preheader)}</div>
  <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="background:${b.page};">
    <tr><td class="u-shell" align="center" style="padding:28px 16px 40px">
      <!--[if mso]><table role="presentation" width="600" border="0" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
      <table role="presentation" width="600" border="0" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px">
        <tr><td align="center" style="padding:6px 0 18px">
          ${lockup(b)}
        </td></tr>
        <tr><td class="u-card" style="background:${b.surface};border:1px solid ${b.border};border-radius:16px;padding:34px 36px">
          <h1 style="margin:0 0 14px;font-family:${b.font};font-size:22px;line-height:1.3;font-weight:800;color:${b.ink};letter-spacing:-.01em">${heading}</h1>
          <div style="font-family:${b.font};font-size:15px;line-height:1.62;color:${b.muted}">${bodyHtml}</div>
          ${cta ? button(b, cta) : ''}
        </td></tr>
        <tr><td style="padding:22px 20px 0;text-align:center">
          ${footerNote ? `<p style="margin:0 0 10px;font-family:${b.font};font-size:12px;line-height:1.5;color:${b.subtle}">${footerNote}</p>` : ''}
          <p style="margin:0 0 4px;font-family:${b.font};font-size:12px;line-height:1.5;color:${b.subtle}">${b.tagline}</p>
          <p style="margin:0;font-family:${b.font};font-size:12px;line-height:1.5;color:${b.subtle}">
            <a href="mailto:${esc(b.supportEmail)}" style="color:${b.subtle};text-decoration:underline">${esc(b.supportEmail)}</a>${site}
          </p>
        </td></tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td></tr>
  </table>
</body></html>`;
}

/** text/plain counterpart of the shell: content lines + the signature block. */
export function textShell(b: ResolvedBrand, lines: Array<string | false | null | undefined>): string {
  const team =
    b.locale === 'en'
      ? b.appName
        ? `The ${b.appName} team · ${b.companyName}`
        : `The ${b.companyName} team`
      : b.appName
        ? `L'équipe ${b.appName} · ${b.companyName}`
        : `L'équipe ${b.companyName}`;
  const body = lines.filter((l): l is string => typeof l === 'string');
  return [...body, '', '—', team, b.supportEmail].join('\n');
}

// ── vars helpers ─────────────────────────────────────────────────────────────

function greeting(b: ResolvedBrand, name: unknown): string {
  const n = String(name ?? '').trim();
  if (b.locale === 'en') return n ? `Hi ${n},` : 'Hi,';
  return n ? `Bonjour ${n},` : 'Bonjour,';
}

/** First candidate that is a usable http(s)/mailto URL, returned unescaped. */
function firstUrl(...candidates: unknown[]): string {
  for (const c of candidates) {
    if (safeUrl(c)) return String(c).trim();
  }
  return '';
}

/**
 * Accepts { fields: [{label,value}] } | { fields: {k:v} } | { data: {k:v} }
 * (Webum's submission shape) and normalizes to ordered label/value pairs.
 */
export function normalizeFields(vars: EmailTemplateVars): Array<{ label: string; value: string }> {
  const v = vars as Record<string, unknown>;
  const source = vars.fields ?? v.data ?? v.submission;
  if (!source || typeof source !== 'object') return [];
  const out: Array<{ label: string; value: string }> = [];
  const push = (label: unknown, value: unknown) => {
    const l = String(label ?? '').trim();
    if (!l) return;
    if (value === undefined || value === null || value === '') return;
    out.push({
      label: l,
      value: Array.isArray(value) ? value.map((x) => String(x)).join(', ') : String(value),
    });
  };
  if (Array.isArray(source)) {
    for (const entry of source) {
      if (Array.isArray(entry)) push(entry[0], entry[1]);
      else if (entry && typeof entry === 'object') {
        const e = entry as Record<string, unknown>;
        push(e.label ?? e.name ?? e.key ?? e.field, e.value ?? e.val ?? e.content);
      }
    }
  } else {
    for (const [k, val] of Object.entries(source as Record<string, unknown>)) push(k, val);
  }
  return out;
}

function formatDate(value: unknown, locale: 'fr' | 'en'): string {
  const raw = value === undefined || value === null || value === '' ? new Date() : new Date(value as string);
  const d = Number.isNaN(raw.getTime()) ? new Date() : raw;
  try {
    return d.toLocaleString(locale === 'en' ? 'en-CA' : 'fr-FR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return d.toISOString();
  }
}

// ── auth copy (lifted from renderAuthEmail) ──────────────────────────────────

interface AuthCopy {
  subject: string;
  heading: string;
  lines: string[];
  cta: string;
  footer: string;
}

function authCopy(template: EmailTemplateName, b: ResolvedBrand): AuthCopy {
  const fr = b.locale === 'fr';
  const app = b.appName ? esc(b.appName) : '';
  const nm = app || esc(b.companyName);
  const strong = (s: string) => `<strong style="color:${b.ink}">${s}</strong>`;
  const on = app ? ` ${fr ? 'sur' : 'on'} ${strong(nm)}` : '';
  const plainOn = b.appName ? ` ${fr ? 'sur' : 'on'} ${b.appName}` : '';
  const suffix = ` — ${b.displayName}`;

  switch (template) {
    case 'auth.recovery':
      return {
        subject: fr ? `Réinitialisez votre mot de passe${suffix}` : `Reset your password${suffix}`,
        heading: fr ? 'Réinitialisez votre mot de passe' : 'Reset your password',
        lines: fr
          ? [
              `Vous avez demandé à réinitialiser votre mot de passe${on}.`,
              'Cliquez ci-dessous pour en choisir un nouveau.',
            ]
          : [`You asked to reset your password${on}.`, 'Click below to choose a new one.'],
        cta: fr ? 'Réinitialiser mon mot de passe' : 'Reset my password',
        footer: fr
          ? "Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail — votre mot de passe reste inchangé."
          : 'If you did not request this, ignore this email — your password stays unchanged.',
      };
    case 'auth.magiclink':
      return {
        subject: fr ? `Votre lien de connexion${suffix}` : `Your sign-in link${suffix}`,
        heading: app
          ? fr
            ? `Connexion à ${nm}`
            : `Sign in to ${nm}`
          : fr
            ? 'Votre lien de connexion'
            : 'Your sign-in link',
        lines: fr
          ? [`Voici votre lien de connexion sécurisé${on}.`, 'Il est à usage unique et valable un court instant.']
          : [`Here is your secure sign-in link${on}.`, 'It is single-use and expires shortly.'],
        cta: fr ? 'Se connecter' : 'Sign in',
        footer: fr
          ? "Si vous n'avez pas demandé ce lien, ignorez cet e-mail."
          : 'If you did not request this link, ignore this email.',
      };
    case 'auth.email_change':
      return {
        subject: fr ? `Confirmez votre nouvelle adresse e-mail${suffix}` : `Confirm your new email address${suffix}`,
        heading: fr ? 'Confirmez votre nouvelle adresse e-mail' : 'Confirm your new email address',
        lines: fr
          ? [`Confirmez le changement d'adresse e-mail de votre compte${on}.`]
          : [`Confirm the email address change on your account${on}.`],
        cta: fr ? 'Confirmer le changement' : 'Confirm the change',
        footer: fr
          ? `Si vous n'êtes pas à l'origine de cette demande, contactez-nous à ${esc(b.supportEmail)}.`
          : `If you did not request this, contact us at ${esc(b.supportEmail)}.`,
      };
    case 'auth.invite':
      return {
        subject: fr ? `Vous êtes invité${suffix}` : `You have been invited${suffix}`,
        heading: app ? (fr ? `Rejoignez ${nm}` : `Join ${nm}`) : fr ? 'Vous êtes invité' : 'You have been invited',
        lines: fr
          ? [`Vous avez été invité à rejoindre ${strong(nm)}.`, 'Cliquez ci-dessous pour créer votre accès.']
          : [`You have been invited to join ${strong(nm)}.`, 'Click below to set up your access.'],
        cta: fr ? "Accepter l'invitation" : 'Accept the invitation',
        footer: fr
          ? 'Si vous ne vous attendiez pas à cette invitation, ignorez cet e-mail.'
          : 'If you were not expecting this invitation, ignore this email.',
      };
    case 'auth.signup':
    default:
      return {
        subject: fr ? `Confirmez votre e-mail${suffix}` : `Confirm your email${suffix}`,
        heading: app
          ? fr
            ? `Bienvenue sur ${nm} 👋`
            : `Welcome to ${nm} 👋`
          : fr
            ? 'Confirmez votre adresse e-mail'
            : 'Confirm your email address',
        lines: fr
          ? [
              `Confirmez votre adresse e-mail pour activer votre compte${app ? ` et accéder à ${strong(nm)}` : ''}.`,
              'Ce lien est valable un court instant.',
            ]
          : [
              `Confirm your email address to activate your account${app ? ` and open ${strong(nm)}` : ''}.`,
              'This link expires shortly.',
            ],
        cta: fr ? 'Confirmer mon e-mail' : 'Confirm my email',
        footer: fr
          ? `Si vous n'avez pas créé de compte${plainOn}, ignorez cet e-mail.`
          : `If you did not create an account${plainOn}, ignore this email.`,
      };
  }
}

// ── the renderers ────────────────────────────────────────────────────────────

function renderAuth(template: EmailTemplateName, vars: EmailTemplateVars, b: ResolvedBrand): RenderedEmail {
  const copy = authCopy(template, b);
  const actionUrl = firstUrl(vars.actionUrl, vars.ctaUrl, vars.url);
  const hello = greeting(b, vars.name);
  const subject = String(vars.subject ?? '').trim() || copy.subject;
  const preheader = String(vars.preheader ?? '').trim() || subject;
  const heading = vars.heading ? esc(vars.heading) : copy.heading;
  const ctaLabel = String(vars.ctaLabel ?? '').trim() || copy.cta;
  const footerNote = vars.footerNote ? esc(vars.footerNote) : copy.footer;

  const bodyHtml =
    `<p style="margin:0 0 12px">${esc(hello)}</p>` +
    copy.lines
      .map((l, i) => `<p style="margin:${i < copy.lines.length - 1 ? '0 0 12px' : '0'}">${l}</p>`)
      .join('');

  const html = shell({
    brand: b,
    preheader,
    heading,
    bodyHtml,
    cta: actionUrl ? { label: ctaLabel, url: actionUrl } : null,
    footerNote,
  });

  const text = textShell(b, [
    hello,
    '',
    ...copy.lines.map(stripTags),
    actionUrl ? '' : false,
    actionUrl ? (b.locale === 'en' ? 'Open this link:' : 'Ouvrez ce lien :') : false,
    actionUrl || false,
    '',
    stripTags(footerNote),
  ]);

  return { subject, preheader, html, text, fromName: b.fromName };
}

function renderNotification(vars: EmailTemplateVars, b: ResolvedBrand): RenderedEmail {
  const fr = b.locale === 'fr';
  const title = String(vars.title ?? vars.heading ?? '').trim();
  const subject = String(vars.subject ?? '').trim() || title || `Notification — ${b.displayName}`;
  const heading = esc(title || subject);
  const message = String(vars.message ?? vars.body ?? '').trim();
  const fields = normalizeFields(vars);
  const ctaUrl = firstUrl(vars.ctaUrl, vars.actionUrl, vars.url);
  const ctaLabel = String(vars.ctaLabel ?? '').trim() || (fr ? 'Ouvrir' : 'Open');
  const hello = vars.name ? greeting(b, vars.name) : '';
  const preheader = String(vars.preheader ?? '').trim() || (message ? message.slice(0, 140) : subject);

  const bodyHtml =
    (hello ? `<p style="margin:0 0 12px">${esc(hello)}</p>` : '') + paragraphs(message) + fieldTable(b, fields);

  const html = shell({
    brand: b,
    preheader,
    heading,
    bodyHtml,
    cta: ctaUrl ? { label: ctaLabel, url: ctaUrl } : null,
    footerNote: vars.footerNote ? esc(vars.footerNote) : '',
  });

  const text = textShell(b, [
    hello || false,
    hello ? '' : false,
    title || subject,
    '',
    message || false,
    fields.length ? '' : false,
    ...fields.map((f) => `${f.label}: ${f.value}`),
    ctaUrl ? '' : false,
    ctaUrl ? `${ctaLabel}: ${ctaUrl}` : false,
    vars.footerNote ? '' : false,
    vars.footerNote ? stripTags(vars.footerNote) : false,
  ]);

  return { subject, preheader, html, text, fromName: b.fromName };
}

/** The table Webum hand-builds for every site form submission. */
function renderFormSubmission(vars: EmailTemplateVars, b: ResolvedBrand): RenderedEmail {
  const fr = b.locale === 'fr';
  const siteName = String(vars.siteName ?? vars.site ?? '').trim() || b.displayName;
  const formId = String(vars.formName ?? vars.formId ?? vars.form ?? '').trim();
  const when = formatDate(vars.submittedAt ?? vars.createdAt, b.locale);
  const fields = normalizeFields(vars);
  const pageHref = firstUrl(vars.pageUrl, vars.page);
  const pageLabel = String(vars.page ?? vars.pageUrl ?? '').trim();
  const title = fr ? `Nouveau message — ${siteName}` : `New submission — ${siteName}`;
  const subject = String(vars.subject ?? '').trim() || title;
  const heading = esc(title);
  const preheader =
    String(vars.preheader ?? '').trim() ||
    (fields.length ? `${fields[0].label}: ${fields[0].value}`.slice(0, 140) : subject);
  const ctaUrl = firstUrl(vars.ctaUrl, vars.actionUrl);
  const ctaLabel = String(vars.ctaLabel ?? '').trim() || (fr ? 'Voir dans le tableau de bord' : 'Open in the dashboard');

  const metaBits = [
    formId ? `${fr ? 'Formulaire' : 'Form'} : <strong style="color:${b.ink}">${esc(formId)}</strong>` : '',
    esc(when),
  ].filter(Boolean);

  const bodyHtml =
    `<p style="margin:0;font-size:13px;color:${b.subtle}">${metaBits.join(' &nbsp;|&nbsp; ')}</p>` +
    (fields.length
      ? fieldTable(b, fields)
      : `<p style="margin:12px 0 0">${fr ? 'Aucun champ transmis.' : 'No fields submitted.'}</p>`) +
    (pageLabel
      ? `<p style="margin:10px 0 0;font-size:12px;color:${b.subtle}">Page : ${
          pageHref ? `<a href="${safeUrl(pageHref)}" style="color:${b.subtle}">${esc(pageLabel)}</a>` : esc(pageLabel)
        }</p>`
      : '');

  const html = shell({
    brand: b,
    preheader,
    heading,
    bodyHtml,
    cta: ctaUrl ? { label: ctaLabel, url: ctaUrl } : null,
    footerNote: vars.footerNote ? esc(vars.footerNote) : '',
  });

  const text = textShell(b, [
    title,
    formId ? `${fr ? 'Formulaire' : 'Form'}: ${formId}` : false,
    when,
    '',
    ...(fields.length
      ? fields.map((f) => `${f.label}: ${f.value}`)
      : [fr ? 'Aucun champ transmis.' : 'No fields submitted.']),
    pageLabel ? '' : false,
    pageLabel ? `Page: ${pageLabel}` : false,
    ctaUrl ? '' : false,
    ctaUrl ? `${ctaLabel}: ${ctaUrl}` : false,
  ]);

  return { subject, preheader, html, text, fromName: b.fromName };
}

function renderWelcome(vars: EmailTemplateVars, b: ResolvedBrand): RenderedEmail {
  const fr = b.locale === 'fr';
  const name = b.displayName;
  const title = fr ? `Bienvenue sur ${name} 🎉` : `Welcome to ${name} 🎉`;
  const subject = String(vars.subject ?? '').trim() || title;
  const heading = vars.heading ? esc(vars.heading) : esc(title);
  const hello = greeting(b, vars.name);
  const message = String(vars.message ?? vars.body ?? '').trim();
  const ctaUrl = firstUrl(vars.ctaUrl, vars.actionUrl, vars.appUrl, vars.url);
  const ctaLabel = String(vars.ctaLabel ?? '').trim() || (fr ? `Ouvrir ${name}` : `Open ${name}`);
  const preheader = String(vars.preheader ?? '').trim() || subject;

  const defaultLines = fr
    ? [
        `Votre compte <strong style="color:${b.ink}">${esc(name)}</strong> est prêt. Merci de votre confiance !`,
        'Si vous avez la moindre question, répondez simplement à cet e-mail — une vraie personne vous répondra.',
      ]
    : [
        `Your <strong style="color:${b.ink}">${esc(name)}</strong> account is ready. Thanks for joining!`,
        'If you have any question, just reply to this email — a real person answers.',
      ];

  const bodyHtml =
    `<p style="margin:0 0 12px">${esc(hello)}</p>` +
    (message
      ? paragraphs(message)
      : defaultLines
          .map((l, i) => `<p style="margin:${i < defaultLines.length - 1 ? '0 0 12px' : '0'}">${l}</p>`)
          .join(''));

  const html = shell({
    brand: b,
    preheader,
    heading,
    bodyHtml,
    cta: ctaUrl ? { label: ctaLabel, url: ctaUrl } : null,
    footerNote: vars.footerNote ? esc(vars.footerNote) : '',
  });

  const text = textShell(b, [
    hello,
    '',
    ...(message ? [message] : defaultLines.map(stripTags)),
    ctaUrl ? '' : false,
    ctaUrl ? `${ctaLabel}: ${ctaUrl}` : false,
  ]);

  return { subject, preheader, html, text, fromName: b.fromName };
}

/**
 * Render one branded template to { subject, preheader, html, text, fromName }.
 * Throws on an unknown name — routes validate against EMAIL_TEMPLATES first.
 */
export function renderTemplate(
  template: EmailTemplateName,
  vars: EmailTemplateVars = {},
  branding: EmailBranding = {},
): RenderedEmail {
  const brand = resolveBrand(branding);
  return sanitizeHeaders(renderByName(template, vars, brand));
}

/** Les champs qui deviennent des en-têtes ne peuvent pas porter de saut de ligne. */
function sanitizeHeaders(rendered: RenderedEmail): RenderedEmail {
  return {
    ...rendered,
    subject: headerSafe(rendered.subject),
    preheader: headerSafe(rendered.preheader),
    fromName: headerSafe(rendered.fromName),
  };
}

function renderByName(
  template: EmailTemplateName,
  vars: EmailTemplateVars,
  brand: ResolvedBrand,
): RenderedEmail {
  switch (template) {
    case 'auth.signup':
    case 'auth.recovery':
    case 'auth.magiclink':
    case 'auth.email_change':
    case 'auth.invite':
      return renderAuth(template, vars, brand);
    case 'notification':
      return renderNotification(vars, brand);
    case 'form-submission':
      return renderFormSubmission(vars, brand);
    case 'welcome':
      return renderWelcome(vars, brand);
    default:
      throw new Error(`Unknown email template: ${String(template)}`);
  }
}

export function isEmailTemplate(value: unknown): value is EmailTemplateName {
  return typeof value === 'string' && (EMAIL_TEMPLATES as string[]).includes(value);
}
