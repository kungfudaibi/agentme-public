export type RepositoryConnectionResult =
	| { readonly status: "empty" }
	| { readonly status: "unauthorized" }
	| { readonly status: "unavailable" }
	| {
			readonly status: "loaded";
			readonly repositories: readonly { readonly id: string }[];
	  };

export function normalizeAccessToken(value: string): string {
	return value.trim();
}

export async function loadRepositories(
	rawToken: string,
	fetcher: typeof fetch = fetch,
): Promise<RepositoryConnectionResult> {
	const token = normalizeAccessToken(rawToken);
	if (token.length === 0) return { status: "empty" };
	try {
		const response = await fetcher("/repositories", {
			headers: { authorization: `Bearer ${token}` },
		});
		if (response.status === 401 || response.status === 403)
			return { status: "unauthorized" };
		if (!response.ok) return { status: "unavailable" };
		const payload: unknown = await response.json();
		if (
			typeof payload !== "object" ||
			payload === null ||
			!Array.isArray((payload as { repositories?: unknown }).repositories)
		)
			return { status: "unavailable" };
		const repositories = (payload as { repositories: unknown[] }).repositories;
		if (
			!repositories.every(
				(repository) =>
					typeof repository === "object" &&
					repository !== null &&
					typeof (repository as { id?: unknown }).id === "string",
			)
		)
			return { status: "unavailable" };
		return {
			status: "loaded",
			repositories: repositories.map((repository) => ({
				id: (repository as { id: string }).id,
			})),
		};
	} catch {
		return { status: "unavailable" };
	}
}
