export type ExecutionTarget = "windows" | "wsl2" | "docker";

export interface VerificationCommand {
	readonly executable: string;
	readonly args: readonly string[];
}

export interface RepositoryPermissionProfile {
	readonly canWrite: boolean;
	readonly canUseNetwork: boolean;
}

export interface RegisterRepositoryInput {
	readonly id: string;
	readonly path: string;
	readonly executionTarget: ExecutionTarget;
	readonly verificationCommands: readonly VerificationCommand[];
	readonly permissionProfile: RepositoryPermissionProfile;
}

export interface GitRepositoryState {
	readonly branch: string | null;
	readonly head: string;
	readonly isDirty: boolean;
}

export interface RegisteredRepository
	extends Omit<RegisterRepositoryInput, "path"> {
	readonly canonicalPath: string;
	readonly git: GitRepositoryState;
}
