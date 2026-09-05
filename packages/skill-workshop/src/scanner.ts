export interface ScanFinding {
	readonly severity: "critical" | "warning";
	readonly rule: string;
}
const criticalRules: readonly [RegExp, string][] = [
	[/\brm\s+-rf\b/i, "destructive-delete"],
	[/Remove-Item\s+.*-Recurse.*-Force/i, "destructive-delete"],
	[/ignore\s+(all\s+)?previous\s+instructions/i, "prompt-injection"],
	[/(?:api[_-]?key|token|password)\s*[:=]\s*["'][^"']+/i, "embedded-secret"],
];
export function scanSkill(content: string): readonly ScanFinding[] {
	return criticalRules
		.filter(([pattern]) => pattern.test(content))
		.map(([, rule]) => ({ severity: "critical", rule }));
}
