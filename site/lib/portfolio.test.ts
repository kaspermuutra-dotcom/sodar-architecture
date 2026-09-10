import { describe, expect, it } from "vitest";
import { PORTFOLIO, PORTFOLIO_WALKTHROUGHS, getPortfolioProject } from "./portfolio";

describe("portfolio registry", () => {
  it("keeps the first client scan first by explicit order, ahead of the sample tiles", () => {
    expect(PORTFOLIO[0].kind).toBe("walkthrough");
    expect(PORTFOLIO[0]).toMatchObject({ slug: "kaldapealse-tanav-2", distinction: "first-client", client: "Ruslan Gulida · RE/MAX" });
    expect(PORTFOLIO.map((i) => i.order)).toEqual([...PORTFOLIO.map((i) => i.order)].sort((a, b) => a - b));
    expect(PORTFOLIO.filter((i) => i.kind === "sample")).toHaveLength(4);
  });

  it("resolves project pages by slug and exposes public metadata inputs", () => {
    const project = getPortfolioProject("kaldapealse-tanav-2")!;
    expect(project.walkthrough.indexable).toBe(true);
    expect(project.walkthrough.ogImage).toMatch(/^\/media\/portfolio\/kaldapealse-tanav-2\/t\d+\/og\.jpg$/);
    expect(project.walkthrough.startNodeId).toBe("f761f98a");
    expect(getPortfolioProject("nope")).toBeUndefined();
    expect(PORTFOLIO_WALKTHROUGHS).toHaveLength(1);
  });
});
