import { Resend } from "resend";

export type Email = { to: string; subject: string; html: string; text: string; idempotencyKey?: string };

export interface Mailer {
  send(email: Email): Promise<void>;
}

export class MailerError extends Error {}

/** Production mailer (https://resend.com). */
export function createResendMailer(options: { apiKey: string; from: string }): Mailer {
  const resend = new Resend(options.apiKey);
  return {
    async send({ to, subject, html, text, idempotencyKey }) {
      const { error } = await resend.emails.send(
        { from: options.from, to, subject, html, text },
        idempotencyKey ? { idempotencyKey } : undefined,
      );
      if (error) throw new MailerError(`Resend: ${error.name}: ${error.message}`);
    },
  };
}

/** Development mailer: prints messages instead of sending them. */
export function createConsoleMailer(): Mailer {
  return {
    async send({ to, subject, text }) {
      console.log(`\n[email] to: ${to}\n[email] subject: ${subject}\n${text}\n`);
    },
  };
}

/** Test mailer: keeps sent messages in memory. */
export function createMemoryMailer() {
  const sent: Email[] = [];
  return {
    sent,
    last: (to?: string) => [...sent].reverse().find((e) => !to || e.to === to),
    async send(email: Email) {
      sent.push(email);
    },
  } satisfies Mailer & Record<string, unknown>;
}
