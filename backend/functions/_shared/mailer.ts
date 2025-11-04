// backend/functions/_shared/mailer.ts
import { sendGmail } from "./googleJwt";

const FROM = (process.env.GMAIL_IMPERSONATE || "").trim();
if (!FROM) {
  console.warn("[mailer] GMAIL_IMPERSONATE no está definido");
}

type SendEmailParams = {
  to: string;
  subject: string;
  html?: string;
  text?: string; // compat: si viene text y no hay html, lo renderizamos simple
};

/**
 * Envío de email mediante Gmail API (Service Account + DWD) usando sendGmail().
 * Sin nodemailer/OAuth2: menos superficie y sin problemas de OpenSSL.
 */
export async function sendEmail({ to, subject, html, text }: SendEmailParams): Promise<void> {
  const htmlBody =
    html ??
    (text
      ? `<pre style="font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace; white-space:pre-wrap;">${escapeHtml(
          text
        )}</pre>`
      : "<div></div>");

  await sendGmail({
    to,
    subject,
    html: htmlBody,
    from: FROM, // From = usuario impersonado
  });
}

/**
 * Export requerido por auth-password-reset-request.ts
 */
export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  const subject = "Instrucciones para restablecer tu contraseña";
  const html = `
    <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; line-height:1.5; max-width:640px">
      <h2>Restablecer contraseña</h2>
      <p>Has solicitado restablecer tu contraseña.</p>
      <p>
        <a href="${resetUrl}" style="display:inline-block;padding:10px 16px;border-radius:6px;background:#0b5ed7;color:#fff;text-decoration:none">
          Restablecer contraseña
        </a>
      </p>
      <p>Si no funciona el botón, copia y pega esta URL en tu navegador:</p>
      <p><code>${escapeHtml(resetUrl)}</code></p>
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0" />
      <p style="color:#666;font-size:12px">Este enlace caduca automáticamente por seguridad.</p>
    </div>
  `.trim();

  const text = `Has solicitado restablecer tu contraseña.\nAbre esta URL: ${resetUrl}`;

  await sendEmail({ to, subject, html, text });
}

/* Utilidad mínima para texto plano → HTML seguro */
function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
