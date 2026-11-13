import { describe, expect, it } from "vitest";
import { publicAddress } from "./address";

const ok = (raw: string) => {
  const verdict = publicAddress(raw);
  if (!verdict.ok) throw new Error(`${raw} was refused: ${verdict.reason}`);
  return verdict;
};

describe("addresses the server may read", () => {
  it("takes an address the way people type it", () => {
    expect(ok("staging.example.com").url).toBe("https://staging.example.com/");
    expect(ok("  https://app.example.com/dashboard?tab=2#section  ")).toMatchObject({
      url: "https://app.example.com/dashboard?tab=2",
      origin: "https://app.example.com",
      host: "app.example.com",
      path: "/dashboard?tab=2",
    });
    expect(ok("HTTPS://Example.COM/Pricing").url).toBe("https://example.com/Pricing");
    expect(ok("https://example.com:8443/x").host).toBe("example.com:8443");
  });

  it("upgrades plain http instead of refusing it", () => {
    expect(ok("http://example.com/a").url).toBe("https://example.com/a");
    expect(ok("http://example.com:80/a").url).toBe("https://example.com/a");
  });

  it("refuses anything that is not on the public internet, and says where to take it", () => {
    for (const raw of [
      "http://localhost:3000",
      "localhost:5173/app",
      "https://my-laptop/app",
      "https://app.internal/",
      "https://printer.local",
      "https://staging.lan/x",
      "https://dev.localhost/",
      "http://127.0.0.1:8080",
      "https://10.0.0.5/admin",
      "https://192.168.1.10",
      "http://169.254.169.254/latest/meta-data/",
      "https://[::1]/",
      "https://[fd00::1]/",
      // Other spellings of 127.0.0.1: the URL parser turns them all into the dotted form.
      "http://2130706433/",
      "http://0x7f.1/",
      "http://017700000001/",
    ]) {
      const verdict = publicAddress(raw);
      expect(verdict.ok, raw).toBe(false);
      if (!verdict.ok) expect(verdict.reason, raw).toMatch(/Mac app/);
    }
  });

  it("refuses what is not a web address at all", () => {
    for (const raw of ["", "   ", "file:///etc/passwd", "javascript:alert(1)", "ftp://example.com/x", "https://user:pw@example.com/", "https://"]) {
      expect(publicAddress(raw).ok, JSON.stringify(raw)).toBe(false);
    }
  });

  it("writes every refusal as a sentence, in house style", () => {
    for (const raw of ["", "nonsense://", "ftp://example.com", "https://user:pw@example.com/", "localhost"]) {
      const verdict = publicAddress(raw);
      if (verdict.ok) throw new Error(`${raw} was accepted`);
      expect(verdict.reason).toMatch(/^[A-Z].*\.$/);
      expect(verdict.reason).not.toContain("—");
    }
  });
});
