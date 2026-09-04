import { BaseRepository } from "@getstrata/core/database/baseRepository";
import type {
  MutationValues,
  QueryOptions,
  QueryWhere,
  UpdateValues,
} from "@getstrata/core/database/types";
import type { WhereNode } from "@getstrata/core/database/whereBuilder";
import { createAsyncContextStore } from "@getstrata/core/runtime/asyncContextStore";
import { isTenancyEnabled } from "@getstrata/core/tenant/tenancyConfig";
import { currentTenant, currentTenantId } from "@getstrata/core/tenant/tenantContext";

type TenantEntity = { tenant_id?: number | null };

const skipTenantScope = createAsyncContextStore<true>("hiroapp.skipTenantScope");

export function runWithoutTenantScope<T>(callback: () => T | Promise<T>): T | Promise<T> {
  return skipTenantScope.run(true, callback);
}

export class TenantRepository<
  TEntity extends TenantEntity,
  PrimaryKey extends keyof TEntity & string,
> extends BaseRepository<TEntity, PrimaryKey> {
  private scopedWhere(where: QueryWhere<TEntity> = {}): QueryWhere<TEntity> {
    if (skipTenantScope.getStore() || !isTenancyEnabled() || !currentTenant()) {
      return where;
    }
    return { ...where, tenant_id: currentTenantId() };
  }

  override async findAll(
    options: QueryOptions<TEntity> & { whereNodes?: WhereNode<TEntity>[] } = {},
  ) {
    return super.findAll({
      ...options,
      where: this.scopedWhere(options.where),
    });
  }

  protected override async countWhere(
    where: QueryWhere<TEntity> = {},
    options: Pick<QueryOptions<TEntity>, "withTrashed" | "onlyTrashed" | "joins" | "groupBy"> = {},
    whereNodes: readonly WhereNode<TEntity>[] = [],
  ): Promise<number> {
    return super.countWhere(this.scopedWhere(where), options, whereNodes);
  }

  override async create(values: MutationValues<TEntity>): Promise<TEntity> {
    const tenantId = values.tenant_id ?? (currentTenant() ? currentTenantId() : undefined);
    return super.create(tenantId === undefined ? values : { ...values, tenant_id: tenantId });
  }

  override async updateById(
    id: TEntity[PrimaryKey],
    changes: UpdateValues<TEntity, PrimaryKey>,
  ): Promise<TEntity | null> {
    if (!(await this.findById(id))) {
      return null;
    }
    return super.updateById(id, changes);
  }

  override async deleteById(id: TEntity[PrimaryKey]): Promise<boolean> {
    if (!(await this.findById(id))) {
      return false;
    }
    return super.deleteById(id);
  }
}
