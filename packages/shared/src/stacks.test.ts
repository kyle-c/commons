import { describe, expect, it } from "vitest";
import { detectStack, devCommandFor, stackById, stackLabel, STACKS } from "./stacks";

describe("stack table", () => {
  it("recognizes each stack from its package.json dependencies", () => {
    expect(detectStack({ next: "15.0.0", react: "19" })?.id).toBe("nextjs");
    expect(detectStack({ expo: "~52", "expo-router": "~4" })?.id).toBe("expo");
    expect(detectStack({ "react-native": "0.76" })?.id).toBe("expo");
    expect(detectStack({ vite: "^6", react: "19" })?.id).toBe("vite");
    expect(detectStack({ express: "4" })).toBeNull();
  });

  it("answers the same way everywhere when a package lists more than one stack", () => {
    // Storybook for React Native brings vite into Expo apps; the app is still Expo.
    expect(detectStack({ expo: "~52", vite: "^6" })?.id).toBe("expo");
    expect(detectStack({ next: "15", vite: "^6" })?.id).toBe("nextjs");
  });

  it("adopts web apps before mobile ones, and only web-capable Expo apps", () => {
    const rank = (id: string) => stackById(id)!.adoptRank;
    expect(rank("nextjs")).toBeLessThan(rank("vite"));
    expect(rank("vite")).toBeLessThan(rank("expo"));
    expect(stackById("expo")!.adoptWhen).toEqual(["expo-router", "react-native-web"]);
  });

  it("fills the port into each dev command", () => {
    expect(devCommandFor(stackById("nextjs")!, 4310)).toEqual(["next", "dev", "-p", "4310"]);
    expect(devCommandFor(stackById("expo")!, 4311)).toEqual(["expo", "start", "--web", "--port", "4311"]);
    expect(devCommandFor(stackById("vite")!, 4312)).toEqual(["vite", "--port", "4312", "--strictPort"]);
  });

  it("names stacks the way people do, and everything else is code", () => {
    expect(STACKS.map((s) => stackLabel(s.id))).toEqual(["Next.js", "Expo", "Vite"]);
    expect(stackLabel("custom")).toBe("Code");
    expect(stackLabel(undefined)).toBe("Code");
  });

  it("gives phones phone-sized frames", () => {
    expect(STACKS.filter((s) => s.form === "phone").map((s) => s.id)).toEqual(["expo"]);
  });
});
