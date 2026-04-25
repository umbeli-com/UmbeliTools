import twilio from 'twilio';

function ensureWhatsAppPrefix(value: string) {
  return value.startsWith('whatsapp:') ? value : `whatsapp:${value}`;
}

export async function sendSms(
  credentials: { accountSid: string; authToken: string; from: string },
  to: string,
  body: string,
  channel: 'sms' | 'whatsapp' = 'sms',
) {
  const client = twilio(credentials.accountSid, credentials.authToken);

  const fromNumber = channel === 'whatsapp' ? ensureWhatsAppPrefix(credentials.from) : credentials.from;
  const toNumber = channel === 'whatsapp' ? ensureWhatsAppPrefix(to) : to;

  const message = await client.messages.create({
    from: fromNumber,
    to: toNumber,
    body,
  });

  return {
    sid: message.sid,
    status: message.status,
    to: message.to,
    from: message.from,
  };
}
