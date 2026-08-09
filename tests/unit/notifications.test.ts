import { describe, expect, test } from "bun:test";
import { LogMailDriver, Mailer } from "../../src/core/mail/mailer";
import {
  createNotificationDispatcher,
  type DatabaseNotificationStore,
  type Notifiable,
  Notification,
} from "../../src/core/notifications";

class TestUser implements Notifiable {
  constructor(
    readonly id: number,
    readonly email: string,
  ) {}

  getNotificationKey(): number {
    return this.id;
  }

  routeNotificationFor(channel: "mail" | "database"): string | number | null {
    if (channel === "mail") {
      return this.email;
    }

    return this.id;
  }
}

class WelcomeNotification extends Notification<TestUser> {
  override via(): Array<"mail" | "database"> {
    return ["mail", "database"];
  }

  override toMail(): { subject: string; markdown: string } {
    return {
      subject: "Welcome to GetStrata",
      markdown: "Thanks for joining **GetStrata**!",
    };
  }

  override toDatabase(): {
    type: string;
    title: string;
    body: string;
    data: Record<string, unknown>;
  } {
    return {
      type: "welcome",
      title: "Welcome",
      body: "Thanks for joining GetStrata!",
      data: { source: "registration" },
    };
  }
}

class MailOnlyNotification extends Notification<TestUser> {
  override via(): Array<"mail"> {
    return ["mail"];
  }

  override toMail(): { subject: string; body: string } {
    return {
      subject: "Ping",
      body: "Plain text only",
    };
  }
}

class DefaultMethodsNotification extends Notification<TestUser> {
  override via(): Array<"mail"> {
    return ["mail"];
  }
}

class MissingViaNotification extends Notification<TestUser> {}

describe("Notification", () => {
  test("defaults toMail and toDatabase to null", () => {
    const notification = new DefaultMethodsNotification();

    expect(notification.toMail(new TestUser(1, "user@example.test"))).toBeNull();
    expect(notification.toDatabase(new TestUser(1, "user@example.test"))).toBeNull();
  });

  test("requires subclasses to implement via()", () => {
    expect(() => new MissingViaNotification().via(new TestUser(1, "user@example.test"))).toThrow(
      "Notification subclasses must implement via().",
    );
  });
});

describe("NotificationDispatcher", () => {
  test("sends mail and database notifications", async () => {
    const mailMessages: string[] = [];
    const originalLog = console.log;
    console.log = (value?: unknown) => {
      mailMessages.push(String(value));
    };

    const databaseRecords: Array<Record<string, unknown>> = [];
    const store: DatabaseNotificationStore = {
      create(input) {
        databaseRecords.push(input as unknown as Record<string, unknown>);
        return Promise.resolve(input as unknown as Record<string, unknown>);
      },
    };

    const dispatcher = createNotificationDispatcher(new Mailer(new LogMailDriver()), store);

    try {
      await dispatcher.send(new TestUser(1, "user@example.test"), new WelcomeNotification());
    } finally {
      console.log = originalLog;
    }

    expect(mailMessages.some((line) => line.includes("user@example.test"))).toBe(true);
    expect(mailMessages.some((line) => line.includes("Welcome to GetStrata"))).toBe(true);
    expect(databaseRecords).toEqual([
      {
        userId: 1,
        type: "welcome",
        title: "Welcome",
        body: "Thanks for joining GetStrata!",
        data: { source: "registration" },
      },
    ]);
  });

  test("skips database channel when store is not configured", async () => {
    const dispatcher = createNotificationDispatcher(new Mailer(new LogMailDriver()));
    await expect(
      dispatcher.send(new TestUser(1, "user@example.test"), new WelcomeNotification()),
    ).resolves.toBeUndefined();
  });

  test("sends plain text mail when markdown is omitted", async () => {
    const sent: Array<{ to: string; subject: string; body: string }> = [];
    const dispatcher = createNotificationDispatcher(
      new Mailer(
        new (class {
          send(message: { to: string; subject: string; body: string }) {
            sent.push(message);
            return Promise.resolve();
          }
        })(),
      ),
    );

    await dispatcher.send(new TestUser(1, "user@example.test"), new MailOnlyNotification());

    expect(sent).toEqual([{ to: "user@example.test", subject: "Ping", body: "Plain text only" }]);
  });

  test("skips mail when route is null", async () => {
    const sent: string[] = [];
    const user: Notifiable = {
      getNotificationKey: () => 1,
      routeNotificationFor: () => null,
    };

    const dispatcher = createNotificationDispatcher(
      new Mailer(
        new (class {
          send(message: { body: string }) {
            sent.push(message.body);
            return Promise.resolve();
          }
        })(),
      ),
    );

    await dispatcher.send(user, new MailOnlyNotification());
    expect(sent).toEqual([]);
  });
});
