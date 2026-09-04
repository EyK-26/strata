function asRecord<T extends object>(value: T | { toObject: () => T }): T {
  if (value && typeof (value as { toObject?: unknown }).toObject === "function") {
    return (value as { toObject: () => T }).toObject();
  }
  return value as T;
}

export function iso(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function dateOnly(value: Date | string | null | undefined) {
  if (!value) return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

export function hiringFlag(value: boolean | number | string | null | undefined) {
  return value === true || value === 1 || value === "1" ? 1 : 0;
}

function id(value: unknown) {
  return Number(value);
}

export function serializeTimestamps(record: {
  created_at?: Date | string | null;
  updated_at?: Date | string | null;
}) {
  return {
    created_at: iso(record.created_at),
    updated_at: iso(record.updated_at),
  };
}

export function serializeUser(
  user:
    | {
        id: number;
        first_name: string;
        last_name: string;
        email: string;
        role_id: number;
        created_at?: Date | string | null;
        updated_at?: Date | string | null;
      }
    | {
        toObject: () => {
          id: number;
          first_name: string;
          last_name: string;
          email: string;
          role_id: number;
          created_at?: Date | string | null;
          updated_at?: Date | string | null;
        };
      },
  extras: Record<string, unknown> = {},
) {
  user = asRecord(user);
  return {
    id: id(user.id),
    first_name: user.first_name,
    last_name: user.last_name,
    email: user.email,
    email_verified_at: null,
    role_id: id(user.role_id),
    ...serializeTimestamps(user),
    ...extras,
  };
}

export function serializePosition(
  position: {
    id: number;
    user_id: number | null;
    department_id: number;
    grade_id: number;
    name: string;
    description: string | null;
    hiring: boolean | number;
    start_date: Date | string | null;
    end_date: Date | string | null;
    created_at?: Date | string | null;
    updated_at?: Date | string | null;
  },
  extras: Record<string, unknown> = {},
) {
  position = asRecord(position);
  return {
    id: id(position.id),
    user_id: position.user_id === null ? null : id(position.user_id),
    department_id: id(position.department_id),
    grade_id: id(position.grade_id),
    name: position.name,
    description: position.description,
    hiring: hiringFlag(position.hiring),
    start_date: dateOnly(position.start_date),
    end_date: dateOnly(position.end_date),
    ...serializeTimestamps(position),
    ...extras,
  };
}

export function serializeApplication(
  application: {
    id: number;
    user_id: number;
    position_id: number | null;
    status_id: number;
    attachment_text: string | null;
    attachment_file: string | null;
    created_at?: Date | string | null;
    updated_at?: Date | string | null;
  },
  extras: Record<string, unknown> = {},
) {
  application = asRecord(application);
  return {
    id: id(application.id),
    user_id: id(application.user_id),
    position_id: application.position_id === null ? null : id(application.position_id),
    status_id: id(application.status_id),
    attachment_text: application.attachment_text,
    attachment_file: application.attachment_file,
    ...serializeTimestamps(application),
    ...extras,
  };
}

export function serializeNotification(notification: {
  id: string;
  type: string;
  notifiable_type: string;
  notifiable_id: number;
  data: unknown;
  read_at: Date | string | null;
  created_at?: Date | string | null;
  updated_at?: Date | string | null;
}) {
  notification = asRecord(notification);
  return {
    id: notification.id,
    type: notification.type,
    notifiable_type: notification.notifiable_type,
    notifiable_id: id(notification.notifiable_id),
    data: typeof notification.data === "string" ? JSON.parse(notification.data) : notification.data,
    read_at: iso(notification.read_at),
    ...serializeTimestamps(notification),
  };
}

export function serializeNamed(record: {
  id: number;
  name: string;
  created_at?: Date | string | null;
  updated_at?: Date | string | null;
}) {
  record = asRecord(record);
  return {
    id: id(record.id),
    name: record.name,
    ...serializeTimestamps(record),
  };
}
