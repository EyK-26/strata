const pagesModule = {
  name: "pages",
  order: 10,
  webRoutes() {
    return {
      "/home": async () => new Response("home"),
    };
  },
};

export default pagesModule;
