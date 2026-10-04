// Starts the desktop app from the project folder.
//   node scripts/desktop.mjs          → built interface (dist/)
//   node scripts/desktop.mjs --dev    → interface from the Vite dev server (run `npm run dev` first)
import { spawn } from 'node:child_process'
import electron from 'electron'

const env = { ...process.env }
// Some editors set this for their own helper processes; with it Electron would start as plain Node and open no window.
delete env.ELECTRON_RUN_AS_NODE
const args = process.argv.slice(2)
if (args.includes('--dev')) env.AICOM_DEV_URL ??= 'http://127.0.0.1:5173/'

const child = spawn(electron, ['.', ...args.filter((arg) => arg !== '--dev')], { stdio: 'inherit', env })
child.on('exit', (code) => process.exit(code ?? 0))
