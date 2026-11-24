// sqlite3's prebuild installer can succeed on an older glibc even when the
// downloaded binding cannot load (e.g. Debian 12). Use its supported source
// build only for that loader failure, and verify the replacement binding.
const { execFileSync } = require('node:child_process');
try {
  require('sqlite3');
} catch (error) {
  if (error.code !== 'ERR_DLOPEN_FAILED' || !/GLIBC_[\d.]+.*not found/.test(error.message)) throw error;
  console.warn('Rebuilding sqlite3 against the local glibc (requires Python, make and a C++ compiler).');
  execFileSync(process.execPath, [process.env.npm_execpath, 'rebuild', 'sqlite3'], {
    stdio: 'inherit', env: { ...process.env, npm_config_build_from_source: 'true' },
  });
  require('sqlite3');
}
