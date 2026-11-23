/** Accepts stable or prerelease SemVer, optionally prefixed with v; excludes build metadata for Docker tags. */
const releaseVersion = function (input) {
  const version = input?.replace(/^v/, '');
  if (!version || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(version) || version.length > 127) {
    throw new Error('Use a version such as 1.2.3 or 1.2.3-rc.1, without build metadata');
  }
  const prerelease = version.includes('-');
  if (
    prerelease &&
    version
      .slice(version.indexOf('-') + 1)
      .split('.')
      .some((part) => /^0\d+$/.test(part))
  ) {
    throw new Error('Numeric prerelease identifiers must not have leading zeros');
  }
  return { version, tag: `v${version}`, prerelease };
};

export { releaseVersion };
