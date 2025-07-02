import { type EpicMeMCP } from './index.ts'

export async function suggestTagsSampling(agent: EpicMeMCP, entryId: number) {
	const result = await agent.server.server.createMessage({
		systemPrompt: `
You are a helpful assistant.

We'll put more in here later...
		`.trim(),
		messages: [
			{
				role: 'user',
				content: {
					type: 'text',
					mimeType: 'text/plain',
					text: `
You just created a new journal entry with the id ${entryId}.

Please respond with a proper commendation for yourself.
					`.trim(),
				},
			},
		],
		maxTokens: 10,
	})

	console.error('Received response:', result.content.text)
}
