import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";

export interface Email {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  send(email: Email): Promise<void>;
}

export class SesMailer implements Mailer {
  constructor(
    private readonly from: string,
    private readonly client = new SESv2Client({}),
  ) {}

  async send(email: Email) {
    await this.client.send(
      new SendEmailCommand({
        FromEmailAddress: this.from,
        Destination: { ToAddresses: [email.to] },
        Content: {
          Simple: {
            Subject: { Data: email.subject, Charset: "UTF-8" },
            Body: {
              Text: { Data: email.text, Charset: "UTF-8" },
              Html: { Data: email.html, Charset: "UTF-8" },
            },
          },
        },
      }),
    );
  }
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

function layout(heading: string, body: string, buttonLabel: string, url: string): string {
  return `<!doctype html><html><body style="font-family:system-ui,sans-serif;max-width:480px;margin:24px auto;color:#1f1f1f">
<h2 style="margin:0 0 12px">${escapeHtml(heading)}</h2>
<p style="line-height:1.5">${body}</p>
<p><a href="${escapeHtml(url)}" style="display:inline-block;background:#7a2e2e;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none">${escapeHtml(buttonLabel)}</a></p>
<p style="color:#666;font-size:13px">Or paste this link into your browser:<br>${escapeHtml(url)}</p>
</body></html>`;
}

export function magicLinkEmail(to: string, url: string): Email {
  return {
    to,
    subject: "Your Call Time sign-in link",
    text: `Sign in to Call Time:\n\n${url}\n\nThis link works once and expires in 15 minutes. If you didn't ask for it, you can ignore this email.`,
    html: layout(
      "Sign in to Call Time",
      "This link works once and expires in 15 minutes. If you didn't ask for it, you can ignore this email.",
      "Sign in",
      url,
    ),
  };
}

export function inviteEmail(to: string, showName: string, inviterName: string, url: string): Email {
  return {
    to,
    subject: `You're invited to ${showName} on Call Time`,
    text: `${inviterName} invited you to ${showName} on Call Time, where you'll enter your conflicts and see your rehearsal calls.\n\nJoin here:\n${url}\n\nThis invite expires in 30 days.`,
    html: layout(
      `Join ${showName}`,
      `${escapeHtml(inviterName)} invited you to <strong>${escapeHtml(showName)}</strong> on Call Time, where you'll enter your conflicts and see your rehearsal calls. This invite expires in 30 days.`,
      "Join the show",
      url,
    ),
  };
}
