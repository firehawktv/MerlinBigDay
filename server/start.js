import path from 'node:path';
import { loadConfig, root } from './config.js';
import { buildApp } from './app.js';

// Optional .env next to package.json; real environment variables take precedence.
try { process.loadEnvFile(path.join(root, '.env')); } catch (e) { if (e.code !== 'ENOENT') console.warn('Could not read .env:', e.message); }

const config = loadConfig();
const app = buildApp(config, { logger: true });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => app.close().then(() => process.exit(0)));
app.listen({ port: config.port, host: config.host });
