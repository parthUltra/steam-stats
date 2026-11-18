import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { childEnv } from "./spawn-script";

describe("childEnv", () => {
  const source = {
    PATH: "/usr/bin",
    HTTPS_PROXY: "http://proxy.example.test:8080",
    HTTP_PROXY: "http://proxy.example.test:8080",
    NO_PROXY: "localhost,127.0.0.1",
    https_proxy: "http://proxy.example.test:8080",
    NODE_EXTRA_CA_CERTS: "/etc/ssl/corp-ca.pem",
    ISTHEREANYDEAL_API_KEY: "k".repeat(32),
    STEAM_STATS_ROOT: "/data/root",
    STEAM_STATS_SKIP_PRICES: "1",
    // must never reach a child
    NODE_OPTIONS: "--require /tmp/evil.js",
    NODE_PATH: "/tmp",
    STEAM_API_KEY: "unused-key",
    LD_PRELOAD: "/tmp/evil.so",
    npm_config_registry: "http://evil.example.test",
  };

  it("passes proxy and private-CA settings through", () => {
    const env = childEnv(source);
    assert.equal(env.HTTPS_PROXY, source.HTTPS_PROXY);
    assert.equal(env.HTTP_PROXY, source.HTTP_PROXY);
    assert.equal(env.NO_PROXY, source.NO_PROXY);
    assert.equal(env.https_proxy, source.https_proxy);
    assert.equal(env.NODE_EXTRA_CA_CERTS, source.NODE_EXTRA_CA_CERTS);
    assert.equal(env.ISTHEREANYDEAL_API_KEY, source.ISTHEREANYDEAL_API_KEY);
    assert.equal(env.STEAM_STATS_SKIP_PRICES, "1");
  });

  it("drops anything that makes Node load code, and the unused Steam key", () => {
    const env = childEnv(source);
    for (const name of [
      "NODE_OPTIONS",
      "NODE_PATH",
      "LD_PRELOAD",
      "npm_config_registry",
      "STEAM_API_KEY",
    ]) {
      assert.equal(name in env, false, name);
    }
  });

  it("omits variables that are not set", () => {
    assert.deepEqual(childEnv({ PATH: "/bin" }), { PATH: "/bin" });
  });
});
