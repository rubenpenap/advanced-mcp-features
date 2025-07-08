import { spawn } from 'node:child_process'
import * as fs from 'node:fs/promises'
import { userInfo } from 'node:os'
import { invariant } from '@epic-web/invariant'
import { type CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import {
	createEntryInputSchema,
	createTagInputSchema,
	entryIdSchema,
	entryTagIdSchema,
	entryTagSchema,
	entryWithTagsSchema,
	tagIdSchema,
	tagSchema,
	updateEntryInputSchema,
	updateTagInputSchema,
} from './db/schema.ts'
import { type EpicMeMCP } from './index.ts'
import { suggestTagsSampling } from './sampling.ts'

export async function initializeTools(agent: EpicMeMCP) {
	agent.server.registerTool(
		'create_entry',
		{
			title: 'Create Entry',
			description: 'Create a new journal entry',
			annotations: {
				destructiveHint: false,
				openWorldHint: false,
			},
			inputSchema: createEntryInputSchema,
			outputSchema: { entry: entryWithTagsSchema },
		},
		async (entry) => {
			const createdEntry = await agent.db.createEntry(entry)
			if (entry.tags) {
				for (const tagId of entry.tags) {
					await agent.db.addTagToEntry({
						entryId: createdEntry.id,
						tagId,
					})
				}
			}

			void suggestTagsSampling(agent, createdEntry.id)

			return {
				structuredContent: { entry: createdEntry },
				content: [
					createTextContent(
						`Entry "${createdEntry.title}" created successfully with ID "${createdEntry.id}"`,
					),
					createEntryResourceLink(createdEntry),
				],
			}
		},
	)

	agent.server.registerTool(
		'get_entry',
		{
			title: 'Get Entry',
			description: 'Get a journal entry by ID',
			annotations: {
				readOnlyHint: true,
				openWorldHint: false,
			},
			inputSchema: entryIdSchema,
			outputSchema: { entry: entryWithTagsSchema },
		},
		async ({ id }) => {
			const entry = await agent.db.getEntry(id)
			invariant(entry, `Entry with ID "${id}" not found`)
			return {
				structuredContent: { entry },
				content: [
					createTextContent(JSON.stringify(entry, null, 2)),
					createEntryResourceContent(entry),
				],
			}
		},
	)

	agent.server.registerTool(
		'list_entries',
		{
			title: 'List Entries',
			description: 'List all journal entries',
			annotations: {
				readOnlyHint: true,
				openWorldHint: false,
			},
		},
		async () => {
			const entries = await agent.db.getEntries()
			const entryLinks = entries.map(createEntryResourceLink)
			return {
				content: [
					createTextContent(`Found ${entries.length} entries.`),
					...entryLinks,
				],
			}
		},
	)

	agent.server.registerTool(
		'update_entry',
		{
			title: 'Update Entry',
			description:
				'Update a journal entry. Fields that are not provided (or set to undefined) will not be updated. Fields that are set to null or any other value will be updated.',
			annotations: {
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false,
			},
			inputSchema: updateEntryInputSchema,
			outputSchema: { entry: entryWithTagsSchema },
		},
		async ({ id, ...updates }) => {
			const existingEntry = await agent.db.getEntry(id)
			invariant(existingEntry, `Entry with ID "${id}" not found`)
			const updatedEntry = await agent.db.updateEntry(id, updates)
			return {
				structuredContent: { entry: updatedEntry },
				content: [
					createTextContent(
						`Entry "${updatedEntry.title}" (ID: ${id}) updated successfully`,
					),
					createEntryResourceLink(updatedEntry),
				],
			}
		},
	)

	agent.server.registerTool(
		'delete_entry',
		{
			title: 'Delete Entry',
			description: 'Delete a journal entry',
			annotations: {
				idempotentHint: true,
				openWorldHint: false,
			},
			inputSchema: entryIdSchema,
			outputSchema: {
				success: z.boolean(),
				message: z.string(),
				entry: entryWithTagsSchema.optional(),
			},
		},
		async ({ id }) => {
			const existingEntry = await agent.db.getEntry(id)
			invariant(existingEntry, `Entry with ID "${id}" not found`)
			const confirmed = await elicitConfirmation(
				agent,
				`Are you sure you want to delete entry "${existingEntry.title}" (ID: ${id})?`,
			)
			if (!confirmed) {
				return {
					structuredContent: {
						success: false,
						message: 'Entry deletion cancelled',
						entry: existingEntry,
					},
					content: [createTextContent('Entry deletion cancelled')],
				}
			}

			await agent.db.deleteEntry(id)

			const structuredContent = {
				success: true,
				message: `Entry "${existingEntry.title}" (ID: ${id}) deleted successfully`,
				entry: existingEntry,
			}
			return {
				structuredContent,
				content: [
					createTextContent(structuredContent.message),
					createEntryResourceLink(existingEntry),
				],
			}
		},
	)

	agent.server.registerTool(
		'create_tag',
		{
			title: 'Create Tag',
			description: 'Create a new tag',
			annotations: {
				destructiveHint: false,
				openWorldHint: false,
			},
			inputSchema: createTagInputSchema,
			outputSchema: { tag: tagSchema },
		},
		async (tag) => {
			const createdTag = await agent.db.createTag(tag)
			return {
				structuredContent: { tag: createdTag },
				content: [
					createTextContent(
						`Tag "${createdTag.name}" created successfully with ID "${createdTag.id}"`,
					),
					createTagResourceLink(createdTag),
				],
			}
		},
	)

	agent.server.registerTool(
		'get_tag',
		{
			title: 'Get Tag',
			description: 'Get a tag by ID',
			annotations: {
				readOnlyHint: true,
				openWorldHint: false,
			},
			inputSchema: tagIdSchema,
			outputSchema: { tag: tagSchema },
		},
		async ({ id }) => {
			const tag = await agent.db.getTag(id)
			invariant(tag, `Tag ID "${id}" not found`)
			return {
				structuredContent: { tag },
				content: [
					createTextContent(JSON.stringify(tag, null, 2)),
					createTagResourceContent(tag),
				],
			}
		},
	)

	agent.server.registerTool(
		'list_tags',
		{
			title: 'List Tags',
			description: 'List all tags',
			annotations: {
				readOnlyHint: true,
				openWorldHint: false,
			},
		},
		async () => {
			const tags = await agent.db.getTags()
			const tagLinks = tags.map(createTagResourceLink)
			return {
				content: [createTextContent(`Found ${tags.length} tags.`), ...tagLinks],
			}
		},
	)

	agent.server.registerTool(
		'update_tag',
		{
			title: 'Update Tag',
			description: 'Update a tag',
			annotations: {
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false,
			},
			inputSchema: updateTagInputSchema,
			outputSchema: { tag: tagSchema },
		},
		async ({ id, ...updates }) => {
			const updatedTag = await agent.db.updateTag(id, updates)
			return {
				structuredContent: { tag: updatedTag },
				content: [
					createTextContent(
						`Tag "${updatedTag.name}" (ID: ${id}) updated successfully`,
					),
					createTagResourceLink(updatedTag),
				],
			}
		},
	)

	agent.server.registerTool(
		'delete_tag',
		{
			title: 'Delete Tag',
			description: 'Delete a tag',
			annotations: {
				idempotentHint: true,
				openWorldHint: false,
			},
			inputSchema: tagIdSchema,
			outputSchema: {
				success: z.boolean(),
				message: z.string(),
				tag: tagSchema,
			},
		},
		async ({ id }) => {
			const existingTag = await agent.db.getTag(id)
			invariant(existingTag, `Tag ID "${id}" not found`)
			const confirmed = await elicitConfirmation(
				agent,
				`Are you sure you want to delete tag "${existingTag.name}" (ID: ${id})?`,
			)

			if (!confirmed) {
				return {
					structuredContent: {
						success: false,
						message: 'Tag deletion cancelled',
						tag: existingTag,
					},
					content: [createTextContent('Tag deletion cancelled')],
				}
			}

			await agent.db.deleteTag(id)
			const structuredContent = {
				success: true,
				message: `Tag "${existingTag.name}" (ID: ${id}) deleted successfully`,
				tag: existingTag,
			}
			return {
				structuredContent,
				content: [
					createTextContent(structuredContent.message),
					createTagResourceLink(existingTag),
				],
			}
		},
	)

	agent.server.registerTool(
		'add_tag_to_entry',
		{
			title: 'Add Tag to Entry',
			description: 'Add a tag to an entry',
			annotations: {
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false,
			},
			inputSchema: entryTagIdSchema,
			outputSchema: {
				success: z.boolean(),
				message: z.string(),
				entryTag: entryTagSchema,
			},
		},
		async ({ entryId, tagId }) => {
			const tag = await agent.db.getTag(tagId)
			const entry = await agent.db.getEntry(entryId)
			invariant(tag, `Tag ${tagId} not found`)
			invariant(entry, `Entry with ID "${entryId}" not found`)
			const entryTag = await agent.db.addTagToEntry({
				entryId,
				tagId,
			})
			const structuredContent = {
				success: true,
				message: `Tag "${tag.name}" (ID: ${entryTag.tagId}) added to entry "${entry.title}" (ID: ${entryTag.entryId}) successfully`,
				entryTag,
			}
			return {
				structuredContent,
				content: [createTextContent(structuredContent.message)],
			}
		},
	)

	agent.server.registerTool(
		'create_wrapped_video',
		{
			title: 'Create Wrapped Video',
			description:
				'Create a "wrapped" video highlighting stats of your journaling this year',
			annotations: {
				destructiveHint: false,
				openWorldHint: false,
			},
			inputSchema: {
				year: z
					.number()
					.default(new Date().getFullYear())
					.describe(
						'The year to create a wrapped video for (defaults to current year)',
					),
				mock: z
					.boolean()
					.default(false)
					.describe('Whether to mock the video creation'),
			},
			outputSchema: { videoUri: z.string().describe('The URI of the video') },
		},
		async (
			{ year = new Date().getFullYear(), mock = false },
			{ sendNotification, _meta, signal },
		) => {
			const entries = await agent.db.getEntries()
			const filteredEntries = entries.filter(
				(entry) => new Date(entry.createdAt * 1000).getFullYear() === year,
			)
			const tags = await agent.db.getTags()
			const filteredTags = tags.filter(
				(tag) => new Date(tag.createdAt * 1000).getFullYear() === year,
			)
			const videoUri = await createWrappedVideo({
				entries: filteredEntries,
				tags: filteredTags,
				year,
				mock,
				onProgress: (progress) => {
					const { progressToken } = _meta ?? {}
					if (!progressToken) return
					void sendNotification({
						method: 'notifications/progress',
						params: {
							progressToken,
							progress,
							total: 1,
							message: 'Creating video...',
						},
					})
				},
				signal,
			})
			return {
				structuredContent: { videoUri },
				content: [
					createTextContent(
						`Video created successfully with URI "${videoUri}"`,
					),
				],
			}
		},
	)
}

function createTextContent(text: unknown): CallToolResult['content'][number] {
	if (typeof text === 'string') {
		return { type: 'text', text }
	} else {
		return { type: 'text', text: JSON.stringify(text, null, 2) }
	}
}

type ResourceLinkContent = Extract<
	CallToolResult['content'][number],
	{ type: 'resource_link' }
>

// Helper to create a resource link content item for an entry
function createEntryResourceLink(entry: {
	id: number
	title: string
}): ResourceLinkContent {
	return {
		type: 'resource_link',
		uri: `epicme://entries/${entry.id}`,
		name: entry.title,
		description: `Journal Entry: "${entry.title}"`,
		mimeType: 'application/json',
	}
}

// Helper to create a resource link content item for a tag
function createTagResourceLink(tag: {
	id: number
	name: string
}): ResourceLinkContent {
	return {
		type: 'resource_link',
		uri: `epicme://tags/${tag.id}`,
		name: tag.name,
		description: `Tag: "${tag.name}"`,
		mimeType: 'application/json',
	}
}

type ResourceContent = CallToolResult['content'][number]

// Helper to create an embedded resource content item for an entry
function createEntryResourceContent(entry: { id: number }): ResourceContent {
	return {
		type: 'resource',
		resource: {
			uri: `epicme://entries/${entry.id}`,
			mimeType: 'application/json',
			text: JSON.stringify(entry),
		},
	}
}

// Helper to create an embedded resource content item for a tag
function createTagResourceContent(tag: { id: number }): ResourceContent {
	return {
		type: 'resource',
		resource: {
			uri: `epicme://tags/${tag.id}`,
			mimeType: 'application/json',
			text: JSON.stringify(tag),
		},
	}
}

async function elicitConfirmation(agent: EpicMeMCP, message: string) {
	const capabilities = agent.server.server.getClientCapabilities()
	if (!capabilities?.elicitation) {
		return true
	}

	const result = await agent.server.server.elicitInput({
		message,
		requestedSchema: {
			type: 'object',
			properties: {
				confirmed: {
					type: 'boolean',
					description: 'Whether to confirm the action',
				},
			},
		},
	})
	return result.action === 'accept' && result.content?.confirmed === true
}

async function createWrappedVideo({
	entries,
	tags,
	year,
	onProgress,
	mock,
	signal,
}: {
	entries: Array<{ id: number; content: string }>
	tags: Array<{ id: number; name: string }>
	year: number
	mock: boolean
	onProgress: (progress: number) => void
	signal: AbortSignal
}) {
	if (signal.aborted) {
		throw new Error('Cancelled')
	}
	signal.addEventListener('abort', onAbort)
	let ffmpeg: ReturnType<typeof spawn> | undefined
	function onAbort() {
		if (ffmpeg && !ffmpeg.killed) {
			ffmpeg.kill('SIGKILL')
		}
	}
	try {
		if (mock) {
			const waitTime = Math.random() * 1000 + 5000
			for (let i = 0; i < waitTime; i += 500) {
				if (signal.aborted) throw new Error('Cancelled')
				const progress = i / waitTime
				if (progress >= 1) break
				onProgress(progress)
				await new Promise((resolve) => setTimeout(resolve, 500))
			}
			onProgress(1)
			return 'epicme://videos/wrapped-2025'
		}

		const totalDurationSeconds = 60 * 2
		const texts = [
			{
				text: `Hello ${userInfo().username}!`,
				color: 'white',
				fontsize: 72,
			},
			{
				text: `It's ${new Date().toLocaleDateString('en-US', {
					month: 'long',
					day: 'numeric',
					year: 'numeric',
				})}`,
				color: 'green',
				fontsize: 72,
			},
			{
				text: `Here's your EpicMe wrapped video for ${year}`,
				color: 'yellow',
				fontsize: 72,
			},
			{
				text: `You wrote ${entries.length} entries in ${year}`,
				color: '#ff69b4',
				fontsize: 72,
			},
			{
				text: `And you created ${tags.length} tags in ${year}`,
				color: 'yellow',
				fontsize: 72,
			},
			{ text: `Good job!`, color: 'red', fontsize: 72 },
			{
				text: `Keep Journaling in ${year + 1}!`,
				color: '#ffa500',
				fontsize: 72,
			},
		]
		const numTexts = texts.length
		const perTextDuration = totalDurationSeconds / numTexts
		const outputFile = `./videos/wrapped-${year}.mp4`
		await fs.mkdir('./videos', { recursive: true })
		const fontPath = './other/caveat-variable-font.ttf'
		const timings = texts.map((_, i) => {
			const start = perTextDuration * i
			const end = perTextDuration * (i + 1)
			return { start, end }
		})
		const drawtexts = texts.map((t, i) => {
			const { start, end } = timings[i]!
			const fadeInEnd = start + perTextDuration / 3
			const fadeOutStart = end - perTextDuration / 3
			const scrollExpr = `h-((t-${start})*(h+text_h)/${perTextDuration})`
			const fontcolor = t.color.startsWith('#')
				? t.color.replace('#', '0x')
				: t.color
			const safeText = t.text
				.replace(/\\/g, '\\\\')
				.replace(/'/g, "'\\''")
				.replace(/\n/g, '\\n')
			return `drawtext=fontfile=${fontPath}:text='${safeText}':fontcolor=${fontcolor}:fontsize=${t.fontsize}:x=(w-text_w)/2:y=${scrollExpr}:alpha='if(lt(t,${start}),0,if(lt(t,${fadeInEnd}),1,if(lt(t,${fadeOutStart}),1,if(lt(t,${end}),((${end}-t)/${perTextDuration / 3}),0))))':shadowcolor=black:shadowx=4:shadowy=4`
		})

		const ffmpegPromise = new Promise((resolve, reject) => {
			ffmpeg = spawn('ffmpeg', [
				'-f',
				'lavfi',
				'-i',
				`color=c=black:s=1280x720:d=${totalDurationSeconds}`,
				'-vf',
				drawtexts.join(','),
				'-c:v',
				'libx264',
				'-preset',
				'ultrafast',
				'-crf',
				'18',
				'-pix_fmt',
				'yuv420p',
				'-y',
				outputFile,
			])

			if (ffmpeg.stderr) {
				ffmpeg.stderr.on('data', (data) => {
					const str = data.toString()
					console.error(str)
					const timeMatch = str.match(/time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})/)
					if (timeMatch) {
						const hours = Number(timeMatch[1])
						const minutes = Number(timeMatch[2])
						const seconds = Number(timeMatch[3])
						const fraction = Number(timeMatch[4])
						const currentSeconds =
							hours * 3600 + minutes * 60 + seconds + fraction / 100
						const progress = Math.min(currentSeconds / totalDurationSeconds, 1)
						console.error({
							hours,
							minutes,
							seconds,
							fraction,
							currentSeconds,
							progress,
						})
						onProgress(progress)
					}
				})
			}

			ffmpeg.on('close', (code) => {
				if (signal.aborted) {
					reject(new Error('Cancelled'))
				} else if (code === 0) resolve(undefined)
				else reject(new Error(`ffmpeg exited with code ${code}`))
			})
		})

		await ffmpegPromise

		const videoUri = `epicme://videos/wrapped-${year}`
		return videoUri
	} finally {
		signal.removeEventListener('abort', onAbort)
	}
}
