export interface VoiceRoute<TInput, TOutput> {
	readonly id: string;
	execute(input: TInput, signal: AbortSignal): Promise<TOutput>;
}
export interface RoutedVoiceResult<T> {
	readonly providerId: string;
	readonly value: T;
	readonly fallbackUsed: boolean;
}
export async function routeWithFallback<TInput, TOutput>(
	primary: VoiceRoute<TInput, TOutput>,
	fallback: VoiceRoute<TInput, TOutput> | undefined,
	input: TInput,
	signal: AbortSignal,
): Promise<RoutedVoiceResult<TOutput>> {
	try {
		return {
			providerId: primary.id,
			value: await primary.execute(input, signal),
			fallbackUsed: false,
		};
	} catch (error) {
		if (!fallback || signal.aborted) throw error;
		return {
			providerId: fallback.id,
			value: await fallback.execute(input, signal),
			fallbackUsed: true,
		};
	}
}
