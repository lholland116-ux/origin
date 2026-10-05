import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdf-parse", "@napi-rs/canvas"],

  async redirects() {
    return [
      {
        source: "/:path*",
        has: [
          {
            type: "host",
            value: "www.lvtchat.com",
          },
        ],
        destination: "https://lvtchat.com/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
