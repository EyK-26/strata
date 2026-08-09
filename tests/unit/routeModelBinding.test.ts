import { describe, expect, test } from "bun:test";
import { NotFoundError } from "@getstrata/core/errors/http";
import { bindRouteModel } from "@getstrata/core/http/routeModelBinding";

type OrganizationParams = { id: string };

describe("bindRouteModel", () => {
  test("resolves the route param and passes the model to the handler", async () => {
    const handler = bindRouteModel(
      "id",
      async (id) => ({ id, slug: "acme-labs" }),
      async (_request, organization) => {
        return Response.json(organization);
      },
    );

    const response = await handler({
      params: { id: "7" },
    } as Request & { params: OrganizationParams });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: 7, slug: "acme-labs" });
  });

  test("propagates resolver failures such as not found errors", async () => {
    const handler = bindRouteModel(
      "id",
      async (id) => {
        throw new NotFoundError(`Organization ${id} not found.`);
      },
      async () => Response.json({ ok: true }),
    );

    await expect(
      handler({
        params: { id: "404" },
      } as Request & { params: OrganizationParams }),
    ).rejects.toThrow("Organization 404 not found.");
  });
});
