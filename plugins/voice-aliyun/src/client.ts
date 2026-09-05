export interface SecretResolver {
	resolve(name: "aliyun-api-key"): Promise<string>;
}
export interface AliyunVoiceConfig {
	readonly endpoint: string;
	readonly model: string;
}
export class AliyunVoiceClient {
	readonly #config: AliyunVoiceConfig;
	readonly #secrets: SecretResolver;
	readonly #fetch: typeof fetch;
	constructor(
		config: AliyunVoiceConfig,
		secrets: SecretResolver,
		fetcher: typeof fetch = fetch,
	) {
		this.#config = config;
		this.#secrets = secrets;
		this.#fetch = fetcher;
	}
	async invoke(payload: unknown, signal: AbortSignal): Promise<unknown> {
		const key = await this.#secrets.resolve("aliyun-api-key");
		const response = await this.#fetch(this.#config.endpoint, {
			method: "POST",
			headers: {
				authorization: `Bearer ${key}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({ model: this.#config.model, input: payload }),
			signal,
		});
		if (!response.ok)
			throw new Error(`Alibaba voice request failed (${response.status})`);
		return response.json();
	}
}
