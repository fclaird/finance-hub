import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    // Prevent Turbopack from walking up to ~ and selecting the wrong lockfile.
    root: __dirname,
  },
};

export default nextConfig;
