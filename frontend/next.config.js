const { PHASE_DEVELOPMENT_SERVER } = require("next/constants");

// Production: static export served by nginx, which also proxies /api to the backend.
// Dev: `next dev` proxies /api to the Go backend so the session cookie stays same-origin.
module.exports = (phase) =>
  phase === PHASE_DEVELOPMENT_SERVER
    ? {
        devIndicators: false,
        async rewrites() {
          const api = process.env.API_URL ?? "http://localhost:8080";
          return [{ source: "/api/:path*", destination: `${api}/api/:path*` }];
        },
      }
    : { output: "export", trailingSlash: true, images: { unoptimized: true } };
