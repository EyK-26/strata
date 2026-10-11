import { join } from "node:path";
import { createViewProvider } from "@getstrata/bootstrap/providers/view";

export default createViewProvider({
  directory: join(import.meta.dir, "../../../views"),
  data: { userKey: "currentUser" },
});
