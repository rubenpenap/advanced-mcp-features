import { invariant } from '@epic-web/invariant'
import { type CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { createEntryInputSchema, createTagInputSchema } from './db/schema.ts'
import { type EpicMeMCP } from './index.ts'
import { suggestTagsSampling } from './sampling.ts'

export async function initializeTools(agent: EpicMeMCP) {
	// Entry Tools
	agent.server.registerTool(
		'create_entry',
		{
			title: 'Create Entry',
			description: 'Create a new journal entry',
			inputSchema: createEntryInputSchema,
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
				content: [
					createTextContent(
						`Entry "${createdEntry.title}" created successfully with ID "${createdEntry.id}"`,
					),
					createEntryResourceLinkContent(createdEntry),
				],
			}
		},
	)

	agent.server.registerTool(
		'get_entry',
		{
			title: 'Get Entry',
			description: 'Get a journal entry by ID',
			inputSchema: {
				id: z.number().describe('The ID of the entry'),
			},
		},
		async ({ id }) => {
			const entry = await agent.db.getEntry(id)
			invariant(entry, `Entry with ID "${id}" not found`)
			return {
				content: [createEntryResourceContent(entry)],
			}
		},
	)

	agent.server.registerTool(
		'list_entries',
		{
			title: 'List Entries',
			description: 'List all journal entries',
			inputSchema: {
				tagIds: z
					.array(z.number())
					.optional()
					.describe('Optional array of tag IDs to filter entries by'),
			},
		},
		async ({ tagIds }) => {
			const entries = await agent.db.listEntries(tagIds)
			return createReply(entries)
		},
	)

	agent.server.registerTool(
		'update_entry',
		{
			title: 'Update Entry',
			description:
				'Update a journal entry. Fields that are not provided (or set to undefined) will not be updated. Fields that are set to null or any other value will be updated.',
			inputSchema: {
				id: z.number(),
				title: z.string().optional().describe('The title of the entry'),
				content: z.string().optional().describe('The content of the entry'),
				mood: z
					.string()
					.nullable()
					.optional()
					.describe(
						'The mood of the entry (for example: "happy", "sad", "anxious", "excited")',
					),
				location: z
					.string()
					.nullable()
					.optional()
					.describe(
						'The location of the entry (for example: "home", "work", "school", "park")',
					),
				weather: z
					.string()
					.nullable()
					.optional()
					.describe(
						'The weather of the entry (for example: "sunny", "cloudy", "rainy", "snowy")',
					),
				isPrivate: z
					.number()
					.optional()
					.describe(
						'Whether the entry is private (1 for private, 0 for public)',
					),
				isFavorite: z
					.number()
					.optional()
					.describe(
						'Whether the entry is a favorite (1 for favorite, 0 for not favorite)',
					),
			},
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
					createEntryResourceLinkContent(updatedEntry),
				],
			}
		},
	)

	agent.server.registerTool(
		'delete_entry',
		{
			title: 'Delete Entry',
			description: 'Delete a journal entry',
			inputSchema: {
				id: z.number().describe('The ID of the entry'),
			},
		},
		async ({ id }) => {
			const existingEntry = await agent.db.getEntry(id)
			invariant(existingEntry, `Entry with ID "${id}" not found`)
			await agent.db.deleteEntry(id)
			return {
				content: [
					createTextContent(
						`Entry "${existingEntry.title}" (ID: ${id}) deleted successfully`,
					),
				],
			}
		},
	)

	// Tag Tools
	agent.server.registerTool(
		'create_tag',
		{
			title: 'Create Tag',
			description: 'Create a new tag',
			inputSchema: createTagInputSchema,
		},
		async (tag) => {
			const createdTag = await agent.db.createTag(tag)
			return {
				content: [
					createTextContent(
						`Tag "${createdTag.name}" created successfully with ID "${createdTag.id}"`,
					),
					createTagResourceContent(createdTag),
				],
			}
		},
	)

	agent.server.registerTool(
		'get_tag',
		{
			title: 'Get Tag',
			description: 'Get a tag by ID',
			inputSchema: {
				id: z.number().describe('The ID of the tag'),
			},
		},
		async ({ id }) => {
			const tag = await agent.db.getTag(id)
			invariant(tag, `Tag ID "${id}" not found`)
			return {
				content: [createTagResourceContent(tag)],
			}
		},
	)

	agent.server.registerTool(
		'list_tags',
		{
			title: 'List Tags',
			description: 'List all tags',
		},
		async () => {
			const tags = await agent.db.listTags()
			return createReply(tags)
		},
	)

	agent.server.registerTool(
		'update_tag',
		{
			title: 'Update Tag',
			description: 'Update a tag',
			inputSchema: {
				id: z.number(),
				...Object.fromEntries(
					Object.entries(createTagInputSchema).map(([key, value]) => [
						key,
						value.nullable().optional(),
					]),
				),
			},
		},
		async ({ id, ...updates }) => {
			const updatedTag = await agent.db.updateTag(id, updates)
			return {
				content: [
					createTextContent(
						`Tag "${updatedTag.name}" (ID: ${id}) updated successfully`,
					),
					createTagResourceContent(updatedTag),
				],
			}
		},
	)

	agent.server.registerTool(
		'delete_tag',
		{
			title: 'Delete Tag',
			description: 'Delete a tag',
			inputSchema: {
				id: z.number().describe('The ID of the tag'),
			},
		},
		async ({ id }) => {
			const existingTag = await agent.db.getTag(id)
			invariant(existingTag, `Tag ID "${id}" not found`)
			await agent.db.deleteTag(id)
			return {
				content: [
					createTextContent(
						`Tag "${existingTag.name}" (ID: ${id}) deleted successfully`,
					),
					createTagResourceContent(existingTag),
				],
			}
		},
	)

	// Entry Tag Tools
	agent.server.registerTool(
		'add_tag_to_entry',
		{
			title: 'Add Tag to Entry',
			description: 'Add a tag to an entry',
			inputSchema: {
				entryId: z.number().describe('The ID of the entry'),
				tagId: z.number().describe('The ID of the tag'),
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
			return {
				content: [
					createTextContent(
						`Tag "${tag.name}" (ID: ${entryTag.tagId}) added to entry "${entry.title}" (ID: ${entryTag.entryId}) successfully`,
					),
					createTagResourceLinkContent(tag),
					createEntryResourceLinkContent(entry),
				],
			}
		},
	)
}

function createReply(text: any): CallToolResult {
	if (typeof text === 'string') {
		return { content: [{ type: 'text', text }] }
	} else {
		return {
			content: [{ type: 'text', text: JSON.stringify(text) }],
		}
	}
}
function createTextContent(text: unknown): CallToolResult['content'][number] {
	if (typeof text === 'string') {
		return { type: 'text', text }
	} else {
		return { type: 'text', text: JSON.stringify(text) }
	}
}

type ResourceContent = CallToolResult['content'][number]

function createEntryResourceLinkContent(entry: {
	id: number
	title: string
}): ResourceContent {
	return {
		type: 'resource_link',
		uri: `epicme://entries/${entry.id}`,
		name: entry.title,
		mimeType: 'application/json',
	}
}

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

function createTagResourceLinkContent(tag: {
	id: number
	name: string
	description: string | null
}): ResourceContent {
	return {
		type: 'resource_link',
		uri: `epicme://tags/${tag.id}`,
		name: tag.name,
		description: tag.description ?? undefined,
		mimeType: 'application/json',
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
