export type VoiceIntakeDecision =
	| { readonly type: "clarification.required"; readonly prompt: string }
	| {
			readonly type: "task.confirmation";
			readonly repositoryId: string;
			readonly instruction: string;
			readonly acknowledgement: string;
	  };

export function decideVoiceTask(
	transcript: string,
	repositoryIds: readonly string[],
): VoiceIntakeDecision {
	const instruction = transcript.trim();
	if (!instruction)
		return {
			type: "clarification.required",
			prompt: "我没有听清，请再说一次。",
		};
	const matched = repositoryIds.filter((id) =>
		instruction.toLocaleLowerCase().includes(id.toLocaleLowerCase()),
	);
	if (matched.length !== 1)
		return { type: "clarification.required", prompt: "请明确要操作的仓库。" };
	if (/删除|清空|强制推送|drop\s|reset\s+--hard/i.test(instruction))
		return {
			type: "clarification.required",
			prompt: "这个操作可能造成数据丢失，请在操作台确认具体范围。",
		};
	return {
		type: "task.confirmation",
		repositoryId: matched[0] ?? "",
		instruction,
		acknowledgement: `收到，将在 ${matched[0]} 的隔离工作树中执行。`,
	};
}
