import { resolve } from 'node:path';

// Prints a local service definition; does not install or activate anything.
const escape = value => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]);
const root = process.cwd();
const args = [process.execPath, `--env-file=${resolve('.env')}`, resolve('dist/index.js')];
console.log(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>dev.codex-feishu-bridge</string>
  <key>ProgramArguments</key><array>${args.map(arg => `<string>${escape(arg)}</string>`).join('')}</array>
  <key>WorkingDirectory</key><string>${escape(root)}</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${escape(process.env.PATH || '/usr/local/bin:/usr/bin:/bin')}</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>${escape(resolve('.local/service.log'))}</string>
  <key>StandardErrorPath</key><string>${escape(resolve('.local/service-error.log'))}</string>
</dict></plist>`);
