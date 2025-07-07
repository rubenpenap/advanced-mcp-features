import fs from 'node:fs/promises'
import path from 'node:path'
import { invariant } from '@epic-web/invariant'
import { faker } from '@faker-js/faker'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import {
	CreateMessageRequestSchema,
	type CreateMessageResult,
	ResourceUpdatedNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { test, expect } from 'vitest'
import { type z } from 'zod'

function getTestDbPath() {
	return `./test.ignored/db.${process.env.VITEST_WORKER_ID}.${Math.random().toString(36).slice(2)}.sqlite`
}

async function setupClient({ capabilities = {} } = {}) {
	const EPIC_ME_DB_PATH = getTestDbPath()
	const dir = path.dirname(EPIC_ME_DB_PATH)
	await fs.mkdir(dir, { recursive: true })
	const client = new Client(
		{
			name: 'EpicMeTester',
			version: '1.0.0',
		},
		{ capabilities },
	)
	const transport = new StdioClientTransport({
		command: 'tsx',
		args: ['src/index.ts'],
		stderr: 'ignore',
		env: {
			...process.env,
			EPIC_ME_DB_PATH,
		},
	})
	await client.connect(transport)
	return {
		client,
		EPIC_ME_DB_PATH,
		async [Symbol.asyncDispose]() {
			await client.transport?.close()
			await fs.unlink(EPIC_ME_DB_PATH).catch(() => {})
		},
	}
}

test('Tool Definition', async () => {
	await using setup = await setupClient()
	const { client } = setup
	const list = await client.listTools()
	const [firstTool] = list.tools
	invariant(firstTool, '🚨 No tools found')

	expect(firstTool).toEqual(
		expect.objectContaining({
			name: expect.stringMatching(/^create_entry$/i),
			description: expect.stringMatching(/^create a new journal entry$/i),
			inputSchema: expect.objectContaining({
				type: 'object',
				properties: expect.objectContaining({
					title: expect.objectContaining({
						type: 'string',
						description: expect.stringMatching(/title/i),
					}),
					content: expect.objectContaining({
						type: 'string',
						description: expect.stringMatching(/content/i),
					}),
				}),
			}),
		}),
	)
})

async function deferred<ResolvedValue>() {
	const ref = {} as {
		promise: Promise<ResolvedValue>
		resolve: (value: ResolvedValue) => void
		reject: (reason?: any) => void
		value: ResolvedValue | undefined
		reason: any | undefined
	}
	ref.promise = new Promise<ResolvedValue>((resolve, reject) => {
		ref.resolve = (value) => {
			ref.value = value
			resolve(value)
		}
		ref.reject = (reason) => {
			ref.reason = reason
			reject(reason)
		}
	})

	return ref
}

test('Sampling', async () => {
	await using setup = await setupClient({ capabilities: { sampling: {} } })
	const { client } = setup
	const messageResultDeferred = await deferred<CreateMessageResult>()
	const messageRequestDeferred =
		await deferred<z.infer<typeof CreateMessageRequestSchema>>()

	client.setRequestHandler(CreateMessageRequestSchema, (r) => {
		messageRequestDeferred.resolve(r)
		return messageResultDeferred.promise
	})

	const fakeTag1 = {
		name: faker.lorem.word(),
		description: faker.lorem.sentence(),
	}
	const fakeTag2 = {
		name: faker.lorem.word(),
		description: faker.lorem.sentence(),
	}

	const result = await client.callTool({
		name: 'create_tag',
		arguments: fakeTag1,
	})
	const newTag1 = (result.structuredContent as any).tag
	invariant(newTag1, '🚨 No tag1 resource found')
	invariant(newTag1.id, '🚨 No new tag1 found')

	const entry = {
		title: faker.lorem.words(3),
		content: faker.lorem.paragraphs(2),
	}
	await client.callTool({
		name: 'create_entry',
		arguments: entry,
	})
	const request = await messageRequestDeferred.promise

	try {
		expect(request).toEqual(
			expect.objectContaining({
				method: 'sampling/createMessage',
				params: expect.objectContaining({
					maxTokens: expect.any(Number),
					systemPrompt: expect.stringMatching(/example/i),
					messages: expect.arrayContaining([
						expect.objectContaining({
							role: 'user',
							content: expect.objectContaining({
								type: 'text',
								text: expect.stringMatching(/entry/i),
								mimeType: 'application/json',
							}),
						}),
					]),
				}),
			}),
		)

		// 🚨 Proactive checks for advanced sampling requirements
		const params = request.params
		invariant(
			params && 'maxTokens' in params,
			'🚨 maxTokens parameter is required',
		)
		invariant(
			params.maxTokens > 50,
			'🚨 maxTokens should be increased for longer responses (>50)',
		)

		invariant(params && 'systemPrompt' in params, '🚨 systemPrompt is required')
		invariant(
			typeof params.systemPrompt === 'string',
			'🚨 systemPrompt must be a string',
		)

		invariant(
			params && 'messages' in params && Array.isArray(params.messages),
			'🚨 messages array is required',
		)
		const userMessage = params.messages.find((m) => m.role === 'user')
		invariant(userMessage, '🚨 User message is required')
		invariant(
			userMessage.content.mimeType === 'application/json',
			'🚨 Content should be JSON for structured data',
		)

		// 🚨 Validate the JSON structure contains required fields
		invariant(
			typeof userMessage.content.text === 'string',
			'🚨 User message content text must be a string',
		)
		let messageData: any
		try {
			messageData = JSON.parse(userMessage.content.text)
		} catch (error) {
			throw new Error('🚨 User message content must be valid JSON')
		}

		invariant(messageData.entry, '🚨 JSON should contain entry data')
		invariant(
			messageData.existingTags,
			'🚨 JSON should contain existingTags for context',
		)
		invariant(
			Array.isArray(messageData.existingTags),
			'🚨 existingTags should be an array',
		)
	} catch (error) {
		console.error('🚨 Advanced sampling features not properly implemented!')
		console.error(
			'🚨 This exercise requires you to send a structured sampling request to the LLM with the new entry, its current tags, and all existing tags, as JSON (application/json).',
		)
		console.error('🚨 You need to:')
		console.error(
			'🚨   1. Increase maxTokens to a reasonable value (e.g., 100+) for longer responses.',
		)
		console.error(
			'🚨   2. Create a meaningful systemPrompt that includes examples of the expected output format (array of tag objects, with examples for existing and new tags).',
		)
		console.error(
			'🚨   3. Structure the user message as JSON with mimeType: "application/json".',
		)
		console.error(
			'🚨   4. Include both entry data AND existingTags context in the JSON (e.g., { entry: {...}, existingTags: [...] }).',
		)
		console.error(
			'🚨   5. Test your prompt in an LLM playground and refine as needed.',
		)
		console.error(
			'🚨 EXAMPLE: systemPrompt should include examples of expected tag suggestions.',
		)
		console.error(
			'🚨 EXAMPLE: user message should be structured JSON, not plain text.',
		)

		const params = request.params
		if (params) {
			console.error(`🚨 Current maxTokens: ${params.maxTokens} (should be >50)`)
			console.error(
				`🚨 Current mimeType: ${params.messages?.[0]?.content?.mimeType} (should be "application/json")`,
			)
			console.error(
				`🚨 SystemPrompt contains "example": ${typeof params.systemPrompt === 'string' && params.systemPrompt.toLowerCase().includes('example')}`,
			)
		}

		throw new Error(
			`🚨 Advanced sampling not configured properly - need structured JSON messages, higher maxTokens, and example-rich system prompt. ${error}`,
		)
	}

	messageResultDeferred.resolve({
		model: 'stub-model',
		stopReason: 'endTurn',
		role: 'assistant',
		content: {
			type: 'text',
			text: JSON.stringify([{ id: newTag1.id }, fakeTag2]),
		},
	})

	// give the server a chance to process the result
	await new Promise((resolve) => setTimeout(resolve, 100))
})

test('Resource subscriptions: entry and tag', async () => {
	await using setup = await setupClient()
	const { client } = setup

	const tagNotification = await deferred<any>()
	const entryNotification = await deferred<any>()
	const notifications: any[] = []
	let tagUri: string, entryUri: string
	const handler = (notification: any) => {
		notifications.push(notification)
		if (notification.params.uri === tagUri) {
			tagNotification.resolve(notification)
		}
		if (notification.params.uri === entryUri) {
			entryNotification.resolve(notification)
		}
	}
	client.setNotificationHandler(ResourceUpdatedNotificationSchema, handler)

	// Create a tag and entry to get their URIs
	const tagResult = await client.callTool({
		name: 'create_tag',
		arguments: {
			name: faker.lorem.word(),
			description: faker.lorem.sentence(),
		},
	})
	const tag = (tagResult.structuredContent as any).tag
	tagUri = `epicme://tags/${tag.id}`

	const entryResult = await client.callTool({
		name: 'create_entry',
		arguments: {
			title: faker.lorem.words(3),
			content: faker.lorem.paragraphs(2),
		},
	})
	const entry = (entryResult.structuredContent as any).entry
	entryUri = `epicme://entries/${entry.id}`

	// Subscribe to both resources
	await client.subscribeResource({ uri: tagUri })
	await client.subscribeResource({ uri: entryUri })

	// Trigger updates
	const updateTagResult = await client.callTool({
		name: 'update_tag',
		arguments: { id: tag.id, name: tag.name + '-updated' },
	})
	invariant(
		updateTagResult.structuredContent,
		`🚨 Tag update failed: ${JSON.stringify(updateTagResult)}`,
	)

	const updateEntryResult = await client.callTool({
		name: 'update_entry',
		arguments: { id: entry.id, title: entry.title + ' updated' },
	})
	invariant(
		updateEntryResult.structuredContent,
		`🚨 Entry update failed: ${JSON.stringify(updateEntryResult)}`,
	)

	// Wait for notifications to be received (deferred)
	const [tagNotif, entryNotif] = await Promise.all([
		tagNotification.promise,
		entryNotification.promise,
	])

	expect(tagNotif.params.uri).toBe(tagUri)
	expect(entryNotif.params.uri).toBe(entryUri)

	// Unsubscribe and trigger another update
	notifications.length = 0
	await client.unsubscribeResource({ uri: tagUri })
	await client.unsubscribeResource({ uri: entryUri })
	await client.callTool({
		name: 'update_tag',
		arguments: { id: tag.id, name: tag.name + '-again' },
	})
	await client.callTool({
		name: 'update_entry',
		arguments: { id: entry.id, title: entry.title + ' again' },
	})
	// Wait a short time to ensure no notifications are received
	await new Promise((r) => setTimeout(r, 200))
	expect(notifications).toHaveLength(0)
})
