/**
 * Templates transacionais (pt-BR) — HTML inline, tema dark com acento laranja
 * (tom do produto). Funções puras para teste unitário sem Resend/DB.
 *
 * Layout table-based + estilos inline: é o que os clients de email suportam
 * de forma consistente (Gmail/Outlook stripam <style> em muitos casos).
 */

const BRAND_ORANGE = '#f97316';
const BG = '#0b0b10';
const CARD = '#14141c';
const BORDER = '#26262f';
const TEXT = '#e8e8ee';
const MUTED = '#9a9aa8';

export interface AuthEmailTemplate {
  subject: string;
  html: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function greeting(userName: string | null | undefined): string {
  const name = userName?.trim();
  return name ? `Olá, ${escapeHtml(name)}!` : 'Olá!';
}

function layout(content: string): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
</head>
<body style="margin:0;padding:0;background-color:${BG};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${BG};padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:${CARD};border:1px solid ${BORDER};border-radius:12px;padding:32px;">
<tr><td>
  <div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:${TEXT};">
    <div style="font-size:20px;font-weight:700;letter-spacing:-0.02em;margin:0 0 24px;">
      <span style="color:${BRAND_ORANGE};">&#9679;</span> Singular
    </div>
    ${content}
    <div style="margin-top:32px;padding-top:16px;border-top:1px solid ${BORDER};font-size:12px;color:${MUTED};line-height:1.5;">
      Você recebeu este email porque uma ação foi solicitada na sua conta Singular.
      Se não foi você, ignore esta mensagem.
    </div>
  </div>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function button(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
<tr><td style="border-radius:8px;background-color:${BRAND_ORANGE};">
  <a href="${escapeHtml(href)}" target="_blank"
     style="display:inline-block;padding:12px 28px;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:15px;font-weight:600;color:#0b0b10;text-decoration:none;">
    ${escapeHtml(label)}
  </a>
</td></tr>
</table>`;
}

function paragraph(text: string): string {
  return `<p style="font-size:15px;line-height:1.6;color:${TEXT};margin:0 0 12px;">${text}</p>`;
}

function fallbackLink(url: string): string {
  return `<p style="font-size:12px;line-height:1.6;color:${MUTED};margin:0;word-break:break-all;">
  Se o botão não funcionar, copie e cole este link no navegador:<br>
  <a href="${escapeHtml(url)}" style="color:${BRAND_ORANGE};">${escapeHtml(url)}</a>
</p>`;
}

export function buildVerificationEmail(input: {
  userName?: string | null;
  actionUrl: string;
}): AuthEmailTemplate {
  const html = layout(`
    ${paragraph(`${greeting(input.userName)}`)}
    ${paragraph('Confirme seu endereço de email para concluir o cadastro no Singular.')}
    ${button(input.actionUrl, 'Verificar email')}
    ${fallbackLink(input.actionUrl)}
  `);

  return { subject: 'Verifique seu email — Singular', html };
}

export function buildPasswordResetEmail(input: {
  userName?: string | null;
  actionUrl: string;
}): AuthEmailTemplate {
  const html = layout(`
    ${paragraph(`${greeting(input.userName)}`)}
    ${paragraph('Recebemos uma solicitação para redefinir a senha da sua conta Singular.')}
    ${button(input.actionUrl, 'Redefinir senha')}
    ${paragraph('Este link expira em 1 hora. Se você não pediu a redefinição, ignore este email — sua senha permanece a mesma.')}
    ${fallbackLink(input.actionUrl)}
  `);

  return { subject: 'Redefinir senha — Singular', html };
}
