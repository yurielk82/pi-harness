/**
 * Agent Team — Dispatcher-only orchestrator with grid dashboard
 *
 * The primary Pi agent has NO codebase tools. It can ONLY delegate work
 * to specialist agents via the `dispatch_agent` tool. Each specialist
 * maintains its own Pi session for cross-invocation memory.
 *
 * Loads agent definitions from agents/*.md, .claude/agents/*.md, .pi/agents/*.md.
 * Teams are defined in .pi/agents/teams.yaml — on boot a select dialog lets
 * you pick which team to work with. Only team members are available for dispatch.
 *
 * Commands:
 *   /agents-team          — switch active team
 *   /agents-list          — list loaded agents
 *   /agents-grid N        — set column count (default 2)
 *
 * Usage: pi -e extensions/agent-team.ts
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { Text, type AutocompleteItem, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { spawn } from "child_process";
import { readdirSync, readFileSync, existsSync, mkdirSync, unlinkSync } from "fs";
import { join, resolve } from "path";
import { homedir } from "os";
import { applyExtensionDefaults } from "./themeMap.ts";

// ── Types ────────────────────────────────────────

interface AgentDef {
	name: string;
	description: string;
	tools: string;
	runner: "pi" | "codex";
	systemPrompt: string;
	file: string;
}

interface AgentState {
	def: AgentDef;
	status: "idle" | "running" | "done" | "error";
	task: string;
	toolCount: number;
	elapsed: number;
	lastWork: string;
	contextPct: number;
	sessionFile: string | null;
	runCount: number;
	timer?: ReturnType<typeof setInterval>;
}

// ── Display Name Helper ──────────────────────────

function displayName(name: string): string {
	return name.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function compactDisplayName(name: string, max: number): string {
	const full = displayName(name);
	if (full.length <= max) return full;

	const truncate = (s: string, limit: number) =>
		s.length > limit ? s.slice(0, Math.max(1, limit - 3)) + "..." : s;
	const words = full.split(" ");

	if (words.length === 1 || max < 8) {
		return truncate(full, max);
	}

	if (words.length === 2) {
		const secondBudget = Math.max(3, Math.floor((max - 1) * 0.45));
		const firstBudget = Math.max(3, max - 1 - secondBudget);
		return `${truncate(words[0], firstBudget)} ${truncate(words[1], secondBudget)}`;
	}

	const firstBudget = Math.max(4, Math.floor((max - 1) * 0.65));
	const secondWord = words[1].length > 3 ? words[1] : (words[2] || words[1]);
	const secondBudget = Math.max(2, max - 1 - firstBudget);
	return `${truncate(words[0], firstBudget)} ${truncate(secondWord, secondBudget)}`;
}

function agentNameColor(name: string): string {
	if (name === "red-team") return "error";
	if (name === "builder" || name.endsWith("-engineer")) return "warning";
	if (name === "reviewer" || name === "tester" || name === "scout") return "success";
	return "accent";
}

function contextColor(pct: number): string {
	if (pct >= 85) return "error";
	if (pct >= 65) return "warning";
	if (pct >= 35) return "accent";
	return "success";
}

// ── Teams YAML Parser ────────────────────────────

function parseTeamsYaml(raw: string): Record<string, string[]> {
	const teams: Record<string, string[]> = {};
	let current: string | null = null;
	for (const line of raw.split("\n")) {
		const teamMatch = line.match(/^(\S[^:]*):$/);
		if (teamMatch) {
			current = teamMatch[1].trim();
			teams[current] = [];
			continue;
		}
		const itemMatch = line.match(/^\s+-\s+(.+)$/);
		if (itemMatch && current) {
			teams[current].push(itemMatch[1].trim());
		}
	}
	return teams;
}

// ── Frontmatter Parser ───────────────────────────

function parseAgentFile(filePath: string): AgentDef | null {
	try {
		const raw = readFileSync(filePath, "utf-8");
		const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
		if (!match) return null;

		const frontmatter: Record<string, string> = {};
		for (const line of match[1].split("\n")) {
			const idx = line.indexOf(":");
			if (idx > 0) {
				frontmatter[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
			}
		}

		if (!frontmatter.name) return null;

		return {
			name: frontmatter.name,
			description: frontmatter.description || "",
			tools: frontmatter.tools || "read,grep,find,ls",
			runner: frontmatter.runner === "codex" ? "codex" : "pi",
			systemPrompt: match[2].trim(),
			file: filePath,
		};
	} catch {
		return null;
	}
}

function getHarnessRoot(cwd: string): string {
	return process.env.PI_HARNESS_ROOT ? resolve(process.env.PI_HARNESS_ROOT) : cwd;
}

function getSessionDir(cwd: string): string {
	const base = process.env.PI_HARNESS_SESSION_DIR || join(homedir(), ".pi", "agent", "pi-harness-sessions");
	return join(base, Buffer.from(cwd).toString("base64url"));
}

function scanAgentDirs(cwd: string, harnessRoot: string): AgentDef[] {
	const dirs = [
		join(cwd, "agents"),
		join(cwd, ".claude", "agents"),
		join(cwd, ".pi", "agents"),
	];

	if (harnessRoot !== cwd) {
		dirs.push(
			join(harnessRoot, "agents"),
			join(harnessRoot, ".pi", "agents"),
		);
	}

	const agents: AgentDef[] = [];
	const seen = new Set<string>();

	for (const dir of dirs) {
		if (!existsSync(dir)) continue;
		try {
			for (const file of readdirSync(dir)) {
				if (!file.endsWith(".md")) continue;
				const fullPath = resolve(dir, file);
				const def = parseAgentFile(fullPath);
				if (def && !seen.has(def.name.toLowerCase())) {
					seen.add(def.name.toLowerCase());
					agents.push(def);
				}
			}
		} catch {}
	}

	return agents;
}

// ── Extension ────────────────────────────────────

export default function (pi: ExtensionAPI) {
	const agentStates: Map<string, AgentState> = new Map();
	let allAgentDefs: AgentDef[] = [];
	let teams: Record<string, string[]> = {};
	let activeTeamName = "";
	let gridCols = 2;
	let widgetCtx: any;
	let sessionDir = "";
	let contextWindow = 0;

	function getHarnessTools(): string[] {
		const available = new Set(pi.getAllTools().map(tool => tool.name));
		return ["dispatch_agent", "select_team", "tilldone"].filter(tool => available.has(tool));
	}

	function getSafetyExtension(cwd: string): string | null {
		const harnessRoot = getHarnessRoot(cwd);
		for (const safetyExt of [
			resolve(cwd, "extensions", "damage-control.ts"),
			resolve(harnessRoot, "extensions", "damage-control.ts"),
		]) {
			if (existsSync(safetyExt)) return safetyExt;
		}
		return null;
	}

	function loadAgents(cwd: string) {
		const harnessRoot = getHarnessRoot(cwd);
		// Create session storage dir
		sessionDir = getSessionDir(cwd);
		if (!existsSync(sessionDir)) {
			mkdirSync(sessionDir, { recursive: true });
		}

		// Load all agent definitions
		allAgentDefs = scanAgentDirs(cwd, harnessRoot);

		// Load teams from .pi/agents/teams.yaml
		const teamsPath = [
			join(cwd, ".pi", "agents", "teams.yaml"),
			join(harnessRoot, ".pi", "agents", "teams.yaml"),
		].find(existsSync);
		if (teamsPath) {
			try {
				teams = parseTeamsYaml(readFileSync(teamsPath, "utf-8"));
			} catch {
				teams = {};
			}
		} else {
			teams = {};
		}

		// If no teams defined, create a default "all" team
		if (Object.keys(teams).length === 0) {
			teams = { all: allAgentDefs.map(d => d.name) };
		}
	}

	function activateTeam(teamName: string) {
		activeTeamName = teamName;
		const members = teams[teamName] || [];
		const defsByName = new Map(allAgentDefs.map(d => [d.name.toLowerCase(), d]));

		agentStates.clear();
		for (const member of members) {
			const def = defsByName.get(member.toLowerCase());
			if (!def) continue;
			const key = def.name.toLowerCase().replace(/\s+/g, "-");
			const sessionFile = join(sessionDir, `${key}.json`);
			agentStates.set(def.name.toLowerCase(), {
				def,
				status: "idle",
				task: "",
				toolCount: 0,
				elapsed: 0,
				lastWork: "",
				contextPct: 0,
				sessionFile: existsSync(sessionFile) ? sessionFile : null,
				runCount: 0,
			});
		}

		// Auto-size grid columns based on team size
		const size = agentStates.size;
		gridCols = Math.max(1, size);
	}

	function resetAgentSessions(agentName?: string): { removed: number; message: string } {
		if (agentName) {
			const state = agentStates.get(agentName.toLowerCase());
			if (!state) {
				return { removed: 0, message: `Agent "${agentName}" not found.` };
			}

			const agentKey = state.def.name.toLowerCase().replace(/\s+/g, "-");
			const file = join(sessionDir, `${agentKey}.json`);
			if (existsSync(file)) {
				try { unlinkSync(file); } catch {}
			}
			state.sessionFile = null;
			state.runCount = 0;
			return { removed: 1, message: `Reset session for ${displayName(state.def.name)}.` };
		}

		let removed = 0;
		for (const state of agentStates.values()) {
			const agentKey = state.def.name.toLowerCase().replace(/\s+/g, "-");
			const file = join(sessionDir, `${agentKey}.json`);
			if (existsSync(file)) {
				try {
					unlinkSync(file);
					removed++;
				} catch {}
			}
			state.sessionFile = null;
			state.runCount = 0;
		}
		return { removed, message: `Reset ${removed} agent session${removed === 1 ? "" : "s"}.` };
	}

	function postCommandResult(title: string, content: string) {
		pi.sendMessage(
			{
				customType: "agent-team-command",
				content: `${title}\n\n${content}`,
				display: true,
			},
			{ triggerTurn: false },
		);
	}

	function setActiveTeam(teamName: string, ctx: any): { ok: boolean; message: string } {
		const normalized = teamName.trim();
		if (!normalized || !teams[normalized]) {
			const available = Object.keys(teams).join(", ");
			return { ok: false, message: `Team "${teamName}" not found. Available: ${available}` };
		}

		activateTeam(normalized);
		updateWidget();
		ctx.ui.setStatus("agent-team", `Team: ${normalized} (${agentStates.size})`);
		const members = Array.from(agentStates.values()).map(s => displayName(s.def.name)).join(", ");
		postCommandResult("Team Switched", `Active team: ${normalized}\nMembers: ${members}`);
		return { ok: true, message: `Active team: ${normalized} (${members})` };
	}

	// ── Grid Rendering ───────────────────────────

	function renderCard(state: AgentState, colWidth: number, theme: any): string[] {
		const w = Math.max(12, colWidth);
		const center = (content: string, visible: number) => {
			const free = Math.max(0, w - visible);
			const left = Math.floor(free / 2);
			const right = free - left;
			return " ".repeat(left) + content + " ".repeat(right);
		};

		const statusColor = state.status === "idle" ? "warning"
			: state.status === "running" ? "accent"
			: state.status === "done" ? "success" : "error";
		const statusIcon = state.status === "idle" ? "○"
			: state.status === "running" ? "●"
			: state.status === "done" ? "✓" : "✗";

		const shortName = compactDisplayName(state.def.name, w);
		const nameStr = theme.fg(agentNameColor(state.def.name), theme.bold(shortName));
		const nameVisible = Math.min(shortName.length, w);

		const statusStr = `${statusIcon} ${state.status}`;
		const timeStr = state.status !== "idle" ? ` ${Math.round(state.elapsed / 1000)}s` : "";
		const statusLine = theme.fg(statusColor, theme.bold(statusStr)) + theme.fg("muted", timeStr);
		const statusVisible = statusStr.length + timeStr.length;

		const pctStr = `${Math.ceil(state.contextPct)}%`;
		const pctLine = theme.fg(contextColor(state.contextPct), theme.bold(pctStr));
		const pctVisible = pctStr.length;

		return [
			center(nameStr, nameVisible),
			center(statusLine, statusVisible),
			center(pctLine, pctVisible),
		];
	}

	function updateWidget() {
		if (!widgetCtx) return;

		widgetCtx.ui.setWidget("agent-team", (_tui: any, theme: any) => {
			const text = new Text("", 0, 1);

			return {
				render(width: number): string[] {
					if (agentStates.size === 0) {
						text.setText(theme.fg("dim", "No agents found. Add .md files to agents/"));
						return text.render(width);
					}

					const agents = Array.from(agentStates.values());
					const running = agents.filter(agent => agent.status === "running");

					if (running.length > 0) {
						const active = running[0];
						const cardWidth = Math.min(Math.max(18, width), 28);
						text.setText(renderCard(active, cardWidth, theme).join("\n"));
						return text.render(width);
					}

					const counts = {
						idle: agents.filter(agent => agent.status === "idle").length,
						done: agents.filter(agent => agent.status === "done").length,
						error: agents.filter(agent => agent.status === "error").length,
					};
					const summaryParts = [
						theme.fg("accent", theme.bold(activeTeamName)),
						theme.fg("muted", `${agents.length} agents`),
					];
					if (counts.error > 0) {
						summaryParts.push(theme.fg("error", `${counts.error} error`));
					}
					if (counts.done > 0) {
						summaryParts.push(theme.fg("success", `${counts.done} done`));
					}
					if (counts.idle > 0) {
						summaryParts.push(theme.fg("warning", `${counts.idle} idle`));
					}

					text.setText(summaryParts.join(theme.fg("dim", " · ")));
					return text.render(width);
				},
				invalidate() {
					text.invalidate();
				},
			};
		});
	}

	// ── Dispatch Agent (returns Promise) ─────────

	function dispatchAgent(
		agentName: string,
		task: string,
		ctx: any,
	): Promise<{ output: string; exitCode: number; elapsed: number }> {
		const key = agentName.toLowerCase();
		const state = agentStates.get(key);
		if (!state) {
			return Promise.resolve({
				output: `Agent "${agentName}" not found. Available: ${Array.from(agentStates.values()).map(s => displayName(s.def.name)).join(", ")}`,
				exitCode: 1,
				elapsed: 0,
			});
		}

		if (state.status === "running") {
			return Promise.resolve({
				output: `Agent "${displayName(state.def.name)}" is already running. Wait for it to finish.`,
				exitCode: 1,
				elapsed: 0,
			});
		}

		state.status = "running";
		state.task = task;
		state.toolCount = 0;
		state.elapsed = 0;
		state.lastWork = "";
		state.runCount++;
		updateWidget();

		const startTime = Date.now();
		state.timer = setInterval(() => {
			state.elapsed = Date.now() - startTime;
			updateWidget();
		}, 1000);

		const model = ctx.model
			? `${ctx.model.provider}/${ctx.model.id}`
			: "openrouter/google/gemini-3-flash-preview";

		const agentKey = state.def.name.toLowerCase().replace(/\s+/g, "-");
		const agentSessionFile = join(sessionDir, `${agentKey}.json`);
		const safetyExtension = getSafetyExtension(ctx.cwd);
		const textChunks: string[] = [];
		const codexPrompt = `${state.def.systemPrompt}\n\nTask:\n${task}`;

		return new Promise((resolve) => {
			const proc = state.def.runner === "codex"
				? spawn(
					"codex",
					[
						"exec",
						"--cd", ctx.cwd,
						"--sandbox", "workspace-write",
						"--color", "never",
						"--output-last-message", join(sessionDir, `${agentKey}.codex.txt`),
						codexPrompt,
					],
					{
						stdio: ["ignore", "pipe", "pipe"],
						cwd: ctx.cwd,
						env: { ...process.env },
					},
				)
				: spawn(
					"pi",
					[
						"--mode", "json",
						"-p",
						"--no-extensions",
						...(safetyExtension ? ["-e", safetyExtension] : []),
						"--model", model,
						"--tools", state.def.tools,
						"--thinking", "off",
						"--append-system-prompt", state.def.systemPrompt,
						"--session", agentSessionFile,
						...(state.sessionFile ? ["-c"] : []),
						task,
					],
					{
						stdio: ["ignore", "pipe", "pipe"],
						env: { ...process.env },
					},
				);
			const codexOutputFile = join(sessionDir, `${agentKey}.codex.txt`);

			state.lastWork = state.def.runner === "codex" ? "Running via Codex..." : "";
			updateWidget();

			let buffer = "";

			proc.stdout!.setEncoding("utf-8");
			proc.stdout!.on("data", (chunk: string) => {
				if (state.def.runner === "codex") {
					const lines = chunk.split("\n").map(line => line.trim()).filter(Boolean);
					const last = lines.filter(line =>
						!line.startsWith("WARNING:") &&
						!line.startsWith("OpenAI Codex") &&
						!line.startsWith("workdir:") &&
						!line.startsWith("model:") &&
						!line.startsWith("provider:") &&
						!line.startsWith("approval:") &&
						!line.startsWith("sandbox:") &&
						!line.startsWith("reasoning") &&
						!line.startsWith("session id:")
					).pop();
					if (last) {
						state.lastWork = last;
						updateWidget();
					}
					return;
				}

				buffer += chunk;
				const lines = buffer.split("\n");
				buffer = lines.pop() || "";
				for (const line of lines) {
					if (!line.trim()) continue;
					try {
						const event = JSON.parse(line);
						if (event.type === "message_update") {
							const delta = event.assistantMessageEvent;
							if (delta?.type === "text_delta") {
								textChunks.push(delta.delta || "");
								const full = textChunks.join("");
								const last = full.split("\n").filter((l: string) => l.trim()).pop() || "";
								state.lastWork = last;
								updateWidget();
							}
						} else if (event.type === "tool_execution_start") {
							state.toolCount++;
							updateWidget();
						} else if (event.type === "message_end") {
							const msg = event.message;
							if (msg?.usage && contextWindow > 0) {
								state.contextPct = ((msg.usage.input || 0) / contextWindow) * 100;
								updateWidget();
							}
						} else if (event.type === "agent_end") {
							const msgs = event.messages || [];
							const last = [...msgs].reverse().find((m: any) => m.role === "assistant");
							if (last?.usage && contextWindow > 0) {
								state.contextPct = ((last.usage.input || 0) / contextWindow) * 100;
								updateWidget();
							}
						}
					} catch {}
				}
			});

			proc.stderr!.setEncoding("utf-8");
			proc.stderr!.on("data", (chunk: string) => {
				if (state.def.runner === "codex") {
					const lines = chunk.split("\n").map(line => line.trim()).filter(Boolean);
					const last = lines.filter(line => !line.startsWith("WARNING:")).pop();
					if (last) {
						state.lastWork = last;
						updateWidget();
					}
				}
			});

			proc.on("close", (code) => {
				if (state.def.runner === "codex") {
					let output = "";
					if (existsSync(codexOutputFile)) {
						try {
							output = readFileSync(codexOutputFile, "utf-8").trim();
							unlinkSync(codexOutputFile);
						} catch {}
					}
					if (!output) {
						output = state.lastWork || "Codex finished without a final message.";
					}

					clearInterval(state.timer);
					state.elapsed = Date.now() - startTime;
					state.status = code === 0 ? "done" : "error";
					state.sessionFile = null;
					state.lastWork = output.split("\n").filter((l: string) => l.trim()).pop() || output;
					updateWidget();

					ctx.ui.notify(
						`${displayName(state.def.name)} ${state.status} in ${Math.round(state.elapsed / 1000)}s`,
						state.status === "done" ? "success" : "error"
					);

					resolve({
						output,
						exitCode: code ?? 1,
						elapsed: state.elapsed,
					});
					return;
				}

				if (buffer.trim()) {
					try {
						const event = JSON.parse(buffer);
						if (event.type === "message_update") {
							const delta = event.assistantMessageEvent;
							if (delta?.type === "text_delta") textChunks.push(delta.delta || "");
						}
					} catch {}
				}

				clearInterval(state.timer);
				state.elapsed = Date.now() - startTime;
				state.status = code === 0 ? "done" : "error";

				if (code === 0) {
					state.sessionFile = agentSessionFile;
				}

				const full = textChunks.join("");
				state.lastWork = full.split("\n").filter((l: string) => l.trim()).pop() || "";
				updateWidget();

				ctx.ui.notify(
					`${displayName(state.def.name)} ${state.status} in ${Math.round(state.elapsed / 1000)}s`,
					state.status === "done" ? "success" : "error"
				);

				resolve({
					output: full,
					exitCode: code ?? 1,
					elapsed: state.elapsed,
				});
			});

			proc.on("error", (err) => {
				clearInterval(state.timer);
				state.status = "error";
				state.lastWork = `Error: ${err.message}`;
				updateWidget();
				resolve({
					output: `Error spawning agent: ${err.message}`,
					exitCode: 1,
					elapsed: Date.now() - startTime,
				});
			});
		});
	}

	// ── dispatch_agent Tool (registered at top level) ──

	pi.registerTool({
		name: "dispatch_agent",
		label: "Dispatch Agent",
		description: "Dispatch a task to a specialist agent. The agent will execute the task and return the result. Use the system prompt to see available agent names.",
		parameters: Type.Object({
			agent: Type.String({ description: "Agent name (case-insensitive)" }),
			task: Type.String({ description: "Task description for the agent to execute" }),
		}),

		async execute(_toolCallId, params, _signal, onUpdate, ctx) {
			const { agent, task } = params as { agent: string; task: string };

			try {
				if (onUpdate) {
					onUpdate({
						content: [{ type: "text", text: `Dispatching to ${agent}...` }],
						details: { agent, task, status: "dispatching" },
					});
				}

				const result = await dispatchAgent(agent, task, ctx);

				const truncated = result.output.length > 8000
					? result.output.slice(0, 8000) + "\n\n... [truncated]"
					: result.output;

				const status = result.exitCode === 0 ? "done" : "error";
				const summary = `[${agent}] ${status} in ${Math.round(result.elapsed / 1000)}s`;

				return {
					content: [{ type: "text", text: `${summary}\n\n${truncated}` }],
					details: {
						agent,
						task,
						status,
						elapsed: result.elapsed,
						exitCode: result.exitCode,
						fullOutput: result.output,
					},
				};
			} catch (err: any) {
				return {
					content: [{ type: "text", text: `Error dispatching to ${agent}: ${err?.message || err}` }],
					details: { agent, task, status: "error", elapsed: 0, exitCode: 1, fullOutput: "" },
				};
			}
		},

		renderCall(args, theme) {
			const agentName = (args as any).agent || "?";
			const task = (args as any).task || "";
			const preview = task.length > 60 ? task.slice(0, 57) + "..." : task;
			return new Text(
				theme.fg("toolTitle", theme.bold("dispatch_agent ")) +
				theme.fg("accent", agentName) +
				theme.fg("dim", " — ") +
				theme.fg("muted", preview),
				0, 0,
			);
		},

		renderResult(result, options, theme) {
			const details = result.details as any;
			if (!details) {
				const text = result.content[0];
				return new Text(text?.type === "text" ? text.text : "", 0, 0);
			}

			// Streaming/partial result while agent is still running
			if (options.isPartial || details.status === "dispatching") {
				return new Text(
					theme.fg("accent", `● ${details.agent || "?"}`) +
					theme.fg("dim", " working..."),
					0, 0,
				);
			}

			const icon = details.status === "done" ? "✓" : "✗";
			const color = details.status === "done" ? "success" : "error";
			const elapsed = typeof details.elapsed === "number" ? Math.round(details.elapsed / 1000) : 0;
			const header = theme.fg(color, `${icon} ${details.agent}`) +
				theme.fg("dim", ` ${elapsed}s`);

			if (options.expanded && details.fullOutput) {
				const output = details.fullOutput.length > 4000
					? details.fullOutput.slice(0, 4000) + "\n... [truncated]"
					: details.fullOutput;
				return new Text(header + "\n" + theme.fg("muted", output), 0, 0);
			}

			return new Text(header, 0, 0);
		},
	});

	pi.registerTool({
		name: "select_team",
		label: "Select Team",
		description: "Switch the active specialist team so subsequent dispatches use the right roster for the task type.",
		parameters: Type.Object({
			team: Type.String({ description: "Team name from .pi/agents/teams.yaml" }),
			reason: Type.Optional(Type.String({ description: "Short reason for switching teams" })),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const { team, reason } = params as { team: string; reason?: string };
			const result = setActiveTeam(team, ctx);
			const suffix = reason ? `\nReason: ${reason}` : "";
			return {
				content: [{ type: "text", text: `${result.message}${suffix}` }],
				details: { team, reason: reason || "", ok: result.ok },
			};
		},

		renderCall(args, theme) {
			const team = (args as any).team || "?";
			const reason = (args as any).reason || "";
			return new Text(
				theme.fg("toolTitle", theme.bold("select_team ")) +
				theme.fg("accent", team) +
				(reason ? theme.fg("dim", " — ") + theme.fg("muted", reason) : ""),
				0, 0,
			);
		},

		renderResult(result, _options, theme) {
			const details = result.details as any;
			const team = details?.team || "?";
			const ok = !!details?.ok;
			return new Text(
				theme.fg(ok ? "success" : "error", `${ok ? "✓" : "✗"} ${team}`),
				0, 0,
			);
		},
	});

	// ── Commands ─────────────────────────────────

	pi.registerCommand("agents-team", {
		description: "Select a team to work with",
		handler: async (_args, ctx) => {
			widgetCtx = ctx;
			const teamNames = Object.keys(teams);
			if (teamNames.length === 0) {
				ctx.ui.notify("No teams defined in .pi/agents/teams.yaml", "warning");
				return;
			}

			const options = teamNames.map(name => {
				const members = teams[name].map(m => displayName(m));
				return `${name} — ${members.join(", ")}`;
			});

			const choice = await ctx.ui.select("Select Team", options);
			if (choice === undefined) return;

			const idx = options.indexOf(choice);
			const name = teamNames[idx];
			const result = setActiveTeam(name, ctx);
			ctx.ui.notify(result.message, result.ok ? "info" : "warning");
		},
	});

	pi.registerCommand("agents-list", {
		description: "List all loaded agents",
		handler: async (_args, _ctx) => {
			widgetCtx = _ctx;
			const names = Array.from(agentStates.values())
				.map(s => {
					const session = s.sessionFile ? "resumed" : "new";
					return `${displayName(s.def.name)} (${s.status}, ${session}, runs: ${s.runCount}): ${s.def.description}`;
				})
				.join("\n");
			postCommandResult("Active Agents", names || "No agents loaded");
		},
	});

	pi.registerCommand("agents-grid", {
		description: "Set grid columns: /agents-grid <1-6>",
		getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
			const items = ["1", "2", "3", "4", "5", "6"].map(n => ({
				value: n,
				label: `${n} columns`,
			}));
			const filtered = items.filter(i => i.value.startsWith(prefix));
			return filtered.length > 0 ? filtered : items;
		},
		handler: async (args, _ctx) => {
			widgetCtx = _ctx;
			const n = parseInt(args?.trim() || "", 10);
			if (n >= 1 && n <= 6) {
				gridCols = n;
				_ctx.ui.notify(`Grid set to ${gridCols} columns`, "info");
				updateWidget();
				postCommandResult("Agent Grid", `Grid columns set to ${gridCols}.`);
			} else {
				_ctx.ui.notify("Usage: /agents-grid <1-6>", "error");
			}
		},
	});

	pi.registerCommand("agents-reset", {
		description: "Reset persistent specialist sessions: /agents-reset [agent-name|all]",
		handler: async (args, ctx) => {
			widgetCtx = ctx;
			const target = args?.trim();
			const result = !target || target === "all"
				? resetAgentSessions()
				: resetAgentSessions(target);
			updateWidget();
			ctx.ui.notify(result.message, result.removed > 0 ? "info" : "warning");
			postCommandResult("Agent Sessions Reset", result.message);
		},
	});

	// ── System Prompt Override ───────────────────

	pi.on("before_agent_start", async (_event, _ctx) => {
		// Build dynamic agent catalog from active team only
		const agentCatalog = Array.from(agentStates.values())
			.map(s => `### ${displayName(s.def.name)}\n**Dispatch as:** \`${s.def.name}\`\n${s.def.description}\n**Tools:** ${s.def.tools}`)
			.join("\n\n");

		const teamMembers = Array.from(agentStates.values()).map(s => displayName(s.def.name)).join(", ");

		return {
			systemPrompt: `You are a dispatcher agent. You coordinate specialist agents to accomplish tasks.
You do NOT have direct access to the codebase. You MUST delegate all work through
agents using the dispatch_agent tool.

You may also have workflow-control tools such as tilldone available. Use them to
plan and track work, but never to bypass delegation.

You may also have a select_team tool. Use it before dispatching when the user's
task clearly fits a more specialized team than the current one.

## Active Team: ${activeTeamName}
Members: ${teamMembers}
You can ONLY dispatch to agents listed below. Do not attempt to dispatch to agents outside this team.

## How to Work
- Analyze the user's request and break it into clear sub-tasks
- Create and maintain a task list when tilldone is available
- Switch teams first when the current team is not the best fit
- Choose the right agent(s) for each sub-task
- Dispatch tasks using the dispatch_agent tool
- Review results and dispatch follow-up agents if needed
- If a task fails, try a different agent or adjust the task description
- Prefer scout first when the task is ambiguous or requires codebase discovery
- Use red-team for risky changes involving secrets, migrations, destructive commands, or security-sensitive behavior
- Summarize the outcome for the user

## Team Routing Heuristics
- Use \`software\` for backend services, APIs, app code, refactors, and platform engineering
- Use \`data\` for data pipelines, SQL models, warehouse changes, transformations, and data contracts
- Use \`analysis\` for metrics, dashboards, reporting logic, experimentation readouts, and analytical SQL
- Use \`ml-platform\` for training pipelines, inference systems, feature pipelines, model evaluation, and monitoring
- Use \`hardening\` for auth, secrets, infra, migrations, deploy risk, or destructive workflows
- Use \`docs\` when the task is primarily documentation or release-facing documentation
- Stay on \`default\` or \`fast-path\` only for generic coding tasks that do not need domain specialists

## Rules
- NEVER try to read, write, or execute code directly — you have no such tools
- ALWAYS use dispatch_agent to get work done
- You can chain agents: use scout to explore, then builder to implement
- Specialists retain their own session context across runs unless explicitly reset
- You can dispatch the same agent multiple times with different tasks
- Keep tasks focused — one clear objective per dispatch

## Agents

${agentCatalog}`,
		};
	});

	// ── Session Start ────────────────────────────

	pi.on("session_start", async (_event, _ctx) => {
		applyExtensionDefaults(import.meta.url, _ctx);
		// Clear widgets from previous session
		if (widgetCtx) {
			widgetCtx.ui.setWidget("agent-team", undefined);
		}
		widgetCtx = _ctx;
		contextWindow = _ctx.model?.contextWindow || 0;

		loadAgents(_ctx.cwd);

		// Prefer the dispatcher-oriented default team when present.
		const teamNames = Object.keys(teams);
		if (teams.default) {
			activateTeam("default");
		} else if (teamNames.length > 0) {
			activateTeam(teamNames[0]);
		}

		// Lock down to dispatcher-only plus workflow-control tools such as tilldone.
		pi.setActiveTools(getHarnessTools());

		_ctx.ui.setStatus("agent-team", `Team: ${activeTeamName} (${agentStates.size})`);
		const members = Array.from(agentStates.values()).map(s => displayName(s.def.name)).join(", ");
		_ctx.ui.notify(
			`Team: ${activeTeamName} (${members})\n` +
			`Team sets loaded from: .pi/agents/teams.yaml\n\n` +
			`/agents-team          Select a team\n` +
			`/agents-list          List active agents and status\n` +
			`/agents-reset [name]  Reset persistent agent sessions\n` +
			`/agents-grid <1-6>    Set grid column count`,
			"info",
		);
		updateWidget();

		// Footer: model | team | context bar
		_ctx.ui.setFooter((_tui, theme, _footerData) => ({
			dispose: () => {},
			invalidate() {},
			render(width: number): string[] {
				const model = _ctx.model?.id || "no-model";
				const usage = _ctx.getContextUsage();
				const pct = usage ? usage.percent : 0;
				const filled = Math.round(pct / 10);
				const bar = "#".repeat(filled) + "-".repeat(10 - filled);

				const left = theme.fg("dim", ` ${model}`) +
					theme.fg("muted", " · ") +
					theme.fg("accent", activeTeamName);
				const right = theme.fg("dim", `[${bar}] ${Math.round(pct)}% `);
				const pad = " ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(right)));

				return [truncateToWidth(left + pad + right, width)];
			},
		}));
	});
}
