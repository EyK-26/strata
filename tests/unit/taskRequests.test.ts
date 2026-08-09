import { describe, expect, test } from "bun:test";
import { BadRequestError } from "../../src/core/errors/http";
import {
  parseCreateTaskBody,
  parseTaskIdParams,
  parseTaskListQuery,
  parseUpdateTaskBody,
} from "../../src/modules/task/requests";

describe("task requests", () => {
  test("parseTaskIdParams parses positive integer ids", () => {
    expect(parseTaskIdParams({ id: "12" })).toEqual({ id: 12 });
  });

  test("parseTaskIdParams rejects invalid ids", () => {
    expect(() => parseTaskIdParams({ id: "0" })).toThrow(BadRequestError);
  });

  test("parseTaskListQuery validates pagination and filters", () => {
    const request = new Request(
      "http://localhost/tasks?page=2&per_page=5&projectId=3&status=todo&include=project",
    );

    expect(parseTaskListQuery(request)).toEqual({
      page: 2,
      perPage: 5,
      projectId: 3,
      status: "todo",
      include: "project",
    });
  });

  test("parseTaskListQuery rejects invalid include values", () => {
    const request = new Request("http://localhost/tasks?include=organization");

    expect(() => parseTaskListQuery(request)).toThrow(BadRequestError);
  });

  test("parseCreateTaskBody validates create payloads", async () => {
    const request = new Request("http://localhost/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        project_id: 1,
        title: "Write tests",
        status: "todo",
        priority: 2,
      }),
    });

    await expect(parseCreateTaskBody(request)).resolves.toEqual({
      project_id: 1,
      title: "Write tests",
      status: "todo",
      priority: 2,
    });
  });

  test("parseUpdateTaskBody validates partial updates", async () => {
    const request = new Request("http://localhost/tasks/1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Updated title", priority: 4 }),
    });

    await expect(parseUpdateTaskBody(request)).resolves.toEqual({
      title: "Updated title",
      priority: 4,
    });
  });

  test("parseUpdateTaskBody rejects non-object bodies", async () => {
    const request = new Request("http://localhost/tasks/1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(["invalid"]),
    });

    await expect(parseUpdateTaskBody(request)).rejects.toThrow(
      "Request body must be a JSON object.",
    );
  });

  test("parseUpdateTaskBody validates status-only updates", async () => {
    const request = new Request("http://localhost/tasks/1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "done" }),
    });

    await expect(parseUpdateTaskBody(request)).resolves.toEqual({ status: "done" });
  });

  test("parseUpdateTaskBody requires at least one field", async () => {
    const request = new Request("http://localhost/tasks/1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    await expect(parseUpdateTaskBody(request)).rejects.toThrow(
      'At least one of "title", "status", or "priority" must be provided.',
    );
  });
});
