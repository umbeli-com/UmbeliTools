interface MailjetMessage {
  From: { Email: string; Name?: string };
  To: { Email: string; Name?: string }[];
  Subject: string;
  HTMLPart: string;
}

export async function sendMailjet(
  credentials: { apiKey: string; secretKey: string },
  messages: MailjetMessage[],
): Promise<{ success: boolean; response?: unknown; error?: string }> {
  const auth = Buffer.from(`${credentials.apiKey}:${credentials.secretKey}`).toString('base64');

  const res = await fetch('https://api.mailjet.com/v3.1/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify({ Messages: messages }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const text = await res.text();
    return { success: false, error: `Mailjet ${res.status}: ${text}` };
  }

  const data = await res.json();
  return { success: true, response: data };
}
