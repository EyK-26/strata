import { NotFoundError } from "../../core/errors/http";
import OrganizationRepository from "./repository";
import type { OrganizationRecord } from "./types";

interface CreateOrganizationInput {
  name: string;
  slug: string;
}

interface UpdateOrganizationInput {
  name?: string;
  slug?: string;
}

class OrganizationService {
  constructor(private readonly repository: OrganizationRepository) {}

  paginate(options: { page: number; perPage: number }) {
    return this.repository.paginate(options);
  }

  findByIdOrThrow(id: number): Promise<OrganizationRecord> {
    return this.repository.findByIdOrThrow(id, (organizationId) =>
      new NotFoundError(`Organization ${organizationId} not found.`),
    );
  }

  create(input: CreateOrganizationInput): Promise<OrganizationRecord> {
    const now = new Date();

    return this.repository.create({
      name: input.name,
      slug: input.slug,
      created_at: now,
      updated_at: now,
    });
  }

  async update(
    id: number,
    input: UpdateOrganizationInput,
  ): Promise<OrganizationRecord> {
    const changes: UpdateOrganizationInput & { updated_at: Date } = {
      updated_at: new Date(),
    };

    if (input.name !== undefined) {
      changes.name = input.name;
    }

    if (input.slug !== undefined) {
      changes.slug = input.slug;
    }

    return await this.repository.updateByIdOrThrow(id, changes);
  }

  async delete(id: number): Promise<void> {
    const deleted = await this.repository.deleteById(id);

    if (!deleted) {
      throw new NotFoundError(`Organization ${id} not found.`);
    }
  }
}

export default OrganizationService;
export type { CreateOrganizationInput, UpdateOrganizationInput };
