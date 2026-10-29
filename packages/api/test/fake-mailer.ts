import type { Email, Mailer } from "../src/lib/mailer.js";

export class FakeMailer implements Mailer {
  sent: Email[] = [];
  async send(email: Email) {
    this.sent.push(email);
  }
  lastLink(): string {
    const match = /https?:\/\/\S+/.exec(this.sent.at(-1)?.text ?? "");
    if (!match) throw new Error("no link in last email");
    return match[0];
  }
}
