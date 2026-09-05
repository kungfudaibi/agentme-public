import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import { AgentMeError } from "../../contracts/src/index.js";

export function invalidRepository(cause?: unknown): AgentMeError {
	return new AgentMeError({
		code: "INVALID_REPOSITORY",
		message: "Repository registration is invalid",
		isRetryable: false,
		cause,
	});
}

export async function canonicalizeApprovedRoots(
	roots: readonly string[],
): Promise<readonly string[]> {
	if (roots.length === 0) throw invalidRepository();
	try {
		return await Promise.all(roots.map((root) => realpath(resolve(root))));
	} catch (error) {
		throw invalidRepository(error);
	}
}

export async function assertPathInApprovedRoots(
	candidate: string,
	approvedRoots: readonly string[],
): Promise<string> {
	if (!isAbsolute(candidate)) throw invalidRepository();
	try {
		const canonical = await realpath(candidate);
		const isApproved = approvedRoots.some((root) => {
			const fromRoot = relative(root, canonical);
			return (
				fromRoot === "" ||
				(fromRoot !== ".." &&
					!fromRoot.startsWith(`..\\`) &&
					!fromRoot.startsWith("../") &&
					!isAbsolute(fromRoot))
			);
		});
		if (!isApproved) throw invalidRepository();
		return canonical;
	} catch (error) {
		if (error instanceof AgentMeError) throw error;
		throw invalidRepository(error);
	}
}
