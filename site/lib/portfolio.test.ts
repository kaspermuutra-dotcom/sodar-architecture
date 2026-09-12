import { existsSync } from "node:fs";
import { join } from "node:path";
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
    expect(project.indexable).toBe(true);
    expect(project.unlisted).toBeFalsy(); // listed with the hosted Matterport model
    expect(project.ogImage).toMatch(/^\/media\/portfolio\/kaldapealse-tanav-2\/e\d+\/og\.jpg$/);
    expect(project.embed).toEqual({ provider: "matterport", modelId: "98WLexoRstU" }); // the page shows the hosted Showcase model
    expect(project.walkthrough).toBeUndefined(); // the local reconstruction was removed on 2026-09-12
    for (const file of [project.image, project.ogImage, ...project.gallery.map((g) => g.still)]) expect(existsSync(join(__dirname, "..", "public", file)), file).toBe(true);
    expect(getPortfolioProject("nope")).toBeUndefined();
    expect(PORTFOLIO_WALKTHROUGHS).toHaveLength(1);
  });
});
