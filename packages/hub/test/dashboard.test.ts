/** Dashboard route + contracts endpoint: the page is served and is a pure client of existing
 *  REST surfaces (zero private endpoints — CLI/dashboard parity).
 */
import { afterEach, describe, expect, it } from "vitest";
import { startHarness, type Harness } from "./harness.js";

let h: Harness;
afterEach(async () => {
  await h.cleanup();
});

describe("dashboard serving", () => {
  it("serves the dashboard HTML at / and /index.html", async () => {
    h = await startHarness();
    for (const path of ["/", "/index.html"]) {
      const res = await fetch(`${h.url}${path}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
      const body = await res.text();
      expect(body).toContain("<title>Duo</title>");
      expect(body).toContain("/api/updates"); // subscribes to the existing event stream
    }
  });

  it("exposes contracts over REST for the dashboard", async () => {
    h = await startHarness();
    await h.createSession("goal", {
      plan: false,
      presetBoard: [{ title: "A", ownerHint: "A" }, { title: "B", ownerHint: "B" }],
    });
    const a = await h.connectAgent("A");
    await a.register();
    await a.postContract("service: api\nPOST /x → { y }");

    const res = await fetch(`${h.url}/api/contracts`);
    const data = (await res.json()) as { contracts: Array<{ service: string }> };
    expect(data.contracts).toHaveLength(1);
    expect(data.contracts[0].service).toBe("api");
  });
});
