/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone", // Standalone for server deployment
  typescript: {
    tsconfigPath: "tsconfig.nextjs.json",
  },
};

export default nextConfig;
