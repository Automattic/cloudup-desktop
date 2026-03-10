export interface EnvironmentConfig {
  webAppUrl: string;
  apiUrl: string;
  allowInsecure: boolean;
  trustedDomains: string[];
  maxFileSize: number; // Maximum file size in bytes
}

const ENVIRONMENTS: Record<string, EnvironmentConfig> = {
	development: {
		webAppUrl: 'https://cloudup.test',
		apiUrl: 'https://api.cloudup.test',
		allowInsecure: true,
		trustedDomains: [
			'cloudup.test',
			'.cloudup.test',
			'cldup.test',
			'.cldup.test',
			'minio.test',
			'.minio.test',
		],
		maxFileSize: 100 * 1024 * 1024, // 100MB
	},
	staging: {
		webAppUrl: 'https://stage-cloudup.com',
		apiUrl: 'https://api.stage-cloudup.com',
		allowInsecure: false,
		trustedDomains: [],
		maxFileSize: 100 * 1024 * 1024, // 100MB
	},
	production: {
		webAppUrl: 'https://cloudup.com',
		apiUrl: 'https://api.cloudup.com',
		allowInsecure: false,
		trustedDomains: [],
		maxFileSize: 100 * 1024 * 1024, // 100MB
	},
};

export type Environment = 'development' | 'staging' | 'production';

function resolveEnv(): Environment {
	if (typeof __dirname !== 'undefined') {
		try {
			const path = require('path');
			const fs = require('fs');
			const buildEnvPath = path.join(__dirname, 'build-env.json');
			if (fs.existsSync(buildEnvPath)) {
				const data = JSON.parse(fs.readFileSync(buildEnvPath, 'utf8'));
				if (data.env && ENVIRONMENTS[data.env as Environment]) {
					return data.env as Environment;
				}
			}
		} catch {
			// ignore
		}
	}
	return (process.env.CLOUDUP_ENV as Environment) || 'production';
}

export const ENV: Environment = resolveEnv();
export const CONFIG: EnvironmentConfig = ENVIRONMENTS[ENV];

/**
 * Returns true if hostname matches any entry in CONFIG.trustedDomains.
 * Used for certificate verification and S3 requests in development.
 */
export function isTrustedDomain(hostname: string): boolean {
	return CONFIG.trustedDomains.some((domain) => {
		if (domain.startsWith('.')) {
			return hostname.endsWith(domain) || hostname === domain.slice(1);
		}
		return hostname === domain || hostname.endsWith(`.${domain}`);
	});
}

/**
 * Returns true if the URL is the app origin (e.g. https://cloudup.test).
 * For "should we run auth logic?" use isAppReadyForAuth from main/offline-state
 * so the offline fallback page is excluded via explicit state.
 */
export function isAppUrl(url: string): boolean {
	try {
		const targetUrl = new URL(url);
		if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
			return false;
		}
		const appUrl = new URL(CONFIG.webAppUrl);
		return targetUrl.origin === appUrl.origin;
	} catch {
		return false;
	}
}
