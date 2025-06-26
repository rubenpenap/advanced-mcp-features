import { createServer } from 'http'
import { execa } from 'execa'
import { getPort } from 'get-port'
import { createProxyServer } from 'http-proxy'

const [, , ...args] = process.argv
const [transport] = args

const serverPort = await getPort({ port: 10000, exclude: [process.env.PORT] })
const clientPort = await getPort({
	port: 9000,
	exclude: [process.env.PORT, serverPort],
})

// Spawn mcp-inspector as a sidecar process
const inspectorProcess = execa('mcp-inspector', [], {
	env: {
		...process.env,
		SERVER_PORT: serverPort,
		CLIENT_PORT: clientPort,
	},
	stdio: 'inherit',
})

const proxy = createProxyServer({
	target: `http://localhost:${clientPort}`,
	ws: true,
	changeOrigin: true,
})

const server = createServer((req, res) => {
	if (req.url === '/' || req.url.startsWith('/?')) {
		// Parse the original URL and add the searchParams
		const transport = 'stdio'
		const command = 'npm'
		const args = `--silent --prefix ${process.cwd()} run dev:mcp`
		const url = new URL(req.url, `http://localhost:${clientPort}`)
		url.searchParams.set('transport', transport)
		url.searchParams.set('serverCommand', command)
		url.searchParams.set('serverArgs', args)

		// Rewrite the request URL for the proxy
		req.url = url.pathname + url.search
	}
	proxy.web(req, res, {}, (err) => {
		res.writeHead(502, { 'Content-Type': 'text/plain' })
		res.end('Proxy error: ' + err.message)
	})
})

server.on('upgrade', (req, socket, head) => {
	proxy.ws(req, socket, head)
})

server.listen(process.env.PORT, () => {
	console.log(`Redirect server running on port ${process.env.PORT}`)
})

// Ensure proper cleanup
function cleanup() {
	if (inspectorProcess && !inspectorProcess.killed) {
		inspectorProcess.kill()
	}
	server.close(() => {
		console.log('HTTP server closed')
	})
}

process.on('exit', cleanup)
process.on('SIGINT', () => {
	cleanup()
	process.exit(0)
})
process.on('SIGTERM', () => {
	cleanup()
	process.exit(0)
})
