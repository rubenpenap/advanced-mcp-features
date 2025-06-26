import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { execa } from 'execa'

const seedPath = join(
	process.env.EPICSHOP_PLAYGROUND_DEST_DIR,
	'src',
	'db',
	'seed.ts',
)

if (existsSync(seedPath)) {
	console.log('Running seed script...')
	try {
		await execa('npx', ['tsx', seedPath], {
			cwd: process.env.EPICSHOP_PLAYGROUND_DEST_DIR,
			stdio: 'inherit',
		})
		console.log('Seed script completed successfully')
	} catch (error) {
		console.error('Failed to run seed script:', error)
	}
}
