import { readdir, readFile, writeFile, access, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distRoot = path.join(projectRoot, 'dist');
const deployRedirectPath = path.join(projectRoot, '.wrangler', 'deploy', 'config.json');

/**
 * Cloudflare rules for Worker *names* (Dashboard / wrangler `name`):
 *   only a-z, 0-9, hyphen; no underscore; not start/end with hyphen; max 63 chars.
 *
 * @cloudflare/vite-plugin maps Worker name → Vite environment name with:
 *   workerName.replaceAll("-", "_")  e.g. cloudflare-rules → cloudflare_rules
 * That underscore is ONLY an internal dist folder name unless you override
 * viteEnvironment.name (we set "worker" so output is dist/worker/).
 *
 * Never hardcode dist/cloudflare_rules as the deploy target name.
 */
async function pathExists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function fromDeployRedirect() {
  if (!(await pathExists(deployRedirectPath))) return null;
  try {
    const redirect = JSON.parse(await readFile(deployRedirectPath, 'utf8'));
    if (!redirect.configPath) return null;
    const resolved = path.resolve(path.dirname(deployRedirectPath), redirect.configPath);
    if (await pathExists(resolved)) return resolved;
  } catch {
    /* ignore */
  }
  return null;
}

async function findGeneratedWranglerJson() {
  const fromRedirect = await fromDeployRedirect();
  if (fromRedirect) return fromRedirect;

  const preferred = [
    path.join(distRoot, 'worker', 'wrangler.json'),
    path.join(distRoot, 'cloudflare-rules', 'wrangler.json'),
    path.join(distRoot, 'cloudflarerules', 'wrangler.json'),
  ];
  for (const file of preferred) {
    if (await pathExists(file)) return file;
  }

  // Scan remaining dist/* except client/server and known-stale underscore folders
  try {
    const entries = await readdir(distRoot, { withFileTypes: true });
    const skip = new Set(['client', 'server', 'cloudflare_rules']);
    for (const entry of entries) {
      if (!entry.isDirectory() || skip.has(entry.name)) continue;
      const file = path.join(distRoot, entry.name, 'wrangler.json');
      if (await pathExists(file)) return file;
    }
    // Last resort: legacy cloudflare_rules from older builds
    const legacy = path.join(distRoot, 'cloudflare_rules', 'wrangler.json');
    if (await pathExists(legacy)) return legacy;
  } catch (error) {
    throw new Error(
      `dist/ missing after vite build. Expected dist/worker or dist/client. ${error instanceof Error ? error.message : error}`,
    );
  }

  let listing = '(empty)';
  try {
    listing = (await readdir(distRoot)).join(', ') || '(empty)';
  } catch {
    /* ignore */
  }
  throw new Error(
    `Could not find wrangler.json under dist/. Contents: ${listing}. Worker name in wrangler.toml must use a-z, 0-9, hyphens only (not underscores).`,
  );
}

// Drop stale plugin output from older name→underscore mapping so deploy never picks it up.
async function removeStalePluginDirs() {
  const stale = path.join(distRoot, 'cloudflare_rules');
  try {
    await rm(stale, { recursive: true, force: true });
    console.log('Removed stale dist/cloudflare_rules (old vite env mapping).');
  } catch {
    /* ignore */
  }
}

await removeStalePluginDirs();
const deployConfigPath = await findGeneratedWranglerJson();
const config = JSON.parse(await readFile(deployConfigPath, 'utf8'));

// Ensure Worker name is always Cloudflare-legal even if something rewrites it.
if (typeof config.name === 'string' && config.name.includes('_')) {
  const fixed = config.name.replaceAll('_', '-');
  console.warn(`Rewrote illegal worker name "${config.name}" → "${fixed}"`);
  config.name = fixed;
  if (config.topLevelName) config.topLevelName = fixed;
}

// Cloudflare Vite plugin may not forward keep_vars from wrangler.toml.
config.keep_vars = true;

await writeFile(deployConfigPath, `${JSON.stringify(config, null, 2)}
`, 'utf8');
console.log(`Prepared Cloudflare deploy config: ${path.relative(projectRoot, deployConfigPath)} (name=${config.name}, keep_vars=true)`);
