// Explicitly invoked preview tool: credentials are read from stdin, never from arguments.
if (process.stdin.isTTY) process.stdin.setRawMode(true);
let input = '';
for await (const chunk of process.stdin) {
  input += String(chunk);
  if (input.includes('\n') || input.includes('\r')) break;
}
if (process.stdin.isTTY) process.stdin.setRawMode(false);
process.stdin.pause();
const { apiKey, recipient } = JSON.parse(input.trim());
if (!apiKey || !recipient) throw new Error('Missing API key or recipient');
const base = 'https://creators.lotuselectronics.com';
const messages = [
  { subject: '[TEST] Reset your Lotus Creator password', text: 'This is a template preview. No active reset token is included. In a real reset email, the link works once and expires in one hour.', label: 'Request a reset link', link: `${base}/forgot` },
  { subject: '[TEST] Welcome to Lotus Creator Network', text: 'Your account has been created and your profile is under review. Please complete your profile, including your PAN, payout details and social account, so our team can review it. We will email you when your profile is approved.', label: 'Open creator portal', link: `${base}/login` },
  { subject: '[TEST] Your Lotus Creator profile is approved', text: 'Good news! Your creator profile has been approved. Sign in to explore open campaigns, check the requirements and start creating with Lotus.', label: 'Open creator portal', link: `${base}/login` },
];
for (const m of messages) {
  const html = `<!doctype html><html><body style="margin:0;background:#f3f8f7;font-family:Arial,sans-serif;color:#173b39"><table role="presentation" width="100%"><tr><td align="center" style="padding:28px 12px"><table role="presentation" width="100%" style="max-width:560px;background:#fff;border:1px solid #dce9e6;border-radius:8px"><tr><td style="padding:28px"><img src="https://www.lotuselectronics.com/assets/images/lotus-logo.png" width="150" alt="Lotus Electronics Supermarket"><p style="margin:24px 0 8px;color:#168b8e;font-size:12px;font-weight:bold;letter-spacing:1px">LOTUS CREATOR NETWORK</p><h1 style="font-size:23px">${m.subject}</h1><p style="font-size:15px;line-height:1.7">Hello,</p><p style="font-size:15px;line-height:1.7">${m.text}</p><p style="margin:24px 0"><a href="${m.link}" style="display:inline-block;background:#147f80;color:#fff;text-decoration:none;padding:12px 20px;border-radius:5px;font-weight:bold">${m.label}</a></p><p style="border-top:1px solid #e5eeec;padding-top:18px;font-size:12px;color:#6a8079">Lotus Electronics Supermarket · Creator Network</p></td></tr></table></td></tr></table></body></html>`;
  try {
    const body = new URLSearchParams({ from: 'Lotus Electronics <noreply@lotuselectronics.com>', to: recipient, subject: m.subject, text: `${m.text}\n\n${m.link}`, html, 'o:tracking': 'no' });
    const response = await fetch('https://api.mailgun.net/v3/mg.lotuselectronics.com/messages', { method: 'POST', headers: { authorization: `Basic ${Buffer.from(`api:${apiKey}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(30000) });
    console.log(`${m.subject}: ${response.ok ? 'accepted by Mailgun' : `rejected (HTTP ${response.status})`}`);
  } catch { console.log(`${m.subject}: connection failed`); }
}
