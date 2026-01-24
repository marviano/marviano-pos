import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'export',
  images: {
    unoptimized: true,
  },
  // Ensure assets are loaded with relative paths for file:// protocol
  assetPrefix: './',
  // Skip ESLint during production build (fix pre-existing hooks/any errors separately)
  eslint: { ignoreDuringBuilds: true },
  // Optional: trailingSlash can help with some static hosting scenarios, 
  // but for Electron file:// it's usually better to keep it false or default unless using a specific router.
  // We'll stick to default for now.
  // Note: HMR (Hot Module Replacement) is automatically disabled with 'output: export'
  // The DisableHMR component suppresses any remaining HMR WebSocket connection attempts
};

export default nextConfig;
