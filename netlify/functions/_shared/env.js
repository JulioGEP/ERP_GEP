function requireEnv(name) {
  const value = process.env[name];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`ENV_MISSING:${name}`);
  }
  return value;
}

module.exports = { requireEnv };
