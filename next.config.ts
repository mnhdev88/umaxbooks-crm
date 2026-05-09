import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['unpdf', 'pdfjs-dist'],
  images: {
    domains: ['noveliotech.com'],
  },
};

export default nextConfig;
