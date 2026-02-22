/** @type {import('next').NextConfig} */
const nextConfig = {
	// Backend API URL — the browser always hits localhost:3001 in dev and Docker
	env: {
		NEXT_PUBLIC_API_URL:
			process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001',
	},
};

export default nextConfig;
