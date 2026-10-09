import { Blueprint } from "@getstrata/core/database/schema";

const table = new Blueprint("orders", "create");
table.bigId().notNullable();
table.bigId("order_id");
// @ts-expect-error Identity column names are strings.
table.bigId(1);
