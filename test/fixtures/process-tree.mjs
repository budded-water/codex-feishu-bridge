import { spawn } from 'node:child_process';
if (process.argv[2] === 'root') {
  const child = spawn(process.execPath, [import.meta.filename, 'leaf'], { stdio: 'ignore' });
  console.log(JSON.stringify({ child: child.pid }));
}
setInterval(() => {}, 1000);
