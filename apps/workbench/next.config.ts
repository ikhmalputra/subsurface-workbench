import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  transpilePackages: ["@ikhmalputra/subsurface-react", "@ikhmalputra/subsurface-shell"],
};

export default nextConfig;
