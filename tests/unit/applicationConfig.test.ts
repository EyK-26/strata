import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  configEnum,
  configInteger,
  parseApplicationConfig,
} from "@getstrata/core/config/applicationConfig";

test("typed configuration copies plain settings and freezes the validated conversion input", () => {
  const input = { NAME: "first", PORT: "42", DRIVER: "array" };
  const shared = { enabled: true };
  const output = { name: "first", nested: { values: [shared, null] }, other: shared };
  const settings = parseApplicationConfig(
    {
      NAME: { required: true },
      PORT: { required: true, integer: true, minimum: 1, maximum: 100 },
      DRIVER: { required: true },
    },
    input,
    (values) => {
      assert.ok(Object.isFrozen(values));
      return {
        ...output,
        name: values.NAME,
        port: configInteger("PORT", values.PORT),
        driver: configEnum("DRIVER", values.DRIVER, ["array", "redis"]),
      };
    },
  );
  input.NAME = "changed";
  output.nested.values.splice(0);
  shared.enabled = false;
  assert.equal(settings.name, "first");
  assert.equal(settings.port, 42);
  assert.equal(settings.driver, "array");
  assert.deepEqual(settings.nested.values, [{ enabled: true }, null]);
  assert.deepEqual(settings.other, { enabled: true });
  assert.ok(Object.isFrozen(settings));
  assert.ok(Object.isFrozen(settings.nested.values));
  assert.equal(Object.isFrozen(shared), false, "Parser must not freeze caller-owned objects");
});

test("explicit configuration input never falls back to ambient environment", () => {
  const previous = process.env.STRATA_SETTINGS_EXPLICIT;
  process.env.STRATA_SETTINGS_EXPLICIT = "ambient-secret";
  try {
    const settings = parseApplicationConfig(
      {
        STRATA_SETTINGS_EXPLICIT: { default: "declared" },
        OPTIONAL: {},
      },
      {},
      (values) => ({
        value: values.STRATA_SETTINGS_EXPLICIT,
        optionalPresent: values.OPTIONAL !== undefined,
      }),
    );
    assert.deepEqual(settings, { value: "declared", optionalPresent: false });
    assert.throws(() =>
      parseApplicationConfig({ STRATA_SETTINGS_EXPLICIT: { required: true } }, {}, () => ({})),
    );
  } finally {
    if (previous === undefined) delete process.env.STRATA_SETTINGS_EXPLICIT;
    else process.env.STRATA_SETTINGS_EXPLICIT = previous;
  }
});

test("integer validation consumes the whole string and enforces safe bounds before conversion", () => {
  let conversions = 0;
  for (const value of ["7oops", "1.5", "9007199254740993", "0", "101"]) {
    assert.throws(() =>
      parseApplicationConfig(
        { COUNT: { required: true, integer: true, minimum: 1, maximum: 100 } },
        { COUNT: value },
        () => {
          conversions++;
          return {};
        },
      ),
    );
  }
  assert.equal(conversions, 0);
  assert.equal(configInteger("COUNT", " +7 ", { minimum: 1, maximum: 10 }), 7);
  for (const value of ["", "1.2", "7suffix", "Infinity", "9007199254740993", "-1", "11"]) {
    assert.throws(() => configInteger("COUNT", value, { minimum: 0, maximum: 10 }));
  }
});

test("framework configuration diagnostics expose fields and rules without raw secret values", () => {
  const secret = "never-echo-this-setting-value";
  const failures = [
    () => configInteger("COUNT", secret),
    () => configEnum("DRIVER", secret, ["array", "redis"]),
    () =>
      parseApplicationConfig(
        { SECRET: { required: true, pattern: /^accepted$/ } },
        { SECRET: secret },
        () => ({}),
      ),
  ];
  for (const fail of failures) {
    let caught = false;
    try {
      fail();
    } catch (error) {
      caught = true;
      assert.ok(error instanceof Error);
      assert.equal(error.message.includes(secret), false);
      assert.ok(/COUNT|DRIVER|SECRET/.test(error.message));
    }
    assert.equal(caught, true);
  }
});

test("configuration rejects exotic, cyclic, sparse, hidden and accessor outputs without evaluating getters", () => {
  let reads = 0;
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  const accessor = Object.defineProperty({}, "secret", {
    enumerable: true,
    get() {
      reads++;
      throw new Error("getter executed");
    },
  });
  const invalid: unknown[] = [
    null,
    3,
    [],
    new Map(),
    new Date(),
    cycle,
    accessor,
    { missing: undefined },
    { infinite: Infinity },
    { sparse: Array(2) },
    Object.create({ inherited: true }),
    Object.defineProperty({}, "hidden", { value: true }),
    { [Symbol("hidden")]: true },
  ];
  for (const output of invalid)
    assert.throws(() => parseApplicationConfig({}, {}, () => output as never));
  assert.equal(reads, 0);
});

test("configuration preserves an opaque converter failure including undefined", () => {
  let reads = 0;
  const hostile = new Error();
  for (const key of ["message", "name", "cause", "code", "toString"]) {
    Object.defineProperty(hostile, key, {
      get() {
        reads++;
        throw new Error("opaque payload inspected");
      },
    });
  }
  for (const marker of [undefined, null, 0, hostile]) {
    let caught = false;
    try {
      parseApplicationConfig({}, {}, () => {
        throw marker;
      });
    } catch (error) {
      caught = true;
      assert.equal(error, marker);
    }
    assert.equal(caught, true);
  }
  assert.equal(reads, 0);
});

test("configuration reads selected own data fields without invoking accessors or inherited defaults", () => {
  let reads = 0;
  const selected = Object.defineProperty({}, "PORT", {
    enumerable: true,
    get() {
      reads++;
      return "9";
    },
  });
  assert.throws(() => parseApplicationConfig({ PORT: { required: true } }, selected, () => ({})));
  const unknown = Object.defineProperty({ PORT: "7" }, "UNUSED_SECRET", {
    get() {
      reads++;
      throw new Error("unselected input read");
    },
  });
  assert.equal(
    parseApplicationConfig({ PORT: { required: true } }, unknown, (env) => ({
      port: configInteger("PORT", env.PORT),
    })).port,
    7,
  );
  const inherited = Object.create({ PORT: "99" }) as Record<string, string>;
  assert.throws(() => parseApplicationConfig({ PORT: { required: true } }, inherited, () => ({})));
  assert.equal(
    parseApplicationConfig({ PORT: { default: "2" } }, inherited, (env) => ({
      port: configInteger("PORT", env.PORT),
    })).port,
    2,
  );
  assert.equal(reads, 0);
});

test("configuration accepts an explicitly supplied process environment mapping and snapshots it", () => {
  const previous = process.env.STRATA_CONFIG_OWN_FIELD;
  process.env.STRATA_CONFIG_OWN_FIELD = "initial";
  try {
    const settings = parseApplicationConfig(
      { STRATA_CONFIG_OWN_FIELD: { required: true } },
      process.env,
      (env) => ({ value: env.STRATA_CONFIG_OWN_FIELD }),
    );
    process.env.STRATA_CONFIG_OWN_FIELD = "changed";
    assert.equal(settings.value, "initial");
  } finally {
    if (previous === undefined) delete process.env.STRATA_CONFIG_OWN_FIELD;
    else process.env.STRATA_CONFIG_OWN_FIELD = previous;
  }
});

test("malformed schema metadata rejects before conversion and without executing rule getters", () => {
  let effects = 0;
  const accessorRule = Object.defineProperty({}, "required", {
    enumerable: true,
    get() {
      effects++;
      return true;
    },
  });
  const accessorSchema = Object.defineProperty({}, "VALUE", {
    enumerable: true,
    get() {
      effects++;
      return {};
    },
  });
  const invalid: unknown[] = [
    accessorSchema,
    { VALUE: accessorRule },
    { VALUE: { required: "yes" } },
    { VALUE: { integer: true, minimum: 10, maximum: 1 } },
    { VALUE: { integer: true, maximum: Infinity } },
  ];
  for (const schema of invalid)
    assert.throws(() =>
      parseApplicationConfig(schema as never, { VALUE: "2" }, () => {
        effects++;
        return {};
      }),
    );
  assert.throws(() =>
    parseApplicationConfig({ VALUE: { default: " " } }, {}, () => {
      effects++;
      return {};
    }),
  );
  assert.equal(effects, 0);
});

test("missing or malformed explicit input never activates a legacy environment default", () => {
  let conversions = 0;
  for (const input of [undefined, null, 3, "not a mapping", []]) {
    assert.throws(() =>
      parseApplicationConfig({}, input as never, () => {
        conversions++;
        return {};
      }),
    );
  }
  assert.equal(conversions, 0);
});

test("malformed schema, selected input and conversion helper arguments reject defensively", () => {
  let conversions = 0;
  for (const schema of [
    null,
    [],
    3,
    { VALUE: null },
    { VALUE: { unknownRule: true } },
    { VALUE: { integer: "yes" } },
    { VALUE: { minimum: 1 } },
    { VALUE: { default: 1 } },
    { VALUE: { pattern: "not a regex" } },
  ]) {
    assert.throws(() =>
      parseApplicationConfig(schema as never, { VALUE: "2" }, () => {
        conversions++;
        return {};
      }),
    );
  }
  assert.throws(() =>
    parseApplicationConfig({ VALUE: {} }, { VALUE: 3 } as never, () => {
      conversions++;
      return {};
    }),
  );
  assert.throws(() => parseApplicationConfig({}, {}, 3 as never));
  for (const bounds of [
    { minimum: NaN },
    { maximum: Infinity },
    { minimum: 10, maximum: 1 },
    { maximum: 1.5 },
  ]) {
    assert.throws(() => configInteger("COUNT", "2", bounds));
  }
  assert.throws(() => configEnum("DRIVER", "array", [] as never));
  assert.throws(() => configEnum("DRIVER", 3 as never, ["array", "redis"]));
  assert.equal(conversions, 0);
});
