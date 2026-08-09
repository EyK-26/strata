import { describe, expect, test } from "bun:test";
import { BadRequestError } from "../../src/core/errors/http";
import {
  parseCreateProjectBody,
  parseProjectIdParams,
  parseProjectListQuery,
  parseUpdateProjectBody,
} from "../../src/modules/project/requests";

describe("project requests", () => {
  test("parseProjectIdParams parses positive integer ids", () => {
    expect(parseProjectIdParams({ id: "9" })).toEqual({ id: 9 });
  });

  test("parseProjectIdParams rejects invalid ids", () => {
    expect(() => parseProjectIdParams({ id: "abc" })).toThrow(BadRequestError);
  });

  test("parseProjectListQuery validates pagination and filters", () => {
    const request = new Request(
      "http://localhost/projects?page=1&per_page=10&organizationId=2&status=active&include=organization",
    );

    expect(parseProjectListQuery(request)).toEqual({
      page: 1,
      perPage: 10,
      organizationId: 2,
      status: "active",
      include: "organization",
    });
  });

  test("parseProjectListQuery rejects invalid include values", () => {
    const request = new Request("http://localhost/projects?include=project");

    expect(() => parseProjectListQuery(request)).toThrow(BadRequestError);
  });

  test("parseCreateProjectBody validates create payloads", async () => {
    const request = new Request("http://localhost/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        organization_id: 1,
        name: "Platform",
        status: "active",
      }),
    });

    await expect(parseCreateProjectBody(request)).resolves.toEqual({
      organization_id: 1,
      name: "Platform",
      status: "active",
    });
  });

  test("parseUpdateProjectBody validates partial updates", async () => {
    const request = new Request("http://localhost/projects/1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Renamed project" }),
    });

    await expect(parseUpdateProjectBody(request)).resolves.toEqual({
      name: "Renamed project",
    });
  });

  test("parseUpdateProjectBody rejects non-object bodies", async () => {
    const request = new Request("http://localhost/projects/1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(null),
    });

    await expect(parseUpdateProjectBody(request)).rejects.toThrow(
      "Request body must be a JSON object.",
    );
  });

  test("parseUpdateProjectBody validates status-only updates", async () => {
    const request = new Request("http://localhost/projects/1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "archived" }),
    });

    await expect(parseUpdateProjectBody(request)).resolves.toEqual({ status: "archived" });
  });

  test("parseUpdateProjectBody requires at least one field", async () => {
    const request = new Request("http://localhost/projects/1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    await expect(parseUpdateProjectBody(request)).rejects.toThrow(
      'At least one of "name" or "status" must be provided.',
    );
  });
});
