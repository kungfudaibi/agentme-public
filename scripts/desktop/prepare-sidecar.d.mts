export interface PreparedHostRuntime {
	readonly nodeVersion: string;
	readonly platform: NodeJS.Platform;
	readonly architecture: string;
	readonly executable: string;
	readonly sha256: string;
}

export function prepareHostRuntime(options: {
	readonly sourceExecutable: string;
	readonly outputDirectory: string;
	readonly platform: NodeJS.Platform;
	readonly architecture: string;
	readonly nodeVersion: string;
}): Promise<PreparedHostRuntime>;

export function stageHostDependencies(options: {
	readonly sourceNodeModules: string;
	readonly outputNodeModules: string;
	readonly dependencyNames: readonly string[];
}): Promise<void>;
