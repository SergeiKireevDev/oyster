// Keep this dependency-free: install.sh checks the runtime before npm ci.
import { pathToFileURL } from 'node:url';

export const nodeFloors = ['22.23.5', '24.22.3', '26.13.1'];
export const supportedNodeRange = nodeFloors.map(version => `^${version}`).join(' || ');

export function supportsNode(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) return false;
  const [major, minor, patch] = version.split('.').map(Number);
  return nodeFloors.some(floor => {
    const [line, minMinor, minPatch] = floor.split('.').map(Number);
    return major === line && (minor > minMinor || (minor === minMinor && patch >= minPatch));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && !supportsNode(process.versions.node)) {
  console.error(`Oyster requires Node.js ${supportedNodeRange}; found ${process.version}`);
  process.exitCode = 1;
}
