export type CodingPermissionProfileId = "safe-auto" | "full-auto";

export interface CodingPermissionProfile {
	readonly id: CodingPermissionProfileId;
	readonly name: string;
	readonly sandboxMode: "workspace-write" | "danger-full-access";
	readonly approvalPolicy: "never";
	readonly isActive: boolean;
	readonly requiresExplicitApproval: boolean;
	readonly warning: string;
}

export interface CodingPermissionCatalog {
	readonly activeProfileId: CodingPermissionProfileId;
	readonly profiles: readonly CodingPermissionProfile[];
}

export interface CodingPermissionActivation {
	readonly profileId: CodingPermissionProfileId;
	readonly acknowledgeFullAccess: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProfileId(value: unknown): value is CodingPermissionProfileId {
	return value === "safe-auto" || value === "full-auto";
}

function invalidCatalog(): never {
	throw new TypeError("Invalid coding permission catalog");
}

export function parseCodingPermissionCatalog(
	value: unknown,
): CodingPermissionCatalog {
	if (
		!isRecord(value) ||
		Object.keys(value).some(
			(key) => !["activeProfileId", "profiles"].includes(key),
		) ||
		!isProfileId(value.activeProfileId) ||
		!Array.isArray(value.profiles) ||
		value.profiles.length > 2
	)
		return invalidCatalog();
	const profiles = value.profiles.map((input): CodingPermissionProfile => {
		if (
			!isRecord(input) ||
			Object.keys(input).some(
				(key) =>
					![
						"id",
						"name",
						"sandboxMode",
						"approvalPolicy",
						"isActive",
						"requiresExplicitApproval",
						"warning",
					].includes(key),
			) ||
			!isProfileId(input.id) ||
			typeof input.name !== "string" ||
			input.name.length < 1 ||
			input.name.length > 100 ||
			typeof input.warning !== "string" ||
			input.warning.length < 1 ||
			input.warning.length > 500 ||
			typeof input.isActive !== "boolean" ||
			typeof input.requiresExplicitApproval !== "boolean" ||
			input.approvalPolicy !== "never" ||
			(input.id === "safe-auto"
				? input.sandboxMode !== "workspace-write" ||
					input.requiresExplicitApproval
				: input.sandboxMode !== "danger-full-access" ||
					!input.requiresExplicitApproval)
		)
			return invalidCatalog();
		return {
			id: input.id,
			name: input.name,
			sandboxMode:
				input.id === "safe-auto" ? "workspace-write" : "danger-full-access",
			approvalPolicy: "never",
			isActive: input.isActive,
			requiresExplicitApproval: input.requiresExplicitApproval,
			warning: input.warning,
		};
	});
	return { activeProfileId: value.activeProfileId, profiles };
}

export function buildCodingPermissionActivation(
	profileId: CodingPermissionProfileId,
	confirmed: boolean,
): CodingPermissionActivation {
	if (profileId === "full-auto" && !confirmed)
		throw new TypeError("Full access is not confirmed");
	return {
		profileId,
		acknowledgeFullAccess: profileId === "full-auto",
	};
}
