import { cp, mkdir, readdir, rm } from 'node:fs/promises';

const skipped = new Set(['dist', 'node_modules', 'critique', '.git']);

await rm('dist', { recursive: true, force: true });
await mkdir('dist');
for (const entry of await readdir('.', { withFileTypes: true })) {
  if (skipped.has(entry.name) || entry.name.startsWith('iter-')) continue;
  if (/\.bak(?:-|$)/i.test(entry.name) || entry.name === 'run.json') continue;
  await cp(entry.name, `dist/${entry.name}`, { recursive: true });
}
console.log('Built static Screenhouse project snapshot.');
