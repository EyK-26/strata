import { describe, expect, test } from "bun:test";
import { LogMailDriver, Mailer } from "@getstrata/core/mail/mailer";
import {
  createNotificationDispatcher,
  type DatabaseNotificationStore,
  type Notifiable,
  Notification,
  type NotificationChannel,
} from "@getstrata/core/notifications";

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

  test("rejects database channel when store is not configured", async () => {
    const dispatcher = createNotificationDispatcher(new Mailer(new LogMailDriver()));
    await expect(
      dispatcher.send(new TestUser(1, "user@example.test"), new WelcomeNotification()),
    ).rejects.toThrow('Notification channel "database" requires a database store.');
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

test("channels with no message or payload have no delivery side effects", async () => {
  class EmptyNotification extends Notification<TestUser> {
    override via(): Array<"mail" | "database"> {
      return ["mail", "database"];
    }
  }
  const calls: string[] = [];
  const dispatcher = createNotificationDispatcher(
    new Mailer({
      async send() {
        calls.push("mail");
      },
    }),
    {
      async create(input) {
        calls.push("database");
        return { ...input };
      },
    },
  );
  await dispatcher.send(new TestUser(1, "one@example.test"), new EmptyNotification());
  expect(calls).toEqual([]);
});

test("preserves explicit HTML in mail notifications with a minimal sender", async () => {
  const messages: unknown[] = [];
  class HtmlNotification extends MailOnlyNotification {
    override toMail() {
      return { subject: "HTML", body: "Hello", html: "<p>Hello</p>" };
    }
  }
  const dispatcher = createNotificationDispatcher({
    async send(message) {
      messages.push(message);
    },
  });
  await dispatcher.send(new TestUser(1, "one@example.test"), new HtmlNotification());
  expect(messages).toEqual([
    { to: "one@example.test", subject: "HTML", body: "Hello", html: "<p>Hello</p>" },
  ]);
});

class SmsNotification extends Notification {
  override via() {
    return ["sms", "webhook"];
  }
  readonly text = "Your order shipped";
}

test("delivers custom channels in order with typed handler context", async () => {
  const calls: string[] = [];
  const sms: NotificationChannel = {
    async send(recipient, notification) {
      if (!(notification instanceof SmsNotification))
        throw new TypeError("Expected SMS notification");
      calls.push(`sms:${recipient.routeNotificationFor("sms")}:${notification.text}`);
    },
  };
  const dispatcher = createNotificationDispatcher({ async send() {} }, undefined, {
    sms,
    webhook: {
      async send(recipient) {
        calls.push(`webhook:${recipient.getNotificationKey()}`);
      },
    },
  });
  await dispatcher.send(new TestUser(7, "seven@example.test"), new SmsNotification());
  expect(calls).toEqual(["sms:7:Your order shipped", "webhook:7"]);
});

test("channel maps and method registrations are snapshotted per application", async () => {
  const calls: string[] = [];
  const channels = {
    sms: {
      async send() {
        calls.push("first");
      },
    },
    webhook: { async send() {} },
  };
  const first = createNotificationDispatcher({ async send() {} }, undefined, channels);
  channels.sms.send = async () => {
    calls.push("second");
  };
  const second = createNotificationDispatcher({ async send() {} }, undefined, channels);
  await first.send(new TestUser(1, "one@example.test"), new SmsNotification());
  await second.send(new TestUser(1, "one@example.test"), new SmsNotification());
  expect(calls).toEqual(["first", "second"]);
  const unconfigured = createNotificationDispatcher({ async send() {} });
  await expect(
    unconfigured.send(new TestUser(1, "one@example.test"), new SmsNotification()),
  ).rejects.toThrow('Unsupported notification channel: "sms".');
});

test("unsupported and misconfigured channels fail before any delivery", async () => {
  let sends = 0;
  class UnknownNotification extends MailOnlyNotification {
    override via(): ["mail"] {
      return ["mail"];
    }
  }
  // Runtime input may contain untrusted channel names, including prototype properties.
  for (const name of ["missing", "toString", "__proto__", "database"]) {
    const notification = new UnknownNotification();
    notification.via = () => ["mail", name] as unknown as ["mail"];
    const dispatcher = createNotificationDispatcher({
      async send() {
        sends++;
      },
    });
    await expect(
      dispatcher.send(new TestUser(1, "one@example.test"), notification),
    ).rejects.toThrow();
  }
  expect(sends).toBe(0);
  expect(() =>
    createNotificationDispatcher({ async send() {} }, undefined, {
      sms: {} as NotificationChannel,
    }),
  ).toThrow('Invalid notification channel registration: "sms".');
});

test("channel delivery failures propagate and stop later channels", async () => {
  const failure = new Error("SMS unavailable");
  let laterCalls = 0;
  const dispatcher = createNotificationDispatcher({ async send() {} }, undefined, {
    sms: {
      async send() {
        throw failure;
      },
    },
    webhook: {
      async send() {
        laterCalls++;
      },
    },
  });
  await expect(
    dispatcher.send(new TestUser(1, "one@example.test"), new SmsNotification()),
  ).rejects.toBe(failure);
  expect(laterCalls).toBe(0);
});

test("validates built-in capabilities during construction", () => {
  expect(() => createNotificationDispatcher({} as never)).toThrow(
    'Notification channel "mail" requires a mail sender.',
  );
  expect(() => createNotificationDispatcher({ async send() {} }, {} as never)).toThrow(
    'Notification channel "database" requires a database store.',
  );
});

test("allows explicit replacement of built-in channels", async () => {
  const calls: string[] = [];
  const dispatcher = createNotificationDispatcher(
    {
      async send() {
        throw new Error("unexpected default mail");
      },
    },
    undefined,
    {
      mail: {
        async send() {
          calls.push("mail override");
        },
      },
      database: {
        async send() {
          calls.push("database override");
        },
      },
    },
  );
  await dispatcher.send(new TestUser(1, "one@example.test"), new WelcomeNotification());
  expect(calls).toEqual(["mail override", "database override"]);
});

test("built-in database delivery rejects malformed and unsafe user IDs before calling the store", async () => {
  const stored: number[] = [];
  const dispatcher = createNotificationDispatcher(
    { async send() {} },
    {
      async create(input) {
        stored.push(input.userId);
        return { ...input };
      },
    },
  );
  class DatabaseOnlyNotification extends WelcomeNotification {
    override via(): Array<"database"> {
      return ["database"];
    }
  }
  const notification = new DatabaseOnlyNotification();
  for (const key of [
    "a1b2-uuid",
    "",
    " ",
    "1.5",
    "1e3",
    "0x10",
    " 1",
    "+1",
    "-1",
    "0",
    "9007199254740993",
    0,
    -1,
    1.5,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    const recipient: Notifiable = {
      getNotificationKey: () => key,
      routeNotificationFor: () => null,
    };
    await expect(dispatcher.send(recipient, notification)).rejects.toThrow(
      'Notification channel "database" requires a positive safe-integer user ID.',
    );
  }
  expect(stored).toEqual([]);
  for (const key of [1, "42", Number.MAX_SAFE_INTEGER, String(Number.MAX_SAFE_INTEGER)]) {
    await dispatcher.send(
      { getNotificationKey: () => key, routeNotificationFor: () => null },
      notification,
    );
  }
  expect(stored).toEqual([1, 42, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]);
});

test("custom database handlers support application-specific identifiers", async () => {
  const keys: Array<string | number> = [];
  const dispatcher = createNotificationDispatcher({ async send() {} }, undefined, {
    database: {
      async send(recipient) {
        keys.push(recipient.getNotificationKey());
      },
    },
  });
  class DatabaseOnlyNotification extends Notification {
    override via() {
      return ["database"];
    }
  }
  await dispatcher.send(
    { getNotificationKey: () => "uuid-account", routeNotificationFor: () => null },
    new DatabaseOnlyNotification(),
  );
  expect(keys).toEqual(["uuid-account"]);
});
