import { invariant } from '@epic-web/invariant'
import { type CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import {
	createEntryInputSchema,
	createTagInputSchema,
	entryIdSchema,
	entryTagIdSchema,
	entryWithTagsSchema,
	tagIdSchema,
	tagSchema,
	updateEntryInputSchema,
	updateTagInputSchema,
} from './db/schema.ts'
import { type EpicMeMCP } from './index.ts'
import { createWrappedVideo } from './video.ts'

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
				content: [createTextContent(entry), createEntryResourceContent(entry)],
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
		},
		async ({ id, ...updates }) => {
			const existingEntry = await agent.db.getEntry(id)
			invariant(existingEntry, `Entry with ID "${id}" not found`)
			const updatedEntry = await agent.db.updateEntry(id, updates)
			return {
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
				entry: entryWithTagsSchema,
			},
		},
		async ({ id }) => {
			const existingEntry = await agent.db.getEntry(id)
			invariant(existingEntry, `Entry with ID "${id}" not found`)
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
		},
		async ({ id }) => {
			const tag = await agent.db.getTag(id)
			invariant(tag, `Tag ID "${id}" not found`)
			return {
				content: [createTextContent(tag), createTagResourceContent(tag)],
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
		},
		async ({ id, ...updates }) => {
			const updatedTag = await agent.db.updateTag(id, updates)
			return {
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
			return {
				content: [
					createTextContent(
						`Tag "${tag.name}" (ID: ${entryTag.tagId}) added to entry "${entry.title}" (ID: ${entryTag.entryId}) successfully`,
					),
					createTagResourceLink(tag),
					createEntryResourceLink(entry),
				],
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
				mockTime: z
					.number()
					.optional()
					.describe(
						'If set to > 0, use mock mode and this is the mock wait time in milliseconds',
					),
			},
		},
		async (
			{ year = new Date().getFullYear(), mockTime },
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
				mockTime,
				signal,
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
			})
			return {
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
		return { type: 'text', text: JSON.stringify(text) }
	}
}

type ResourceLinkContent = Extract<
	CallToolResult['content'][number],
	{ type: 'resource_link' }
>

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
