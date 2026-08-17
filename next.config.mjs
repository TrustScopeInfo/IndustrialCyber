/** @type {import('next').NextConfig} */
const nextConfig = {
  // Demo HTML is streamed from a private bucket by a route handler, never
  // served as a static asset. Nothing in public/ is ever protected.
  poweredByHeader: false,
}

export default nextConfig
