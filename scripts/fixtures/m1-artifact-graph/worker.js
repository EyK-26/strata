self.onmessage = () => {
  import("./worker-child.js").then(({ child }) => self.postMessage(child));
};
