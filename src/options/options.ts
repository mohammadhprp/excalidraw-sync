/**
 * Extension options page — a three-step onboarding wizard
 * (Connect → Repository → Verify).
 *
 * This is an extension-origin document (`chrome-extension://…`), not a content
 * script, so the PAT never enters the excalidraw.com page realm or a
 * content-script message. It talks to the service worker via the frozen
 * protocol (`settings:get` / `settings:set`, `github:listRepos`,
 * `github:testConnection`).
 *
 * The step decisions live in `./wizard.ts` (pure, unit-tested); this module
 * only wires them to DOM elements.
 */

import type {
  ConnectionInfo,
  PublicSettings,
  RepoSummary,
  Req,
  Res,
} from "../lib";
import { BUILT_IN_BRANCH, resolveAdoptedBranch } from "../ui/format";
import { buildTokenPatch } from "./token";
import {
  buildRepositoryPatch,
  canAdvance,
  connectionSummary,
  filterRepos,
  initialStep,
  nextStepId,
  previousStepId,
  repoLabel,
  repoPatch,
  stepIndex,
  stepStatuses,
  WIZARD_STEPS,
  type WizardStepId,
} from "./wizard";

function send<T>(req: Req): Promise<Res<T>> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(req, (response: unknown) => {
        if (chrome.runtime.lastError) {
          resolve({
            ok: false,
            error: chrome.runtime.lastError.message ?? "Extension context error.",
          });
          return;
        }
        if (response === undefined || response === null) {
          resolve({ ok: false, error: "No response from the service worker." });
          return;
        }
        resolve(response as Res<T>);
      });
    } catch (error) {
      resolve({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

function el<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Options page is missing #${id}`);
  return element as T;
}

function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

interface ViewState {
  settings: PublicSettings | null;
  step: WizardStepId;
  /** True once Test connection has succeeded this session. */
  verified: boolean;
  repos: RepoSummary[];
  reposLoaded: boolean;
  reposLoading: boolean;
  reposError: string | null;
  busy: boolean;
}

const state: ViewState = {
  settings: null,
  step: "connect",
  verified: false,
  repos: [],
  reposLoaded: false,
  reposLoading: false,
  reposError: null,
  busy: false,
};

function setStatus(message: string, isError = false): void {
  const status = el("status");
  status.textContent = message;
  status.classList.toggle("error", isError);
}

/** A step is reachable when every earlier step is complete. */
function reachable(step: WizardStepId): boolean {
  const settings = state.settings;
  if (!settings) return false;
  switch (step) {
    case "connect":
      return true;
    case "repository":
      return canAdvance("connect", settings);
    case "verify":
      return canAdvance("connect", settings) && canAdvance("repository", settings);
  }
}

function renderStepper(): void {
  const list = el<HTMLOListElement>("stepper");
  clear(list);
  if (!state.settings) return;
  const statuses = stepStatuses(state.settings, {
    step: state.step,
    verified: state.verified,
  });
  for (const st of statuses) {
    const li = document.createElement("li");
    li.className = "step";
    if (st.complete) li.classList.add("complete");
    if (st.current) li.classList.add("current");

    const button = document.createElement("button");
    button.type = "button";
    button.className = "step-button";
    if (st.current) button.setAttribute("aria-current", "step");
    button.disabled = state.busy || !reachable(st.id);
    button.addEventListener("click", () => goTo(st.id));

    const marker = document.createElement("span");
    marker.className = "step-marker";
    marker.textContent = st.complete ? "✓" : String(st.index + 1);
    marker.setAttribute("aria-hidden", "true");

    const title = document.createElement("span");
    title.className = "step-title";
    title.textContent = st.title;

    button.append(marker, title);
    li.append(button);
    list.append(li);
  }
}

function renderPanels(): void {
  for (const step of WIZARD_STEPS) {
    el(`panel-${step.id}`).hidden = step.id !== state.step;
  }
}

function renderTokenState(): void {
  const settings = state.settings;
  el("token-state").textContent = settings?.hasToken
    ? "A token is configured. Enter a new one to replace it, or continue."
    : "No token configured yet.";
}

function renderSummary(): void {
  const settings = state.settings;
  if (!settings) return;
  const summary = connectionSummary(settings);
  el("verify-summary").textContent = summary;
  el("done-summary").textContent = summary;
  el("done").hidden = !state.verified;
}

function nextLabel(): string {
  const settings = state.settings;
  switch (state.step) {
    case "connect":
      if (state.busy) return "Saving…";
      return settings?.hasToken ? "Continue" : "Save token";
    case "repository":
      return state.busy ? "Saving…" : "Save repository";
    case "verify":
      if (state.verified) return "Connected ✓";
      return state.busy ? "Testing…" : "Test connection";
  }
}

function nextDisabled(): boolean {
  const settings = state.settings;
  if (state.busy || !settings) return true;
  switch (state.step) {
    case "connect": {
      const hasInput = el<HTMLInputElement>("token").value.trim() !== "";
      return !settings.hasToken && !hasInput;
    }
    case "repository": {
      const owner = el<HTMLInputElement>("owner").value.trim();
      const repo = el<HTMLInputElement>("repo").value.trim();
      return owner === "" || repo === "";
    }
    case "verify":
      return state.verified || !canAdvance("repository", settings);
  }
}

function renderActions(): void {
  const back = el<HTMLButtonElement>("back");
  back.disabled = state.busy || stepIndex(state.step) === 0;
  const next = el<HTMLButtonElement>("next");
  next.textContent = nextLabel();
  next.disabled = nextDisabled();
}

function render(): void {
  if (!state.settings) return;
  renderTokenState();
  renderStepper();
  renderPanels();
  renderSummary();
  renderActions();
}

function populateRepositoryFields(): void {
  const settings = state.settings;
  if (!settings) return;
  el<HTMLInputElement>("owner").value = settings.owner;
  el<HTMLInputElement>("repo").value = settings.repo;
  el<HTMLInputElement>("branch").value = settings.branch;
  el<HTMLInputElement>("root-path").value = settings.rootPath;
  el<HTMLInputElement>("author-name").value = settings.author.name;
  el<HTMLInputElement>("author-email").value = settings.author.email;
}

function renderRepoOptions(): void {
  const select = el<HTMLSelectElement>("repo-select");
  const note = el("repo-note");
  const query = el<HTMLInputElement>("repo-search").value;
  const previous = select.value;
  clear(select);

  note.classList.remove("error");

  if (state.reposError) {
    select.disabled = true;
    note.textContent = state.reposError;
    note.classList.add("error");
    return;
  }

  select.disabled = false;

  if (state.reposLoading) {
    note.textContent = "Loading repositories…";
    return;
  }

  const filtered = filterRepos(state.repos, query);
  for (const repo of filtered) {
    const option = document.createElement("option");
    option.value = repo.fullName;
    option.textContent = repoLabel(repo);
    select.append(option);
  }
  if (previous !== "" && filtered.some((repo) => repo.fullName === previous)) {
    select.value = previous;
  }

  if (state.repos.length === 0) {
    note.textContent =
      "No repositories found for this token. Enter owner and name manually.";
  } else if (filtered.length === 0) {
    note.textContent = `No repositories match “${query.trim()}”.`;
  } else {
    note.textContent = `${filtered.length} of ${state.repos.length} repositories.`;
  }
}

async function ensureRepos(): Promise<void> {
  if (
    !state.settings?.hasToken ||
    state.reposLoaded ||
    state.reposLoading
  ) {
    return;
  }
  state.reposLoading = true;
  state.reposError = null;
  renderRepoOptions();

  const res = await send<RepoSummary[]>({ type: "github:listRepos" });
  state.reposLoading = false;
  if (!res.ok) {
    // Leave `reposLoaded` false so returning to this step retries.
    state.reposError = res.error;
  } else {
    state.reposLoaded = true;
    state.repos = res.data;
  }
  renderRepoOptions();
}

function goTo(step: WizardStepId): void {
  state.step = step;
  if (step === "repository") void ensureRepos();
  render();
}

function resetRepos(): void {
  state.repos = [];
  state.reposLoaded = false;
  state.reposLoading = false;
  state.reposError = null;
}

async function saveTokenAndContinue(): Promise<void> {
  const settings = state.settings;
  if (!settings) return;
  const input = el<HTMLInputElement>("token");
  const patch = buildTokenPatch(input.value);
  let next: PublicSettings = settings;

  if (patch) {
    state.busy = true;
    render();
    const res = await send<PublicSettings>({ type: "settings:set", patch });
    state.busy = false;
    if (!res.ok) {
      setStatus(res.error, true);
      render();
      return;
    }
    next = res.data;
    state.settings = next;
    input.value = "";
    // A new token may see a different set of repositories.
    resetRepos();
    setStatus("Token saved.");
  } else if (!settings.hasToken) {
    setStatus("Enter a token first.", true);
    render();
    return;
  }

  state.step = initialStep(next);
  if (state.step === "repository") void ensureRepos();
  render();
}

async function saveRepositoryAndContinue(): Promise<void> {
  const owner = el<HTMLInputElement>("owner").value.trim();
  const repo = el<HTMLInputElement>("repo").value.trim();
  if (owner === "" || repo === "") {
    setStatus("Owner and repository are required.", true);
    render();
    return;
  }

  const patch = buildRepositoryPatch({
    owner,
    repo,
    branch: el<HTMLInputElement>("branch").value,
    rootPath: el<HTMLInputElement>("root-path").value,
    authorName: el<HTMLInputElement>("author-name").value,
    authorEmail: el<HTMLInputElement>("author-email").value,
  });

  state.busy = true;
  render();
  const res = await send<PublicSettings>({ type: "settings:set", patch });
  state.busy = false;
  if (!res.ok) {
    setStatus(res.error, true);
    render();
    return;
  }
  state.settings = res.data;
  state.verified = false;
  setStatus("Repository saved.");
  state.step = nextStepId(state.step);
  render();
}

async function testConnection(): Promise<void> {
  const settings = state.settings;
  if (!settings) return;

  state.busy = true;
  state.verified = false;
  render();
  const res = await send<ConnectionInfo>({ type: "github:testConnection" });
  if (!res.ok) {
    state.busy = false;
    setStatus(res.error, true);
    render();
    return;
  }

  const info = res.data;
  const adopted = resolveAdoptedBranch({
    configuredBranch: settings.branch,
    defaultBranch: info.branch,
  });
  if (adopted.adopted) {
    const saved = await send<PublicSettings>({
      type: "settings:set",
      patch: { branch: adopted.branch },
    });
    if (!saved.ok) {
      // Persisting failed, so settings still hold the previous branch and the
      // client keeps using it. Do not mark the step verified, and report the
      // branch actually in effect rather than the one we could not save.
      state.busy = false;
      const inEffect = settings.branch.trim() || BUILT_IN_BRANCH;
      setStatus(
        `Could not adopt the repository default branch: ${saved.error} Connected to ${info.owner}/${info.repo} @ ${inEffect}.`,
        true,
      );
      render();
      return;
    }
    state.settings = saved.data;
  }
  state.settings = { ...(state.settings ?? settings), branch: adopted.branch };
  state.busy = false;
  state.verified = true;
  setStatus(adopted.notice ?? `Connected to ${info.owner}/${info.repo}.`);
  render();
}

function onNext(): void {
  switch (state.step) {
    case "connect":
      void saveTokenAndContinue();
      return;
    case "repository":
      void saveRepositoryAndContinue();
      return;
    case "verify":
      void testConnection();
      return;
  }
}

function onBack(): void {
  state.step = previousStepId(state.step);
  if (state.step === "repository") void ensureRepos();
  render();
}

/** Recompute the primary button as the user edits; drop a stale verify. */
function onFieldInput(): void {
  if (state.verified) state.verified = false;
  render();
}

function wire(): void {
  el<HTMLInputElement>("token").addEventListener("input", () => {
    renderActions();
  });
  for (const id of [
    "owner",
    "repo",
    "branch",
    "root-path",
    "author-name",
    "author-email",
  ]) {
    el<HTMLInputElement>(id).addEventListener("input", onFieldInput);
  }
  el<HTMLInputElement>("repo-search").addEventListener("input", () => {
    renderRepoOptions();
  });
  el<HTMLSelectElement>("repo-select").addEventListener("change", (event) => {
    const select = event.currentTarget as HTMLSelectElement;
    const chosen = state.repos.find((repo) => repo.fullName === select.value);
    if (!chosen) return;
    const patch = repoPatch(chosen);
    el<HTMLInputElement>("owner").value = patch.owner ?? "";
    el<HTMLInputElement>("repo").value = patch.repo ?? "";
    const branch = el<HTMLInputElement>("branch");
    if (branch.value.trim() === "" && chosen.defaultBranch !== "") {
      branch.value = chosen.defaultBranch;
    }
    if (state.verified) state.verified = false;
    setStatus(`Selected ${chosen.fullName}.`);
    render();
  });
  el<HTMLButtonElement>("next").addEventListener("click", onNext);
  el<HTMLButtonElement>("back").addEventListener("click", onBack);
}

async function init(): Promise<void> {
  const res = await send<PublicSettings>({ type: "settings:get" });
  if (!res.ok) {
    setStatus(res.error, true);
    return;
  }
  state.settings = res.data;
  state.step = initialStep(res.data);
  populateRepositoryFields();
  render();
  if (state.step === "repository") void ensureRepos();
}

wire();
void init();
