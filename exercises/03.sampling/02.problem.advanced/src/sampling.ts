import { invariant } from '@epic-web/invariant'
import { z } from 'zod'
import { type EpicMeMCP } from './index.ts'

export async function suggestTagsSampling(agent: EpicMeMCP, entryId: number) {
	const clientCapabilities = agent.server.server.getClientCapabilities()
	if (!clientCapabilities?.sampling) {
		console.error('Client does not support sampling, skipping sampling request')
		return
	}

	const entry = await agent.db.getEntry(entryId)
	invariant(entry, `Entry with ID "${entryId}" not found`)

	const existingTags = await agent.db.getTags()
	const currentTags = await agent.db.getEntryTags(entry.id)

	const result = await agent.server.server.createMessage({
		// 🐨 update this system prompt to explain what the LLM should do with the JSON
		// we're going to pass to it.
		// 🦉 You can develop this by chatting with an LLM yourself. Write out a
		// prompt, give it to the LLM, and then paste some example JSON in and see
		// whether the LLM responds as you expect.
		// 🐨 Note: we're expecting the LLM to respond with a JSON array of tag objects.
		// Existing tags have an "id" property, new tags have a "name" and "description" property.
		// So make sure you prompt it to respond correctly
		// 💰 providing the LLM example responses helps a lot!
		systemPrompt: `
You are a helpful assistant.

We'll put more in here later...
		`.trim(),
		messages: [
			{
				role: 'user',
				content: {
					type: 'text',
					// 🐨 change this to application/json
					mimeType: 'text/plain',
					// 🐨 Stringify JSON with the entry, currentTags, and existingTags
					text: `
You just created a new journal entry with the id ${entryId}.

Please respond with a proper commendation for yourself.
					`.trim(),
				},
			},
		],
		maxTokens: 100,
	})

	const resultSchema = z.object({
		content: z.object({
			type: z.literal('text'),
			text: z.string(),
		}),
	})

	const parsedResult = resultSchema.parse(result)

	const existingTagSchema = z.object({ id: z.number() })
	const newTagSchema = z.object({
		name: z.string(),
		description: z.string().optional(),
	})

	type ExistingSuggestedTag = z.infer<typeof existingTagSchema>
	type NewSuggestedTag = z.infer<typeof newTagSchema>
	type SuggestedTag = ExistingSuggestedTag | NewSuggestedTag

	function isExistingTagSuggestion(
		tag: SuggestedTag,
	): tag is ExistingSuggestedTag {
		return (
			'id' in tag &&
			existingTags.some((t) => t.id === tag.id) &&
			!currentTags.every((t) => t.id !== tag.id)
		)
	}

	function isNewTagSuggestion(tag: SuggestedTag): tag is NewSuggestedTag {
		return 'name' in tag && existingTags.every((t) => t.name !== tag.name)
	}

	const responseSchema = z.array(z.union([existingTagSchema, newTagSchema]))

	const suggestedTags = responseSchema.parse(
		JSON.parse(parsedResult.content.text),
	)

	const suggestedNewTags = suggestedTags.filter(isNewTagSuggestion)
	const suggestedExistingTags = suggestedTags.filter(isExistingTagSuggestion)

	const idsToAdd = new Set<number>(suggestedExistingTags.map((t) => t.id))

	if (suggestedNewTags.length > 0) {
		for (const tag of suggestedNewTags) {
			const newTag = await agent.db.createTag(tag)
			idsToAdd.add(newTag.id)
		}
	}

	for (const tagId of idsToAdd) {
		await agent.db.addTagToEntry({
			entryId: entry.id,
			tagId,
		})
	}

	const allTags = await agent.db.listTags()

	console.error(
		'Added tags to entry',
		entry.id,
		Array.from(idsToAdd)
			.map((id) => allTags.find((t) => t.id === id))
			.filter(Boolean)
			.map((t) => `${t.name} (${t.id})`)
			.join(', '),
	)
}
