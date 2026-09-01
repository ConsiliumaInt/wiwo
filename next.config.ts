import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  serverExternalPackages: ["@solarisdk/browser", "@solarisdk/sdk"],
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || "",
  assetPrefix: process.env.NEXT_PUBLIC_BASE_PATH || "",
  turbopack: { root: process.cwd() },
}

export default nextConfig
