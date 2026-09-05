export interface TencentMessageIdentity {
	readonly senderId: string;
	readonly conversation: "private" | "group";
	readonly paired: boolean;
}
export type RemotePermission =
	| "chat"
	| "task.create"
	| "task.read"
	| "task.cancel";
export function permissionsFor(
	identity: TencentMessageIdentity,
	ownerIds: ReadonlySet<string>,
): ReadonlySet<RemotePermission> {
	if (
		identity.conversation !== "private" ||
		!identity.paired ||
		!ownerIds.has(identity.senderId)
	)
		return new Set(["chat"]);
	return new Set(["chat", "task.create", "task.read", "task.cancel"]);
}
