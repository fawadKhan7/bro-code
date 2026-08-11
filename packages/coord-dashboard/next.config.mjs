/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // A fully static export: every byte of this dashboard is client-side, fed by the
  // coordination socket, so there is nothing for a Next.js server to do. The export
  // is staged into coord-server/dashboard and served from the coordination server —
  // one process, and nothing for the second machine to install.
  output: "export",
  // file:// is never used (always served over http), so default absolute asset paths
  // are correct — but trailing slashes keep express.static's directory lookup happy.
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
