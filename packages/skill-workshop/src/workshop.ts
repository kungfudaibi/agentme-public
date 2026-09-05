import { createHash, randomUUID } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { SkillEvaluationResult, SkillEvaluator } from "./evaluator.js";
import { type ScanFinding, scanSkill } from "./scanner.js";

export type SkillProposalStatus =
	| "pending"
	| "evaluated"
	| "approved"
	| "rejected"
	| "applied"
	| "rolled_back";

export interface SkillProposal {
	readonly id: string;
	readonly skillId: string;
	readonly content: string;
	readonly contentHash: string;
	readonly source: string;
	readonly createdAt: string;
	readonly status: SkillProposalStatus;
	readonly scanFindings: readonly ScanFinding[];
	readonly evaluation?: SkillEvaluationResult;
	readonly approvedAt?: string;
}

export interface SkillWorkshopOptions {
	readonly clock?: () => Date;
}

interface ProposalRow {
	id: string;
	skill_id: string;
	content: string;
	content_hash: string;
	status: string;
	backup: string | null;
	source: string;
	created_at: string;
	scan_json: string;
	evaluation_json: string | null;
	approved_at: string | null;
	had_backup: number | null;
}

interface OwnedSkillRow {
	content_hash: string;
}

const proposalStatuses = new Set<SkillProposalStatus>([
	"pending",
	"evaluated",
	"approved",
	"rejected",
	"applied",
	"rolled_back",
]);

export class SkillWorkshop {
	readonly #root: string;
	readonly #db: DatabaseSync;
	readonly #clock: () => Date;

	constructor(
		root: string,
		dbPath: string,
		options: SkillWorkshopOptions = {},
	) {
		this.#root = resolve(root);
		this.#clock = options.clock ?? (() => new Date());
		mkdirSync(this.#root, { recursive: true });
		this.#db = new DatabaseSync(dbPath, { allowExtension: false });
		this.#db.exec(
			"CREATE TABLE IF NOT EXISTS skill_proposals(id TEXT PRIMARY KEY,skill_id TEXT NOT NULL,content TEXT NOT NULL,content_hash TEXT NOT NULL,status TEXT NOT NULL,backup TEXT,source TEXT NOT NULL DEFAULT 'legacy',created_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z',scan_json TEXT NOT NULL DEFAULT '[]',evaluation_json TEXT,approved_at TEXT,had_backup INTEGER) STRICT",
		);
		this.#migrateLegacyColumns();
		this.#db.exec(
			"CREATE TABLE IF NOT EXISTS workshop_owned_skills(skill_id TEXT PRIMARY KEY,content_hash TEXT NOT NULL,proposal_id TEXT NOT NULL) STRICT",
		);
	}

	propose(
		skillId: string,
		content: string,
		source = "evidence:unknown",
	): SkillProposal {
		this.#validateId(skillId);
		const normalized = content.trim();
		const normalizedSource = source.trim();
		if (
			normalized.length < 1 ||
			normalized.length > 64_000 ||
			normalizedSource.length < 1 ||
			normalizedSource.length > 500
		)
			throw new TypeError("Invalid skill proposal");
		const id = randomUUID();
		const contentHash = hash(normalized);
		const createdAt = this.#clock().toISOString();
		const findings = scanSkill(normalized);
		this.#db
			.prepare(
				"INSERT INTO skill_proposals(id,skill_id,content,content_hash,status,source,created_at,scan_json) VALUES(?,?,?,?, 'pending',?,?,?)",
			)
			.run(
				id,
				skillId,
				normalized,
				contentHash,
				normalizedSource,
				createdAt,
				JSON.stringify(findings),
			);
		return this.get(id);
	}

	get(id: string): SkillProposal {
		return this.#proposal(this.#row(id));
	}

	list(): readonly SkillProposal[] {
		return (
			this.#db
				.prepare(
					"SELECT * FROM skill_proposals ORDER BY created_at DESC,id DESC",
				)
				.all() as unknown as ProposalRow[]
		).map((row) => this.#proposal(row));
	}

	async evaluate(
		id: string,
		evaluator: SkillEvaluator,
		signal?: AbortSignal,
	): Promise<SkillProposal> {
		const proposal = this.get(id);
		if (proposal.status !== "pending")
			throw new Error("Skill proposal cannot be evaluated");
		if (
			proposal.scanFindings.some((finding) => finding.severity === "critical")
		) {
			this.#db
				.prepare(
					"UPDATE skill_proposals SET status='rejected',evaluation_json=? WHERE id=? AND status='pending'",
				)
				.run(
					JSON.stringify({
						passed: false,
						evaluatorId: "agentme-static-scan-v1",
						evidence: proposal.scanFindings.map((finding) => finding.rule),
					}),
					id,
				);
			throw new Error("Skill proposal failed static scanning");
		}
		if (signal?.aborted) throw signal.reason;
		const result = await evaluator.evaluate(
			{
				proposalId: proposal.id,
				skillId: proposal.skillId,
				content: proposal.content,
				contentHash: proposal.contentHash,
			},
			signal,
		);
		const evaluation = validateEvaluation(result);
		const status = evaluation.passed ? "evaluated" : "rejected";
		const updated = this.#db
			.prepare(
				"UPDATE skill_proposals SET status=?,evaluation_json=? WHERE id=? AND status='pending'",
			)
			.run(status, JSON.stringify(evaluation), id);
		if (updated.changes !== 1)
			throw new Error("Skill proposal evaluation raced");
		return this.get(id);
	}

	approve(id: string, expectedHash: string): SkillProposal {
		const proposal = this.get(id);
		if (
			proposal.status !== "evaluated" ||
			proposal.contentHash !== expectedHash ||
			proposal.evaluation?.passed !== true
		)
			throw new Error("Skill proposal cannot be approved");
		const approvedAt = this.#clock().toISOString();
		const updated = this.#db
			.prepare(
				"UPDATE skill_proposals SET status='approved',approved_at=? WHERE id=? AND status='evaluated' AND content_hash=?",
			)
			.run(approvedAt, id, expectedHash);
		if (updated.changes !== 1) throw new Error("Skill proposal approval raced");
		return this.get(id);
	}

	apply(id: string, expectedHash: string): SkillProposal {
		const proposal = this.get(id);
		if (
			proposal.status !== "approved" ||
			proposal.contentHash !== expectedHash ||
			scanSkill(proposal.content).some(
				(finding) => finding.severity === "critical",
			)
		)
			throw new Error("Skill proposal cannot be applied");
		const path = this.#path(proposal.skillId);
		const owned = this.#db
			.prepare(
				"SELECT content_hash FROM workshop_owned_skills WHERE skill_id=?",
			)
			.get(proposal.skillId) as OwnedSkillRow | undefined;
		const hadBackup = existsSync(path);
		const backup = hadBackup ? readFileSync(path, "utf8") : null;
		if (
			(owned === undefined && hadBackup) ||
			(owned !== undefined &&
				(!hadBackup || hash(backup as string) !== owned.content_hash))
		)
			throw new Error("Skill target is not workshop-owned");
		const temporary = `${path}.${id}.tmp`;
		writeFileSync(temporary, proposal.content, {
			encoding: "utf8",
			mode: 0o600,
		});
		try {
			renameSync(temporary, path);
			this.#transaction(() => {
				const updated = this.#db
					.prepare(
						"UPDATE skill_proposals SET status='applied',backup=?,had_backup=? WHERE id=? AND status='approved'",
					)
					.run(backup, hadBackup ? 1 : 0, id);
				if (updated.changes !== 1)
					throw new Error("Skill proposal apply raced");
				this.#db
					.prepare(
						"INSERT INTO workshop_owned_skills(skill_id,content_hash,proposal_id) VALUES(?,?,?) ON CONFLICT(skill_id) DO UPDATE SET content_hash=excluded.content_hash,proposal_id=excluded.proposal_id",
					)
					.run(proposal.skillId, proposal.contentHash, id);
			});
		} catch (error) {
			if (backup === null) rmSync(path, { force: true });
			else writeFileSync(path, backup, { encoding: "utf8", mode: 0o600 });
			throw error;
		}
		return this.get(id);
	}

	rollback(id: string): SkillProposal {
		const row = this.#row(id);
		if (row.status !== "applied" || row.had_backup === null)
			throw new Error("Skill proposal cannot be rolled back");
		const path = this.#path(row.skill_id);
		if (
			!existsSync(path) ||
			hash(readFileSync(path, "utf8")) !== row.content_hash
		)
			throw new Error("Applied skill changed outside workshop");
		const appliedContent = readFileSync(path, "utf8");
		const temporary = `${path}.${id}.rollback`;
		try {
			if (row.had_backup === 1) {
				if (row.backup === null)
					throw new Error("Skill proposal backup is unavailable");
				writeFileSync(temporary, row.backup, {
					encoding: "utf8",
					mode: 0o600,
				});
				renameSync(temporary, path);
			} else {
				rmSync(path, { force: true });
			}
			this.#transaction(() => {
				this.#db
					.prepare(
						"UPDATE skill_proposals SET status='rolled_back' WHERE id=? AND status='applied'",
					)
					.run(id);
				if (row.had_backup === 1 && row.backup !== null)
					this.#db
						.prepare(
							"UPDATE workshop_owned_skills SET content_hash=? WHERE skill_id=?",
						)
						.run(hash(row.backup), row.skill_id);
				else
					this.#db
						.prepare("DELETE FROM workshop_owned_skills WHERE skill_id=?")
						.run(row.skill_id);
			});
		} catch (error) {
			writeFileSync(path, appliedContent, { encoding: "utf8", mode: 0o600 });
			throw error;
		}
		return this.get(id);
	}

	close(): void {
		if (this.#db.isOpen) this.#db.close();
	}

	#row(id: string): ProposalRow {
		if (!/^[0-9a-f-]{1,100}$/iu.test(id))
			throw new TypeError("Invalid proposal id");
		const row = this.#db
			.prepare("SELECT * FROM skill_proposals WHERE id=?")
			.get(id) as ProposalRow | undefined;
		if (row === undefined) throw new Error("Proposal not found");
		return row;
	}

	#proposal(row: ProposalRow): SkillProposal {
		if (!proposalStatuses.has(row.status as SkillProposalStatus))
			throw new Error("Invalid proposal status");
		const evaluation =
			row.evaluation_json === null
				? undefined
				: validateEvaluation(JSON.parse(row.evaluation_json));
		return {
			id: row.id,
			skillId: row.skill_id,
			content: row.content,
			contentHash: row.content_hash,
			source: row.source,
			createdAt: row.created_at,
			status: row.status as SkillProposalStatus,
			scanFindings: JSON.parse(row.scan_json) as ScanFinding[],
			...(evaluation === undefined ? {} : { evaluation }),
			...(row.approved_at === null ? {} : { approvedAt: row.approved_at }),
		};
	}

	#validateId(id: string): void {
		if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id) || basename(id) !== id)
			throw new TypeError("Invalid workshop skill id");
	}

	#path(id: string): string {
		this.#validateId(id);
		return join(this.#root, `${id}.md`);
	}

	#migrateLegacyColumns(): void {
		const columns = new Set(
			(
				this.#db.prepare("PRAGMA table_info(skill_proposals)").all() as Array<{
					name: string;
				}>
			).map((column) => column.name),
		);
		const migrations: Array<[string, string]> = [
			["source", "TEXT NOT NULL DEFAULT 'legacy'"],
			["created_at", "TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z'"],
			["scan_json", "TEXT NOT NULL DEFAULT '[]'"],
			["evaluation_json", "TEXT"],
			["approved_at", "TEXT"],
			["had_backup", "INTEGER"],
		];
		for (const [name, definition] of migrations)
			if (!columns.has(name))
				this.#db.exec(
					`ALTER TABLE skill_proposals ADD COLUMN ${name} ${definition}`,
				);
	}

	#transaction<T>(operation: () => T): T {
		this.#db.exec("BEGIN IMMEDIATE");
		try {
			const result = operation();
			this.#db.exec("COMMIT");
			return result;
		} catch (error) {
			if (this.#db.isTransaction) this.#db.exec("ROLLBACK");
			throw error;
		}
	}
}

function validateEvaluation(value: unknown): SkillEvaluationResult {
	if (
		typeof value !== "object" ||
		value === null ||
		Array.isArray(value) ||
		typeof (value as Record<string, unknown>).passed !== "boolean" ||
		typeof (value as Record<string, unknown>).evaluatorId !== "string" ||
		((value as Record<string, unknown>).evaluatorId as string).length < 1 ||
		((value as Record<string, unknown>).evaluatorId as string).length > 200 ||
		!Array.isArray((value as Record<string, unknown>).evidence) ||
		((value as Record<string, unknown>).evidence as unknown[]).length > 50 ||
		!((value as Record<string, unknown>).evidence as unknown[]).every(
			(item) =>
				typeof item === "string" && item.length > 0 && item.length <= 500,
		)
	)
		throw new TypeError("Invalid skill evaluation");
	return {
		passed: (value as { passed: boolean }).passed,
		evaluatorId: (value as { evaluatorId: string }).evaluatorId,
		evidence: (value as { evidence: string[] }).evidence,
	};
}

function hash(content: string): string {
	return createHash("sha256").update(content).digest("hex");
}
