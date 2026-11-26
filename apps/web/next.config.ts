import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  // Workspace package shipped as TypeScript source.
  transpilePackages: ["@compi/api-client", "@compi/shared"],
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      // Tailwind runs on global stylesheets only: CSS Modules must stay modules
      // (a matching rule with `as: "*.css"` would turn them into global CSS).
      "*.css": {
        condition: { not: { path: /\.module\.css$/ } },
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

export default withNextIntl(nextConfig);
