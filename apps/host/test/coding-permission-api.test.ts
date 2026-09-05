import { describe, expect, it, vi } from "vitest";

import {
	executeCodingPermissionRoute,
	matchCodingPermissionRoute,
} from "../src/coding-permission-api.js";
import type {
	CodingPermissionCatalog,
	CodingPermissionService,
} from "../src/coding-permission-manager.js";

const catalog: CodingPermissionCatalog = {
	activeProfileId: "safe-auto",
	profiles: [
		{
			id: "safe-auto",
			name: "安全自动",
			sandboxMode: "workspace-write",
			approvalPolicy: "never",
			isActive: true,
			requiresExplicitApproval: false,
			warning: "bounded",
		},
	],
};

function service(): CodingPermissionService {
	return {
		list: vi.fn(async () => catalog),
		activate: vi.fn(async () => catalog),
		currentPolicy: () => ({
			sandboxMode: "workspace-write",
			approvalPolicy: "never",
		}),
		attachRuntime: () => undefined,
		close: () => undefined,
	};
}

describe("coding permission API", () => {
	it("matches only the bounded list and activation routes", () => {
		expect(matchCodingPermissionRoute("GET", "/coding/permissions")).toEqual({
			type: "coding-permissions.list",
		});
		expect(
			matchCodingPermissionRoute("POST", "/coding/permissions/activate"),
		).toEqual({ type: "coding-permissions.activate" });
		expect(matchCodingPermissionRoute("DELETE", "/coding/permissions")).toBe(
			undefined,
		);
	});

	it("requires the exact full-access acknowledgement payload", async () => {
		const permissions = service();
		await executeCodingPermissionRoute(
			permissions,
			{ type: "coding-permissions.activate" },
			{
				contentType: "application/json; charset=utf-8",
				body: { profileId: "full-auto", acknowledgeFullAccess: true },
			},
			new AbortController().signal,
		);
		expect(permissions.activate).toHaveBeenCalledWith(
			"full-auto",
			true,
			expect.any(AbortSignal),
		);
	});

	it.each([
		undefined,
		{},
		{ profileId: "full-auto" },
		{ profileId: "root", acknowledgeFullAccess: true },
		{ profileId: "safe-auto", acknowledgeFullAccess: false, extra: true },
	])("rejects an invalid activation payload %#", async (body) => {
		await expect(
			executeCodingPermissionRoute(
				service(),
				{ type: "coding-permissions.activate" },
				{ contentType: "application/json", body },
				new AbortController().signal,
			),
		).rejects.toMatchObject({ code: "INVALID_CONTRACT" });
	});
});
