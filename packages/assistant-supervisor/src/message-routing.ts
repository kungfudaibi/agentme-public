const codingTaskPattern =
	/(?:修复|修改|实现|新增|编写|重构|审查|检查|运行|执行|测试|构建|打包|提交|仓库|代码|项目|工作树|部署|fix|implement|refactor|review|test|build|lint|repository|codebase)/iu;

export function isCodingTaskRequest(message: string): boolean {
	return codingTaskPattern.test(message.trim());
}
