import { afterEach, describe, expect, it, vi } from "vitest";

const full = {
  DATABASE_URL: "postgres://radio@localhost:5432/radio",
  QOBUZ_TOKEN: "token",
  CLAUDE_KEY: "key",
  TYPESAFE_API_KEY: "key",
  ELEVENLABS_KEY: "key",
  BUCKET_ENDPOINT: "https://bucket.example",
  BUCKET_NAME: "radio-clips",
  BUCKET_REGION: "auto",
  BUCKET_ACCESS_KEY_ID: "id",
  BUCKET_SECRET_ACCESS_KEY: "secret",
};

/** `env()` caches per module, so each case reads a fresh copy over a stubbed process.env. */
async function envWithout(missing: string | null) {
  vi.resetModules();
  for (const [name, value] of Object.entries(full)) vi.stubEnv(name, name === missing ? undefined : value);
  for (const name of ["QOBUZ_APP_ID", "QOBUZ_SECRET"]) vi.stubEnv(name, undefined);
  const { env } = await import("./env");
  return env();
}

afterEach(() => vi.unstubAllEnvs());

describe("env — there is no show without any of these", () => {
  it("reads a complete environment, with the pinned defaults", async () => {
    expect(await envWithout(null)).toMatchObject({ BUCKET_NAME: "radio-clips", ELEVENLABS_KEY: "key" });
  });

  it.each(Object.keys(full))("a missing %s is a fault that names it", async (name) => {
    await expect(envWithout(name)).rejects.toThrow(name);
  });

  it("the Qobuz app pair stays optional: the code scrapes it when absent", async () => {
    const e = await envWithout(null);
    expect(e.QOBUZ_APP_ID).toBeUndefined();
    expect(e.QOBUZ_SECRET).toBeUndefined();
  });
});
