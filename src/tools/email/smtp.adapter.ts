import nodemailer from 'nodemailer';

export async function sendSmtp(
  credentials: { host: string; port?: number; secure?: boolean; user: string; password: string },
  opts: {
    from: { email: string; name?: string };
    to: string;
    subject: string;
    text?: string;
    html?: string;
    cc?: string;
    bcc?: string;
    replyTo?: string;
  },
): Promise<{ messageId: string; accepted: string[]; rejected: string[]; response: string }> {
  const port = credentials.port || 587;
  const secure = credentials.secure ?? port === 465;

  const transporter = nodemailer.createTransport({
    host: credentials.host,
    port,
    secure,
    requireTLS: !secure && port === 587,
    auth: { user: credentials.user, pass: credentials.password },
  });

  const fromHeader = opts.from.name ? `${opts.from.name} <${opts.from.email}>` : opts.from.email;

  const info = await transporter.sendMail({
    from: fromHeader,
    to: opts.to,
    cc: opts.cc,
    bcc: opts.bcc,
    replyTo: opts.replyTo,
    subject: opts.subject,
    text: opts.text,
    html: opts.html,
  });

  return {
    messageId: info.messageId,
    accepted: info.accepted as string[],
    rejected: info.rejected as string[],
    response: info.response,
  };
}
