import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['unpdf', 'pdfjs-dist'],
};

export default nextConfig;
