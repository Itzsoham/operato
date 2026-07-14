import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,

  // Dev-only overlay. It defaults to bottom-left, which is exactly where the sidebar's
  // account button lives — it sat on top of it and swallowed the clicks.
  devIndicators: {
    position: "bottom-right",
  },
};

export default nextConfig;
