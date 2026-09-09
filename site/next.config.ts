import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const LOCALES = "en|et|de|fr|es|it|pt|nl|sv|fi|lv|lt|pl|tr|ar|zh";

const nextConfig: NextConfig = {
  outputFileTracingRoot: process.cwd(),
  poweredByHeader: false,
  compress: true,
  async redirects() {
    // The first walkthrough shipped briefly under /demo; its permanent home is the portfolio.
    return [
      { source: "/demo/:slug", destination: "/portfolio/:slug", permanent: true },
      { source: `/:locale(${LOCALES})/demo/:slug`, destination: "/:locale/portfolio/:slug", permanent: true },
    ];
  },
  async headers() {
    // Portfolio media lives under a version segment (…/<slug>/t1/…); a regenerated set gets a new segment,
    // so every file there can be cached for a year and marked immutable.
    return [{ source: "/media/portfolio/:slug/:version/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] }];
  },
};

export default withNextIntl(nextConfig);
