import { describe, expect, it } from "vitest";

import {
	buildCodingPermissionActivation,
	parseCodingPermissionCatalog,
} from "../ui/coding-permission-state.js";

describe("desktop coding permission state", () => {
	it("parses only the two bounded Codex permission profiles", () => {
		expect(
			parseCodingPermissionCatalog({
				activeProfileId: "safe-auto",
				profiles: [
					{
						id: "safe-auto",
						name: "安全自动",
						sandboxMode: "workspace-write",
						approvalPolicy: "never",
						isActive: true,
						requiresExplicitApproval: false,
						warning: "只写任务工作树",
					},
				],
			}),
		).toMatchObject({
			activeProfileId: "safe-auto",
			profiles: [{ id: "safe-auto", isActive: true }],
		});
	});

	it("rejects unrecognized policies and extra fields", () => {
		expect(() =>
			parseCodingPermissionCatalog({
				activeProfileId: "root",
				profiles: [],
			}),
		).toThrow("Invalid coding permission catalog");
		expect(() =>
			parseCodingPermissionCatalog({
				activeProfileId: "full-auto",
				profiles: [
					{
						id: "full-auto",
						name: "完全访问",
						sandboxMode: "danger-full-access",
						approvalPolicy: "never",
						isActive: true,
						requiresExplicitApproval: true,
						warning: "high risk",
						secret: "no",
					},
				],
			}),
		).toThrow("Invalid coding permission catalog");
	});

	it("builds an explicit full-access acknowledgement only after confirmation", () => {
		expect(buildCodingPermissionActivation("safe-auto", false)).toEqual({
			profileId: "safe-auto",
			acknowledgeFullAccess: false,
		});
		expect(() => buildCodingPermissionActivation("full-auto", false)).toThrow(
			"Full access is not confirmed",
		);
		expect(buildCodingPermissionActivation("full-auto", true)).toEqual({
			profileId: "full-auto",
			acknowledgeFullAccess: true,
		});
	});
});
