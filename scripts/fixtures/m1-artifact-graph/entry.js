import { build } from "./build.js";
import { shared } from "./shared.js";

document.body.dataset.entry = build;
document.body.dataset.shared = shared;
document.querySelector("#load").addEventListener("click", () => {
  import("./lazy.js")
    .then(({ lazy }) => {
      document.body.dataset.lazy = lazy;
    })
    .catch(() => {
      document.body.dataset.lazy = "rejected";
    });
});
