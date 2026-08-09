import { describe, expect, test } from "bun:test";
import { Mailer } from "../../src/core/mail/mailer";
import {
  markdownToHtml,
  renderMarkdownMail,
  stripMarkdown,
  wrapMarkdownMailLayout,
} from "../../src/core/mail/markdownMail";
import { buildMarkdownMailMessage, sendMarkdownMail } from "../../src/core/mail/markdownMailable";

describe("markdown mail", () => {
  test("markdownToHtml converts headings and links", () => {
    const html = markdownToHtml("# Hello\n\nVisit [GetStrata](https://getstrata.com).");
    expect(html).toContain("<h1>Hello</h1>");
    expect(html).toContain('<a href="https://getstrata.com">GetStrata</a>');
  });

  test("renderMarkdownMail returns html and plain text", () => {
    const rendered = renderMarkdownMail("## Welcome\n\nThanks for joining.", {
      title: "Welcome",
      footer: "GetStrata team",
    });

    expect(rendered.html).toContain("<h2>Welcome</h2>");
    expect(rendered.html).toContain("GetStrata team");
    expect(rendered.text).toContain("Welcome");
    expect(rendered.text).not.toContain("##");
  });

  test("stripMarkdown removes formatting", () => {
    expect(stripMarkdown("**Bold** and `code`")).toBe("Bold and code");
  });

  test("wrapMarkdownMailLayout escapes title", () => {
    const html = wrapMarkdownMailLayout("<p>Body</p>", { title: 'A <script>alert("x")</script>' });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  test("buildMarkdownMailMessage includes html and text body", () => {
    const message = buildMarkdownMailMessage({
      to: "user@example.test",
      subject: "Welcome",
      markdown: "Hello **there**",
    });

    expect(message.to).toBe("user@example.test");
    expect(message.subject).toBe("Welcome");
    expect(message.body).toContain("Hello there");
    expect(message.html).toContain("<strong>there</strong>");
  });

  test("sendMarkdownMail delegates to mailer", async () => {
    const sent: Array<{ body: string; html?: string }> = [];
    const mailer = new Mailer(
      new (class {
        send(message: { body: string; html?: string }) {
          sent.push(message);
          return Promise.resolve();
        }
      })(),
    );

    await sendMarkdownMail(mailer, {
      to: "user@example.test",
      subject: "Ping",
      markdown: "Ping body",
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]?.html).toContain("Ping body");
  });
});
