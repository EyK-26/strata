import { describe, expect, test } from "bun:test";
import {
  expectObject,
  parseJsonBody,
  parseOptionalBooleanQueryParam,
  parseOptionalEnumQueryParam,
  parseOptionalPositiveIntQueryParam,
} from "@getstrata/core/http";
import {
  parseOrganizationIdParams,
  parseOrganizationListQuery,
} from "../../src/modules/organization/requests";
import { toOrganizationResource } from "../../src/modules/organization/resources";
import type { OrganizationRecord } from "../../src/modules/organization/types";
import { parseProjectListQuery } from "../../src/modules/project/requests";
import { parseTaskListQuery } from "../../src/modules/task/requests";

describe("module request helpers", () => {
  test("parseOrganizationIdParams returns a typed integer id", () => {
    expect(parseOrganizationIdParams({ id: "42" })).toEqual({ id: 42 });
    expect(() => parseOrganizationIdParams({ id: "nope" })).toThrow(
      "Invalid organization id. Expected a positive integer.",
    );
  });

  test("parses validated query DTOs for workhub list endpoints", () => {
    const organizationRequest = new Request("http://example.test/organizations?page=2&per_page=10");
    const projectRequest = new Request(
      "http://example.test/projects?per_page=5&organizationId=1&include=organization",
    );
    const taskRequest = new Request(
      "http://example.test/tasks?projectId=2&status=in_progress&include=project",
    );

    expect(parseOrganizationListQuery(organizationRequest)).toEqual({
      page: 2,
      perPage: 10,
    });
    expect(parseProjectListQuery(projectRequest)).toEqual({
      page: 1,
      perPage: 5,
      organizationId: 1,
      include: "organization",
    });
    expect(parseTaskListQuery(taskRequest)).toEqual({
      page: 1,
      perPage: 15,
      projectId: 2,
      status: "in_progress",
      include: "project",
    });
  });
});

describe("http validation helpers", () => {
  test("validates primitive query helpers", () => {
    const params = new URLSearchParams("limit=3&isAlive=false&status=active");

    expect(parseOptionalPositiveIntQueryParam(params, "limit")).toBe(3);
    expect(parseOptionalBooleanQueryParam(params, "isAlive")).toBe(false);
    expect(parseOptionalEnumQueryParam(params, "status", ["draft", "active", "archived"])).toBe(
      "active",
    );
  });

  test("parses JSON bodies through a DTO validator", async () => {
    const request = new Request("http://example.test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Acme Labs", slug: "acme-labs" }),
    });

    const dto = await parseJsonBody(request, (payload) => {
      const body = expectObject(payload);
      const name = body.name;
      const slug = body.slug;

      if (typeof name !== "string" || name.length === 0) {
        throw new Error("name is required");
      }

      if (typeof slug !== "string" || slug.length === 0) {
        throw new Error("slug is required");
      }

      return { name, slug };
    });

    expect(dto).toEqual({ name: "Acme Labs", slug: "acme-labs" });
  });
});

describe("module resources", () => {
  test("serializes organization timestamps", () => {
    const organization: OrganizationRecord = {
      id: 1,
      tenant_id: 1,
      name: "Acme Labs",
      slug: "acme-labs",
      created_at: new Date("2024-01-01T00:00:00.000Z"),
      updated_at: new Date("2024-06-01T00:00:00.000Z"),
      deleted_at: null,
    };

    expect(toOrganizationResource(organization)).toEqual({
      id: 1,
      name: "Acme Labs",
      slug: "acme-labs",
      created_at: "2024-01-01T00:00:00.000Z",
      updated_at: "2024-06-01T00:00:00.000Z",
    });
  });
});
