import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../config.js';

/** E-Mail-Versand über SMTP (Zugangsdaten in der .env: SMTP_HOST, SMTP_USER, …) */

export const mailEnabled = () => Boolean(config.smtp.host && config.smtp.from);

let transporter: Transporter | null = null;

function transport() {
  transporter ??= nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.password } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
  });
  return transporter;
}

export async function sendMail(mail: { to: string; subject: string; text: string; html: string; replyTo?: string }) {
  if (!mailEnabled()) throw new Error('E-Mail-Versand ist nicht eingerichtet (SMTP_HOST in der .env fehlt)');
  await transport().sendMail({ from: config.smtp.from, ...mail });
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Einladung in die Gemeinde: Login-Link + Hinweis auf das Planungstool-Konto */
export function inviteMail(opts: { name: string; churchName: string; inviterName: string; planningLabel: string; loginUrl: string }) {
  const firstName = opts.name.split(' ')[0];
  const subject = `Einladung zu kahal.tools – ${opts.churchName}`;
  const text = `Hallo ${firstName}

${opts.inviterName} hat dich zu kahal.tools für ${opts.churchName} eingeladen.

So meldest du dich an:
${opts.loginUrl}

Du meldest dich mit deinem Konto bei ${opts.planningLabel} an, ein eigenes Passwort brauchst du nicht.

Viele Grüsse
kahal.tools`;
  const html = `<!doctype html>
<html lang="de"><body style="margin:0;padding:24px;background:#f6f6f3;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#1c1f1e">
  <table role="presentation" width="100%" style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e4e6e3;border-radius:14px">
    <tr><td style="padding:28px">
      <p style="margin:0 0 20px;font-weight:700;font-size:15px">kahal.tools</p>
      <h1 style="margin:0 0 12px;font-size:20px;line-height:1.3">Du wurdest eingeladen</h1>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.5">Hallo ${esc(firstName)}<br><br>${esc(opts.inviterName)} hat dich zu kahal.tools für <b>${esc(opts.churchName)}</b> eingeladen.</p>
      <p style="margin:0 0 24px"><a href="${esc(opts.loginUrl)}" style="display:inline-block;background:#1f6f5c;color:#fff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:9px">Jetzt anmelden</a></p>
      <p style="margin:0;font-size:13px;line-height:1.5;color:#69706d">Du meldest dich mit deinem Konto bei ${esc(opts.planningLabel)} an, ein eigenes Passwort brauchst du nicht.<br>Falls der Knopf nicht funktioniert: <a href="${esc(opts.loginUrl)}" style="color:#1f6f5c">${esc(opts.loginUrl)}</a></p>
    </td></tr>
  </table>
</body></html>`;
  return { subject, text, html };
}
