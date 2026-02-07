import type { AppModule } from "./contracts";
import characterModule from "../modules/character/index.ts";
import nemesisModule from "../modules/nemesis/index.ts";
import secretModule from "../modules/secret/index.ts";
import statisticsModule from "../modules/statistics/index.ts";
import treeModule from "../modules/tree/index.ts";

const appModules: AppModule[] = [
  characterModule,
  nemesisModule,
  secretModule,
  statisticsModule,
  treeModule,
];

export { appModules };
