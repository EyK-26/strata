export const TEST_ADMIN_API_TOKEN = "workhub-admin-test-token";
export const TEST_MEMBER_API_TOKEN = "workhub-member-test-token";

export const USER_ROLES = ["admin", "member"] as const;

export type UserRole = (typeof USER_ROLES)[number];
