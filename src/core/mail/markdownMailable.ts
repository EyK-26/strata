import type { Mailer, MailMessage } from "./mailer.ts";
import { type MarkdownMailLayoutOptions, renderMarkdownMail } from "./markdownMail.ts";

interface MarkdownMailableInput {
  to: string;
  subject: string;
  markdown: string;
  layout?: MarkdownMailLayoutOptions;
}

function buildMarkdownMailMessage(input: MarkdownMailableInput): MailMessage {
  const rendered = renderMarkdownMail(input.markdown, {
    title: input.layout?.title ?? input.subject,
    ...input.layout,
  });

  return {
    to: input.to,
    subject: input.subject,
    body: rendered.text,
    html: rendered.html,
  };
}

async function sendMarkdownMail(mailer: Mailer, input: MarkdownMailableInput): Promise<void> {
  await mailer.send(buildMarkdownMailMessage(input));
}

export type { MarkdownMailableInput };
export { buildMarkdownMailMessage, sendMarkdownMail };
