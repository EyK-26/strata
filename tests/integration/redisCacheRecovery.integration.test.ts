import { describe, expect, test } from "bun:test";
import RedisCacheStore from "../../src/core/cache/redisCacheStore";
import { restoreEnvVar } from "../helpers/restoreEnv";

const upstreamUrl = process.env.REDIS_URL?.trim();
const suite = upstreamUrl ? describe : describe.skip;
suite("Redis cache transport recovery", () => {
  test("same store recovers on later calls without replaying failed commands; close stays final", async () => {
    const upstream = new URL(upstreamUrl!);
    const sockets = new Set<Bun.Socket<unknown>>();
    let online = true;
    let silent = false;
    const proxy = Bun.listen<{ peer?: Bun.Socket<unknown>; buffer: Buffer[] }>({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        open(socket) {
          sockets.add(socket);
          socket.data = { buffer: [] };
          if (!online) {
            socket.end();
            return;
          }
          void Bun.connect({
            hostname: upstream.hostname,
            port: Number(upstream.port || 6379),
            socket: {
              open(peer) {
                sockets.add(peer);
                socket.data.peer = peer;
                for (const data of socket.data.buffer) peer.write(data);
                socket.data.buffer = [];
              },
              data(_peer, data) {
                if (!silent) socket.write(data);
              },
              close(peer) {
                sockets.delete(peer);
                socket.end();
              },
              error(peer) {
                sockets.delete(peer);
                socket.end();
              },
            },
          }).catch(() => socket.end());
        },
        data(socket, data) {
          if (socket.data.peer) socket.data.peer.write(data);
          else socket.data.buffer.push(Buffer.from(data));
        },
        close(socket) {
          sockets.delete(socket);
          socket.data.peer?.end();
        },
        error(socket) {
          sockets.delete(socket);
          socket.data.peer?.end();
        },
      },
    });
    const url = new URL(upstreamUrl!);
    url.hostname = "127.0.0.1";
    url.port = String(proxy.port);
    const previous = process.env.APP_KEY_PREFIX;
    process.env.APP_KEY_PREFIX = `cache-recovery-${crypto.randomUUID()}`;
    const store = new RedisCacheStore(url.href, 10000, 10, {
      commandTimeoutMs: 200,
      leaseMs: 300,
      fillTimeoutMs: 2000,
      metadataTtlMs: 4000,
    });
    restoreEnvVar("APP_KEY_PREFIX", previous);
    try {
      await store.set("retained", "value");
      online = false;
      for (const socket of [...sockets]) socket.terminate();
      await expect(store.get("retained")).rejects.toThrow();
      online = true;
      expect(await store.get("retained")).toBe("value");
      silent = true;
      await expect(store.set("uncertain", "sent-once")).rejects.toThrow("deadline");
      silent = false;
      expect(await store.get("retained")).toBe("value");
      await store.invalidate("uncertain");
      let release!: () => void;
      let began!: () => void;
      const beganLoading = new Promise<void>((resolve) => {
        began = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const fill = store
        .getOrSet("old-fill", async () => {
          began();
          await gate;
          return "stale";
        })
        .then(
          () => undefined,
          (error) => error,
        );
      await beganLoading;
      online = false;
      for (const socket of [...sockets]) socket.terminate();
      const failures = await Promise.allSettled([store.get("retained"), store.size()]);
      expect(failures.every((result) => result.status === "rejected")).toBe(true);
      expect(await fill).toBeInstanceOf(Error);
      online = true;
      release();
      expect(await store.get("old-fill")).toBeUndefined();
      await store.clear();
      store.close();
      await expect(store.get("retained")).rejects.toThrow("closed");
    } finally {
      // The namespace was cleared before exercising irreversible explicit closure.
      for (const socket of [...sockets]) socket.terminate();
      proxy.stop(true);
      store.close();
    }
  }, 15000);
});
