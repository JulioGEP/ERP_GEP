// netlify/functions/_shared/env.js
function requireEnv(name) {
  const v = process.env[name];
  if (!v || String(v).trim() === '') {
    const err = new Error(`ENV_MISSING:${name}`);
    err.code = 'ENV_MISSING';
    throw err;
  }
  return v;
}

module.exports = { requireEnv };
