import type {
	SupervisorChildState,
	SupervisorParent,
} from "../../task-orchestrator/src/index.js";

export interface TaskStatusTree {
	readonly parent: SupervisorParent;
	readonly children: readonly {
		readonly state: SupervisorChildState;
		readonly instruction: string;
	}[];
}

const taskStatusPattern =
	/^(?:请|帮我|告诉我|看下|查下|查询)?(?:(?:刚才|之前|上一个|最近)(?:的)?)?任务(?:现在)?(?:的)?(?:状态|进度|结果|怎么样了?|完成了吗|做完了吗)[?？。！! ]*$/u;

export function isTaskStatusQuestion(message: string): boolean {
	return taskStatusPattern.test(message.trim());
}

function taskState(tree: TaskStatusTree): string {
	if (
		tree.children.some(
			({ state }) => state === "pending" || state === "dispatched",
		)
	)
		return "正在执行";
	if (tree.children.some(({ state }) => state === "failed")) return "执行失败";
	if (tree.children.some(({ state }) => state === "cancelled")) return "已取消";
	if (
		tree.parent.state === "completed" ||
		tree.children.every(({ state }) => state === "completed")
	)
		return "已完成";
	return "状态未知";
}

function instruction(tree: TaskStatusTree): string {
	const value = tree.children[0]?.instruction.trim() ?? "未命名任务";
	return value.length <= 60 ? value : `${value.slice(0, 57)}…`;
}

export function summarizeRecentTasks(trees: readonly TaskStatusTree[]): string {
	if (trees.length === 0) return "目前还没有历史任务。";
	if (trees.length === 1) {
		const tree = trees[0] as TaskStatusTree;
		return `最近任务「${instruction(tree)}」${taskState(tree)}。`;
	}
	return `最近 ${trees.length} 个任务：${trees
		.map(
			(tree, index) =>
				`${index + 1}.「${instruction(tree)}」${taskState(tree)}`,
		)
		.join("；")}。`;
}
