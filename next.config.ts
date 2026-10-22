import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Task 81: cache static game assets at the transport layer too. The
  // IndexedDB layer (src/game/preloader.ts) is the primary cache; these
  // headers make the remaining first-fetches revalidation-free for a day so
  // a second client (or a cleared IDB) still skips re-downloading ~30 MB.
  // Deliberately NOT immutable: asset re-skins propagate within 24 h.
  async headers() {
    return [
      { source: "/assets/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=86400" }] },
      { source: "/staging/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=86400" }] },
      { source: "/draco/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=86400" }] },
    ];
  },
};

export default nextConfig;
