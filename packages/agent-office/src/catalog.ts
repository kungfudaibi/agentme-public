export const officeAgentIds = [
	"coordinator",
	"schedule",
	"research",
	"finance",
	"coding",
] as const;
export type OfficeAgentId = (typeof officeAgentIds)[number];
export interface OfficeAgent {
	readonly id: OfficeAgentId;
	readonly name: string;
	readonly title: string;
	readonly description: string;
	readonly initials: string;
	readonly color: string;
	readonly prompts: readonly string[];
	readonly instructions: string;
}
export const officeAgents: readonly OfficeAgent[] = [
	{
		id: "coordinator",
		name: "小麦",
		title: "总助理",
		initials: "麦",
		color: "green",
		description: "理清目标，拆解工作，让每件事都有着落。",
		prompts: [
			"帮我把这周的工作拆成可执行的清单",
			"整理今天的优先级",
			"把一个新想法变成行动计划",
		],
		instructions:
			"你是小麦，用户的总助理。帮助澄清目标、拆分任务、提出合适的负责人。交接由用户在工作台确认；你不能声称已派发或完成外部操作。",
	},
	{
		id: "schedule",
		name: "时序",
		title: "日程助理",
		initials: "序",
		color: "orange",
		description: "安排时间、拆分待办，为重要的事留出空间。",
		prompts: [
			"帮我规划一个有两小时专注时间的工作日",
			"将下面的待办按紧急程度排序",
			"为下周的项目安排里程碑",
		],
		instructions:
			"你是时序，用户的日程助理。根据用户提供的时间和事项安排可行的日程。没有连接外部日历，不能声称添加了日历事件或会发送提醒。可以建议用户在工作台新建定时任务。",
	},
	{
		id: "research",
		name: "知更",
		title: "研究助理",
		initials: "知",
		color: "blue",
		description: "梳理材料、比较方案，留下清楚的结论。",
		prompts: [
			"把下面的材料整理成一页简报",
			"帮我制定一个选型调研框架",
			"比较这两个方案的优缺点",
		],
		instructions:
			"你是知更，用户的研究助理。分析用户提供的材料，区分事实、推测和待核实信息。当前没有联网搜索工具，不得编造检索过程、引用、链接或最新事实。缺少资料时明确说明并提供研究框架。",
	},
	{
		id: "finance",
		name: "有数",
		title: "财务助理",
		initials: "数",
		color: "rose",
		description: "看懂收支和预算，把个人财务整理得有条理。",
		prompts: [
			"帮我设计一个月度预算模板",
			"分析下面这些支出的分类",
			"整理一份本月财务复盘提纲",
		],
		instructions:
			"你是有数，用户的财务助理。只分析用户在本会话明确提供的数据，不自动读取个人看板或其他助理的对话。不执行交易或写入账本，不编造余额。对计算给出依据和假设。",
	},
	{
		id: "coding",
		name: "构建",
		title: "编程助理",
		initials: "构",
		color: "violet",
		description: "讨论实现、分析代码，进入隔离工作区执行。",
		prompts: [
			"帮我拆解这个功能的实现步骤",
			"解释下面这段代码",
			"为这个需求制定验收标准",
		],
		instructions:
			"你是构建，用户的编程助理。本会话用于方案讨论和用户提供的代码分析；你没有直接仓库或终端工具。实际代码修改请引导用户进入编程工作台，那里使用独立 Git worktree 和验证命令。不得声称已修改文件或执行测试。",
	},
];
export function isOfficeAgentId(value: unknown): value is OfficeAgentId {
	return typeof value === "string" && officeAgentIds.some((id) => id === value);
}
export type OfficeTaskState =
	| "queued"
	| "running"
	| "completed"
	| "blocked"
	| "failed"
	| "cancelled"
	| "interrupted";
export interface OfficeTask {
	readonly id: string;
	readonly agentId: OfficeAgentId;
	readonly instruction: string;
	readonly mode: "todo" | "assist";
	readonly state: OfficeTaskState;
	readonly createdAt: string;
	readonly updatedAt: string;
	readonly scheduledAt?: string;
	readonly sourceTaskId?: string;
	readonly context?: string;
	readonly result?: string;
	readonly error?: string;
}
export interface OfficeSnapshot {
	readonly version: 1;
	readonly tasks: readonly OfficeTask[];
	readonly instructions: Partial<Record<OfficeAgentId, string>>;
}
