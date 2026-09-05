import { copyFile, mkdir } from "node:fs/promises";

const uiOutputDirectory = new URL("../dist/apps/operator-ui/", import.meta.url);
await mkdir(uiOutputDirectory, { recursive: true });
for (const file of ["index.html", "styles.css", "app.js"]) {
	await copyFile(
		new URL(`../apps/operator-ui/${file}`, import.meta.url),
		new URL(file, uiOutputDirectory),
	);
}

const outputDirectory = new URL(
	"../dist/plugins/runtime-fake/",
	import.meta.url,
);
await mkdir(outputDirectory, { recursive: true });
await copyFile(
	new URL("../plugins/runtime-fake/agentme.plugin.dist.json", import.meta.url),
	new URL("agentme.plugin.json", outputDirectory),
);

const codexOutputDirectory = new URL(
	"../dist/plugins/runtime-codex/",
	import.meta.url,
);
await mkdir(codexOutputDirectory, { recursive: true });
await copyFile(
	new URL("../plugins/runtime-codex/agentme.plugin.dist.json", import.meta.url),
	new URL("agentme.plugin.json", codexOutputDirectory),
);

const deepSeekOutputDirectory = new URL(
	"../dist/plugins/model-deepseek/",
	import.meta.url,
);
await mkdir(deepSeekOutputDirectory, { recursive: true });
await copyFile(
	new URL(
		"../plugins/model-deepseek/agentme.plugin.dist.json",
		import.meta.url,
	),
	new URL("agentme.plugin.json", deepSeekOutputDirectory),
);
