import { type EpicMeMCP } from './index.ts'

export async function suggestTagsSampling(agent: EpicMeMCP, entryId: number) {
	const clientCapabilities = agent.server.server.getClientCapabilities()
	if (!clientCapabilities?.sampling) {
		console.error('Client does not support sampling, skipping sampling request')
		return
	}

	const result = await agent.server.server.createMessage({
		systemPrompt: `You are a helpful assistant.`,
		messages: [
			{
				role: 'user',
				content: {
					type: 'text',
					text: `You just created a new journal entry with the id ${entryId}. Please respond with a proper commendation for yourself.`,
				},
			},
		],
		maxTokens: 10,
	})

	void agent.server.server.sendLoggingMessage({
		level: 'info',
		logger: 'tag-generator',
		data: {
			message: 'Received response from model',
			modelResponse: result.content.text,
		},
	})
}
