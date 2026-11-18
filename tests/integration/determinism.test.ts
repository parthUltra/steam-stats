/**
 * The request path is a pure function of the files in the data root:
 * same bytes out every time, nothing written, nothing fetched.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildDashboard } from "@/lib/analytics/dashboard";
import { GET as getDashboard } from "@/app/api/dashboard/route";
import { CANARIES, fetchLog, snapshotTree, testRoot } from "../helpers";

describe("buildDashboard() is deterministic and side-effect free", () => {
  it("a second build is byte-identical to the first", async () => {
    const first = JSON.stringify(await buildDashboard());
    const second = JSON.stringify(await buildDashboard());
    assert.equal(second.length, first.length);
    assert.ok(second === first, "payload differs between two builds");
  });

  it("no file in the data root is created, changed or removed by a build", async () => {
    const before = snapshotTree(testRoot());
    await buildDashboard();
    await buildDashboard();
    const res = await getDashboard();
    assert.equal(res.status, 200);
    const after = snapshotTree(testRoot());
    assert.deepEqual(after, before);
  });

  it("no fetch is attempted — the tripwire saw nothing", async () => {
    await buildDashboard();
    assert.deepEqual(fetchLog(), []);
  });

  it("the payload carries no secret and no wall-clock timestamp", async () => {
    const startedAt = new Date().toISOString().slice(0, 13); // yyyy-mm-ddThh
    const body = JSON.stringify(await buildDashboard());
    for (const canary of CANARIES) {
      assert.ok(!body.includes(canary), `payload leaks ${canary}`);
    }
    assert.ok(
      !body.includes(startedAt),
      "payload contains a timestamp from the current hour — it depends on the clock",
    );
  });
});
