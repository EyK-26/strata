const reportsModule = {
  name: "reports",
  order: 20,
  tableName: "audit_log",
  cacheTags: [] as string[],
  routes() {
    return {
      "/reports/summary": async () => Response.json({ ok: true }),
    };
  },
};

export default reportsModule;
