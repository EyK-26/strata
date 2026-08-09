import { describe, expect, test } from "bun:test";
import { parseWebCreateCommentPayload } from "../../src/modules/comment/webRequests";
import { parseWebCreateProjectPayload } from "../../src/modules/project/webRequests";
import { parseWebCreateTaskPayload } from "../../src/modules/task/webRequests";

describe("web form payloads", () => {
  test("parseWebCreateProjectPayload validates organization and name", () => {
    const body = parseWebCreateProjectPayload({
      organization_id: "1",
      name: " Platform ",
      status: "active",
    });

    expect(body.organization_id).toBe(1);
    expect(body.name).toBe("Platform");
    expect(body.status).toBe("active");
  });

  test("parseWebCreateTaskPayload validates project and title", () => {
    const body = parseWebCreateTaskPayload({
      project_id: "2",
      title: " Ship it ",
      status: "todo",
      priority: "3",
    });

    expect(body.project_id).toBe(2);
    expect(body.title).toBe("Ship it");
    expect(body.priority).toBe(3);
  });

  test("parseWebCreateCommentPayload trims body", () => {
    const body = parseWebCreateCommentPayload({ body: "  hello  " });
    expect(body.body).toBe("hello");
  });
});
