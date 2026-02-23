/** @type {import('next').NextConfig} */
const nextConfig = {
	env: {
		// Empty string → browser uses relative URLs (/trpc), which flow through
		// Next.js rewrites to the agent. Set NEXT_PUBLIC_API_URL explicitly to
		// point directly at the agent if you want to bypass the proxy.
		NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? '',
	},
	async rewrites() {
		const backend = process.env.BACKEND_URL ?? 'http://localhost:3000';
		return [
			{
				source: '/api/:path*',
				destination: `${backend}/api/:path*`,
			},
			{
				source: '/trpc/:path*',
				destination: `${backend}/trpc/:path*`,
			},
		];
	},
};

export default nextConfig;
