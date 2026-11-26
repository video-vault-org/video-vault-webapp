import { readdir, readFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

/** A regression guard against executable user-content sinks; this complements, rather than replaces, review and CSP. */
const checkSource = async function (root = resolve('frontend/src')) {
  const violations = [];
  const visit = async function (directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === 'tests') continue;
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (/\.[cm]?[jt]sx?$/.test(entry.name)) {
        const source = await readFile(path, { encoding: 'utf8' });
        if (/dangerouslySetInnerHTML|\b(?:innerHTML|outerHTML)\s*=|\binsertAdjacentHTML\s*\(|\bdocument\.write(?:ln)?\s*\(|\beval\s*\(|\bnew\s+Function\s*\(|\b(?:setTimeout|setInterval)\s*\(\s*['"`]/.test(source))
          violations.push(relative(root, path));
      }
    }
  };

  await visit(root);
  if (violations.length) throw new Error(`Review unsafe executable HTML/JS sinks: ${violations.join(', ')}`);
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await checkSource();
  console.log('Frontend executable-content sink check passed.');
}

export { checkSource };
