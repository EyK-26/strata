import { Policy } from "@getstrata/core/auth/policy";

export class NotificationPolicy extends Policy {
  view(user?: unknown) {
    return Boolean(user);
  }

  create(user?: unknown) {
    return Boolean(user);
  }

  update(user?: unknown) {
    return Boolean(user);
  }
}
