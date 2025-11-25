^C
C:\Code\marviano-pos>npm run electron-dev

> marviano-pos@0.1.0 electron-dev
> cross-env PORT=3000 concurrently "cross-env PORT=3000 npm run dev" "wait-on http://localhost:3000 && electron ."

[0] 
[0] > marviano-pos@0.1.0 dev
[0] > next dev
[0]
[0]    ▲ Next.js 15.5.4
[0]    - Local:        http://localhost:3000
[0]    - Network:      http://172.16.0.2:3000
[0]    - Environments: .env
[0]
[0]  ✓ Starting...
[0]  ✓ Ready in 2.3s
[0]  ○ Compiling / ...
[0]  ✓ Compiled / in 1187ms (821 modules)
[0] 🚀 [SMART SYNC] Service initialized
[0] 🚀 [OFFLINE SYNC] Service initializing...
[0]  HEAD / 200 in 1920ms
[0]  HEAD / 200 in 1934ms
[0]  HEAD / 200 in 1949ms
[0]  HEAD / 200 in 1964ms
[0]  HEAD / 200 in 1977ms
[0]  HEAD / 200 in 1996ms
[0]  HEAD / 200 in 2013ms
[0]  HEAD / 200 in 2047ms
[0]  HEAD / 200 in 1768ms
[0]  HEAD / 200 in 1554ms
[0]  HEAD / 200 in 1360ms
[0]  HEAD / 200 in 1108ms
[0]  HEAD / 200 in 2174ms
[1] 
[1] ❌ Failed to initialize SQLite: SqliteError: near "/": syntax error
[1]     at Database.exec (C:\Code\marviano-pos\node_modules\better-sqlite3\lib\methods\wrappers.js:9:14)
[1]     at createWindows (C:\Code\marviano-pos\dist\electron\main.js:207:17)
[1]     at C:\Code\marviano-pos\dist\electron\main.js:3482:5 {
[1]   code: 'SQLITE_ERROR'
[1] }
[1] (node:18372) UnhandledPromiseRejectionWarning: Error: Attempted to register a second handler for 'localdb-get-shifts'
[1]     at IpcMainImpl.handle (node:electron/js2c/browser_init:2:109431)
[1]     at createWindows (C:\Code\marviano-pos\dist\electron\main.js:2410:24)
[1]     at C:\Code\marviano-pos\dist\electron\main.js:3482:5
[1] (Use `electron --trace-warnings ...` to show where the warning was created)
[1] (node:18372) UnhandledPromiseRejectionWarning: Unhandled promise rejection. This error originated either by throwing inside of an async function without a catch block, or by rejecting a promise which was not handled with .catch(). To terminate the node process on unhandled promise rejection, use the CLI flag `--unhandled-rejections=strict` (see https://nodejs.org/api/cli.html#cli_unhandled_rejections_mode). (rejection id: 1)
[0]  ✓ Compiled in 4.9s (366 modules)
[0]  ✓ Compiled in 370ms (366 modules)
[0]  ✓ Compiled /customer-display in 471ms (832 modules)
[0]  GET /customer-display 200 in 843ms

