/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // HTML ของ Admin/Employee ถูกอ่านจากดิสก์ตอน runtime
    // -> ต้องบอก Next ให้รวมโฟลเดอร์ generated/ ไปกับ serverless function ด้วย
    outputFileTracingIncludes: {
      '/admin': ['./generated/**'],
      '/employee': ['./generated/**'],
      '/login': ['./generated/**'],
      '/set-password': ['./generated/**'],
    },
  },
};

export default nextConfig;
