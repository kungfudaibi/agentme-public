import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer, request as httpRequest } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../",import.meta.url));
const publicRoot = join(root,"apps/desktop/dist");
if (!existsSync(join(publicRoot,"index.html")) || !existsSync(join(root,"dist/apps/host/src/main.js"))) throw new Error("Run corepack pnpm office:build first.");
const data = resolve(process.env.AGENTME_OFFICE_DATA ?? join(root,".agentme/office-preview"));
mkdirSync(data,{recursive:true});
const desktopData = process.env.APPDATA ? join(process.env.APPDATA,"com.agentme.desktop") : undefined;
const settingsPath = join(data,"settings.json");
if (!existsSync(settingsPath) && desktopData && existsSync(join(desktopData,"settings.json"))) {
 const settings = JSON.parse(readFileSync(join(desktopData,"settings.json"),"utf8"));
 // Only model endpoint/model selection is reused. No channel or automatic work is enabled.
 if (settings.assistant) writeFileSync(settingsPath,JSON.stringify({assistant:settings.assistant}),{mode:0o600});
}
const token = randomBytes(32).toString("hex");
const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("AGENTME_")));
const child = spawn(process.execPath,[join(root,"dist/apps/host/src/main.js")],{
 cwd:root,windowsHide:true,stdio:["ignore","pipe","pipe"],
 env:{...environment,AGENTME_AUTH_TOKEN:token,AGENTME_PORT:"0",AGENTME_DATABASE_PATH:join(data,"agentme.sqlite"),AGENTME_SETTINGS_PATH:settingsPath,
 AGENTME_SECRETS_DIRECTORY:process.env.AGENTME_SECRETS_DIRECTORY ?? (desktopData && existsSync(join(desktopData,"secrets")) ? join(desktopData,"secrets") : join(data,"secrets")),
 AGENTME_REPOSITORIES_CONFIG:process.env.AGENTME_OFFICE_REPOSITORIES_CONFIG,
 AGENTME_TASK_ROOT:join(data,"worktrees"),
 ...Object.fromEntries(Object.entries(process.env).filter(([key]) => /^AGENTME_(CODEX|CLAUDE|PI)_/u.test(key))),
 AGENTME_LOCAL_VOICE_EXECUTABLE:undefined,AGENTME_ALIYUN_WORKSPACE_BASE_URL:undefined,
 },
});
let upstream;
let output="";
const ready = new Promise((resolveReady,reject)=>{
 child.stdout.on("data",chunk=>{output+=chunk.toString();const match=/AgentMe host listening at (http:\/\/127\.0\.0\.1:\d+)/u.exec(output);if(match){upstream=match[1];resolveReady();}});
 child.once("exit",code=>reject(new Error(`Host exited (${code})`)));
 child.once("error",reject);
});
child.stderr.on("data",chunk=>process.stderr.write(chunk));
await ready;
const port = Number(process.env.AGENTME_OFFICE_PORT ?? "3215");
const origin = `http://127.0.0.1:${port}`;
const types={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".svg":"image/svg+xml",".png":"image/png",".ico":"image/x-icon"};
const server = createServer((request,response)=>{
 response.setHeader("cache-control","no-store");
 response.setHeader("x-content-type-options","nosniff");
 response.setHeader("referrer-policy","no-referrer");
 response.setHeader("content-security-policy","default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; media-src 'self' blob: data:; frame-ancestors 'none'");
 const fail=(code,message)=>{response.writeHead(code,{"content-type":"application/json"});response.end(JSON.stringify({error:{message}}));};
 if(request.headers.host!==`127.0.0.1:${port}` || (request.headers.origin && request.headers.origin!==origin) || request.headers["sec-fetch-site"]==="cross-site") {fail(403,"Only same-origin local requests are allowed");return;}
 const url=new URL(request.url ?? "/",origin);
 if (url.pathname.startsWith("/api/")) {
  if(!["GET","POST","PUT","DELETE"].includes(request.method ?? "")){fail(405,"Method not allowed");return;}
  const proxy = httpRequest(`${upstream}${url.pathname.slice(4)}${url.search}`,{method:request.method,headers:{authorization:`Bearer ${token}`,...(request.headers["content-type"] ? {"content-type":request.headers["content-type"]} : {})}},incoming=>{
   response.writeHead(incoming.statusCode ?? 502,{"content-type":incoming.headers["content-type"] ?? "application/json","cache-control":"no-store"});incoming.pipe(response);
  });
  proxy.on("error",()=>{if(!response.headersSent)fail(502,"Local host unavailable");else response.end();});
  response.once("close",()=>proxy.destroy());request.pipe(proxy);return;
 }
 if(request.method!=="GET"){fail(405,"Method not allowed");return;}
 let decoded;try{decoded=decodeURIComponent(url.pathname);}catch{fail(400,"Invalid path");return;}
 const file=resolve(publicRoot,`.${decoded === "/" ? "/index.html" : decoded}`);
 if(!file.startsWith(publicRoot+sep)){fail(403,"Invalid path");return;}
 try{const body=readFileSync(file);response.writeHead(200,{"content-type":types[extname(file)] ?? "application/octet-stream"});response.end(body);}catch{fail(404,"File not found");}
});
server.on("error",error=>{process.stderr.write(`${error.message}\n`);child.kill();process.exitCode=1;});
server.listen(port,"127.0.0.1",()=>process.stdout.write(`AgentMe office ready: ${origin}\nOffice data: ${data}\n`));
let closing=false;
async function close(){if(closing)return;closing=true;server.closeAllConnections();server.close();try{await fetch(`${upstream}/shutdown`,{method:"POST",headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(3000)});}catch{child.kill();}}
process.once("SIGINT",()=>void close());process.once("SIGTERM",()=>void close());
child.once("exit",()=>{server.closeAllConnections();server.close();});
