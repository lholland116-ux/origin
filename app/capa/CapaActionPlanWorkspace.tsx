"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CAPA_ACTION_STATUSES,
  CAPA_ACTION_TYPES,
  evaluateCapaActionPlanReadiness,
  validateCapaActionPlan,
  type CapaActionLinkTargetType,
  type CapaActionPlanContent,
  type CapaActionPlanEffectivenessCheck,
  type CapaActionPlanItem,
} from "../../lib/capa/domain/capa-action-plan";
import {
  loadActionPlanWorkspace,
  saveActionPlanWorkspace,
  type CapaActionPlanWorkspaceProjection,
} from "./capa-action-plan-workspace-client";
import CapaActionPlanAdvisoryPanel from "./CapaActionPlanAdvisoryPanel";

export interface CapaActionPlanTargetOption {
  readonly target_type: CapaActionLinkTargetType;
  readonly target_id: string;
  readonly label: string;
}

interface CapaActionPlanWorkspaceProps {
  readonly caseId: string;
  readonly caseNumber: string;
  readonly currentVersionId: string;
  readonly recordVersion: number;
  readonly currentUserId: string;
  readonly targetOptions: readonly CapaActionPlanTargetOption[];
  readonly onAuthoritativeRefresh: () => Promise<void>;
}

const BASELINE_ACTION_TYPES = new Set<string>(CAPA_ACTION_TYPES);
const ACTION_TYPE_LABELS: Readonly<Record<string, string>> = {
  corrective: "Corrective",
  preventive: "Preventive",
  correction: "Correction",
  containment: "Containment",
};
const ACTION_STATUS_LABELS: Readonly<Record<string, string>> = {
  planned: "Planned",
  approved: "Approved",
  in_progress: "In progress",
  implemented: "Implemented",
  verified: "Verified",
  cancelled: "Cancelled",
  overdue: "Overdue",
};
const BLOCKER_LABELS: Readonly<Record<string, string>> = {
  EMPTY_ACTION_PLAN: "Add at least one action.",
  UNLINKED_ACTION: "Link each action to an authoritative cause, contributing factor, risk, or gap.",
  MISSING_ACTION_TYPE: "Choose an action type.",
  MISSING_ACTION_DESCRIPTION: "Describe each action.",
  UNASSIGNED_ACTION: "Assign an owner to each action.",
  MISSING_ACTION_DUE_DATE: "Set a due date for each action.",
  MISSING_ACTION_DELIVERABLE: "Describe the deliverable for each action.",
  MISSING_IMPLEMENTATION_EVIDENCE: "Describe the planned implementation evidence.",
  MISSING_UNINTENDED_CONSEQUENCE_ASSESSMENT: "Record the unintended-consequence assessment.",
  MISSING_DEPENDENCY_TARGET: "Remove dependencies that do not identify a current action.",
  SELF_DEPENDENCY: "An action cannot depend on itself.",
  DEPENDENCY_CYCLE: "Dependencies must not form a cycle.",
  AI_PROPOSAL_NOT_HUMAN_ADOPTED: "Human-authored action content is required before review.",
  MISSING_REQUIRED_EFFECTIVENESS_CHECK: "Add an effectiveness check for each required action.",
  MISSING_EFFECTIVENESS_ACCEPTANCE_CRITERIA: "Add acceptance criteria to the required effectiveness check.",
  INVALID_EFFECTIVENESS_ACTION_REFERENCE: "Effectiveness checks must reference current actions.",
};

function newId(): string {
  return crypto.randomUUID();
}

function humanProvenance() {
  return { source_type: "human" as const, source_reference: null, adopted_by_user_id: null, adopted_at: null };
}

function emptyPlan(): CapaActionPlanContent {
  return { items: [], effectiveness_checks: [] };
}

function newActionItem(): CapaActionPlanItem {
  return {
    item_id: newId(), action_type: null, description: null, linked_targets: [], owner_user_id: null,
    due_date: null, status: "planned", deliverable: null, implementation_evidence: null,
    dependency_item_ids: [], unintended_consequence_assessment: null, effectiveness_check_required: false,
    draft_provenance: humanProvenance(),
  };
}

function newEffectivenessCheck(itemId: string): CapaActionPlanEffectivenessCheck {
  return {
    check_id: newId(), action_item_ids: [itemId], acceptance_criteria: null, evaluation_method: null,
    data_source: null, timing: null, responsible_role: null, sample_or_rationale: null,
    draft_provenance: humanProvenance(),
  };
}

function textOrNull(value: string): string | null {
  return value.length === 0 ? null : value;
}

function updateAction(plan: CapaActionPlanContent, itemId: string, patch: Partial<CapaActionPlanItem>): CapaActionPlanContent {
  return { ...plan, items: plan.items.map((item) => item.item_id === itemId ? { ...item, ...patch } : item) };
}

function updateCheck(plan: CapaActionPlanContent, checkId: string, patch: Partial<CapaActionPlanEffectivenessCheck>): CapaActionPlanContent {
  return { ...plan, effectiveness_checks: plan.effectiveness_checks.map((check) => check.check_id === checkId ? { ...check, ...patch } : check) };
}

function fieldValue(value: string | null): string {
  return value ?? "";
}

function draftFromWorkspace(workspace: CapaActionPlanWorkspaceProjection | null): { readonly plan: CapaActionPlanContent; readonly revision: number | null } {
  return workspace === null ? { plan: emptyPlan(), revision: null } : { plan: workspace.action_plan, revision: workspace.draft_revision };
}

export default function CapaActionPlanWorkspace({ caseId, caseNumber, currentVersionId, recordVersion, currentUserId, targetOptions, onAuthoritativeRefresh }: CapaActionPlanWorkspaceProps) {
  const [plan, setPlan] = useState<CapaActionPlanContent>(() => emptyPlan());
  const [draftRevision, setDraftRevision] = useState<number | null>(null);
  const [caseVersionId, setCaseVersionId] = useState<string | null>(currentVersionId);
  const [authoritativeRecordVersion, setAuthoritativeRecordVersion] = useState<number>(recordVersion);
  const [loadStatus, setLoadStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [saveStatus, setSaveStatus] = useState<"loading" | "saved" | "unsaved" | "saving" | "conflict" | "failed">("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [customTarget, setCustomTarget] = useState<Record<string, { target_type: CapaActionLinkTargetType; target_id: string }>>({});

  const readiness = useMemo(() => evaluateCapaActionPlanReadiness(plan), [plan]);
  const actionIds = useMemo(() => plan.items.map((item) => item.item_id), [plan.items]);

  async function hydrate() {
    setLoadStatus("loading"); setSaveStatus("loading"); setMessage(null);
    const result = await loadActionPlanWorkspace(caseId);
    if (result.status === "failed") { setLoadStatus("failed"); setSaveStatus("failed"); setMessage(result.message); return; }
    const next = draftFromWorkspace(result.workspace);
    setPlan(next.plan); setDraftRevision(next.revision); setCaseVersionId(result.workspace?.case_version_id ?? currentVersionId); setAuthoritativeRecordVersion(result.workspace?.record_version ?? recordVersion); setLoadStatus("ready"); setSaveStatus("saved");
  }

  useEffect(() => { void hydrate(); }, [caseId]);

  function changePlan(next: CapaActionPlanContent) {
    setPlan(next); setSaveStatus("unsaved"); setMessage(null);
  }

  function updateItem(itemId: string, patch: Partial<CapaActionPlanItem>) {
    changePlan(updateAction(plan, itemId, patch));
  }

  function removeItem(itemId: string) {
    changePlan({
      items: plan.items.filter((item) => item.item_id !== itemId),
      effectiveness_checks: plan.effectiveness_checks
        .map((check) => ({ ...check, action_item_ids: check.action_item_ids.filter((id) => id !== itemId) }))
        .filter((check) => check.action_item_ids.length > 0),
    });
  }

  function toggleEffectiveness(item: CapaActionPlanItem, required: boolean) {
    let next = updateAction(plan, item.item_id, { effectiveness_check_required: required });
    if (required && !plan.effectiveness_checks.some((check) => check.action_item_ids.includes(item.item_id))) {
      next = { ...next, effectiveness_checks: [...next.effectiveness_checks, newEffectivenessCheck(item.item_id)] };
    }
    changePlan(next);
  }

  function addTarget(item: CapaActionPlanItem) {
    const selected = customTarget[item.item_id] ?? (targetOptions[0] === undefined ? undefined : { target_type: targetOptions[0].target_type, target_id: targetOptions[0].target_id });
    if (selected === undefined || item.linked_targets.some((target) => target.target_type === selected.target_type && target.target_id === selected.target_id)) return;
    updateItem(item.item_id, { linked_targets: [...item.linked_targets, { ...selected, rationale: "" }] });
  }

  async function save() {
    const validation = validateCapaActionPlan(plan);
    if (validation.status !== "valid") { setSaveStatus("failed"); setMessage("The action plan is not structurally valid yet."); return; }
    setSaveStatus("saving"); setMessage(null);
    const result = await saveActionPlanWorkspace(caseId, { expected_draft_revision: draftRevision, action_plan: validation.value });
    if (result.status === "saved") { setPlan(result.workspace.action_plan); setDraftRevision(result.workspace.draft_revision); setSaveStatus("saved"); setMessage("Action Planning workspace saved."); return; }
    setSaveStatus(result.code === "WORKSPACE_DRAFT_CONCURRENCY_CONFLICT" || result.code === "WORKFLOW_MUTATION_DETECTED" ? "conflict" : "failed");
    setMessage(result.message);
  }

  const editingDisabled = loadStatus !== "ready" || saveStatus === "saving" || saveStatus === "conflict";

  return <section aria-labelledby="action-plan-workspace-heading" className="mt-8 rounded-3xl border border-blue-400/20 bg-blue-500/[0.05] p-5 sm:p-7">
    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-300">S60 · Human-controlled draft workspace</p>
    <h2 id="action-plan-workspace-heading" className="mt-2 text-2xl font-semibold text-zinc-100">Action Planning</h2>
    <p className="mt-3 text-sm leading-6 text-zinc-400">Plan actions for {caseNumber}. This workspace remains a draft until the controlled Action Plan Review submission step is enabled.</p>

    {message !== null ? <div role={saveStatus === "failed" || saveStatus === "conflict" ? "alert" : "status"} className="mt-5 rounded-xl border border-amber-400/25 bg-amber-500/10 p-3 text-sm text-amber-100">{message}
      {saveStatus === "conflict" ? <div className="mt-3 flex flex-wrap gap-3"><button type="button" onClick={() => void hydrate()} className="underline">Reload workspace</button><button type="button" onClick={() => void onAuthoritativeRefresh()} className="underline">Reload authoritative CAPA</button></div> : null}
    </div> : null}
    {loadStatus === "loading" ? <p role="status" className="mt-5 text-sm text-zinc-400">Loading durable Action Planning workspace…</p> : null}
    {loadStatus === "failed" ? <button type="button" onClick={() => void hydrate()} className="mt-4 text-sm text-blue-200 underline">Retry workspace load</button> : null}

    {caseVersionId !== null ? <CapaActionPlanAdvisoryPanel caseId={caseId} caseVersionId={caseVersionId} recordVersion={authoritativeRecordVersion} /> : null}

    <div className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-950/40 p-4">
      <p className="text-sm font-semibold text-zinc-100">Readiness for Action Plan Review</p>
      {readiness.status === "ready_for_review" ? <p className="mt-2 text-sm text-emerald-200">Ready for Action Plan Review</p> : <>
        <p className="mt-2 text-sm text-amber-200">Not ready for Action Plan Review</p>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-zinc-400">{readiness.blocker_codes.map((code) => <li key={code}>{BLOCKER_LABELS[code] ?? code}</li>)}</ul>
      </>}
      <p className="mt-3 text-xs text-zinc-500">Submission to Action Plan Review will become available when the controlled submission step is enabled.</p>
    </div>

    <div className="mt-6 min-w-0 space-y-5">{plan.items.map((item, index) => {
      const customType = item.action_type !== null && !BASELINE_ACTION_TYPES.has(item.action_type);
      const selectedTarget = customTarget[item.item_id] ?? { target_type: targetOptions[0]?.target_type ?? "cause", target_id: targetOptions[0]?.target_id ?? "" };
      return <fieldset key={item.item_id} disabled={editingDisabled} className="min-w-0 w-full rounded-2xl border border-zinc-800 bg-zinc-950/55 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3"><legend className="font-semibold text-zinc-100">Action {index + 1}</legend><span className="text-xs text-zinc-500">Human-authored draft</span><button type="button" onClick={() => removeItem(item.item_id)} className="text-sm text-red-300">Remove action</button></div>
        <div className="mt-4 grid min-w-0 gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <label className="text-sm text-zinc-300">Action type<select value={customType ? "__custom__" : item.action_type ?? ""} onChange={(event) => updateItem(item.item_id, { action_type: event.target.value === "__custom__" || event.target.value === "" ? (event.target.value === "__custom__" ? item.action_type : null) : event.target.value })} className="mt-2 min-h-11 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 text-zinc-100"><option value="">Select a type</option>{CAPA_ACTION_TYPES.map((type) => <option key={type} value={type}>{ACTION_TYPE_LABELS[type]}</option>)}<option value="__custom__">Custom controlled code</option></select>{customType || item.action_type === null ? <input aria-label="Custom action type code" value={customType ? item.action_type ?? "" : ""} onChange={(event) => updateItem(item.item_id, { action_type: textOrNull(event.target.value) })} placeholder="Organization-approved code" className="mt-2 min-h-11 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 text-zinc-100" /> : null}</label>
          <label className="text-sm text-zinc-300">Action item status<select value={item.status} onChange={(event) => updateItem(item.item_id, { status: event.target.value as CapaActionPlanItem["status"] })} className="mt-2 min-h-11 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 text-zinc-100">{CAPA_ACTION_STATUSES.map((status) => <option key={status} value={status}>{ACTION_STATUS_LABELS[status]}</option>)}</select><span className="mt-1 block text-xs text-zinc-500">Status is planning metadata; “Approved” is not G-05 approval.</span></label>
          <label className="text-sm text-zinc-300 sm:col-span-2">Description<textarea value={fieldValue(item.description)} onChange={(event) => updateItem(item.item_id, { description: textOrNull(event.target.value) })} className="mt-2 min-h-20 w-full rounded-xl border border-zinc-700 bg-zinc-950 p-3 text-zinc-100" /></label>
          <label className="text-sm text-zinc-300">Owner<select value={item.owner_user_id ?? ""} onChange={(event) => updateItem(item.item_id, { owner_user_id: textOrNull(event.target.value) })} className="mt-2 min-h-11 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 text-zinc-100"><option value="">Unassigned</option><option value={currentUserId}>Assign to me</option></select></label>
          <label className="text-sm text-zinc-300">Due date<input type="date" value={fieldValue(item.due_date)} onChange={(event) => updateItem(item.item_id, { due_date: textOrNull(event.target.value) })} className="mt-2 min-h-11 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 text-zinc-100" /></label>
          {(["deliverable", "implementation_evidence", "unintended_consequence_assessment"] as const).map((field) => <label key={field} className="text-sm text-zinc-300 sm:col-span-2">{field === "implementation_evidence" ? "Implementation evidence plan" : field === "unintended_consequence_assessment" ? "Unintended consequence assessment" : "Deliverable"}<textarea value={fieldValue(item[field])} onChange={(event) => updateItem(item.item_id, { [field]: textOrNull(event.target.value) })} className="mt-2 min-h-20 w-full rounded-xl border border-zinc-700 bg-zinc-950 p-3 text-zinc-100" /></label>)}
        </div>

        <div className="mt-5 rounded-xl border border-zinc-800 p-3"><p className="text-sm font-semibold text-zinc-200">Linked authoritative targets</p>{item.linked_targets.map((target, targetIndex) => <div key={`${target.target_type}:${target.target_id}`} className="mt-3 grid gap-2 sm:grid-cols-[180px_minmax(0,1fr)_auto]"><span className="rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-300">{target.target_type}: {target.target_id}</span><input value={target.rationale} onChange={(event) => updateItem(item.item_id, { linked_targets: item.linked_targets.map((candidate, index) => index === targetIndex ? { ...candidate, rationale: event.target.value } : candidate) })} placeholder="Why this target is linked" className="min-h-10 rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100" /><button type="button" onClick={() => updateItem(item.item_id, { linked_targets: item.linked_targets.filter((_candidate, index) => index !== targetIndex) })} className="text-sm text-red-300">Remove</button></div>)}{targetOptions.length === 0 ? <p className="mt-3 text-xs text-zinc-500">No authoritative root-cause or evidence targets are available for selection.</p> : <div className="mt-3 flex flex-col gap-2 sm:flex-row"><select aria-label="Target to link" value={`${selectedTarget.target_type}:${selectedTarget.target_id}`} onChange={(event) => { const [target_type, ...id] = event.target.value.split(":"); setCustomTarget((current) => ({ ...current, [item.item_id]: { target_type: target_type as CapaActionLinkTargetType, target_id: id.join(":") } })); }} className="min-h-10 min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100">{targetOptions.map((target) => <option key={`${target.target_type}:${target.target_id}`} value={`${target.target_type}:${target.target_id}`}>{target.label}</option>)}</select><button type="button" onClick={() => addTarget(item)} className="min-h-10 rounded-lg border border-zinc-700 px-3 text-sm text-zinc-200">Add linked target</button></div>}</div>

        <div className="mt-5 rounded-xl border border-zinc-800 p-3"><p className="text-sm font-semibold text-zinc-200">Dependencies</p>{plan.items.length < 2 ? <p className="mt-2 text-xs text-zinc-500">Add another action to define a dependency.</p> : <div className="mt-2 flex flex-wrap gap-3">{plan.items.filter((candidate) => candidate.item_id !== item.item_id).map((candidate) => <label key={candidate.item_id} className="text-sm text-zinc-400"><input type="checkbox" checked={item.dependency_item_ids.includes(candidate.item_id)} onChange={(event) => updateItem(item.item_id, { dependency_item_ids: event.target.checked ? [...item.dependency_item_ids, candidate.item_id] : item.dependency_item_ids.filter((id) => id !== candidate.item_id) })} /> Action {plan.items.findIndex((entry) => entry.item_id === candidate.item_id) + 1}</label>)}</div>}</div>

        <label className="mt-5 flex items-center gap-3 text-sm text-zinc-300"><input type="checkbox" checked={item.effectiveness_check_required} onChange={(event) => toggleEffectiveness(item, event.target.checked)} /> Effectiveness check required</label>
      </fieldset>;
    })}</div>

    <div className="mt-5 flex flex-wrap gap-3"><button type="button" disabled={editingDisabled} onClick={() => changePlan({ ...plan, items: [...plan.items, newActionItem()] })} className="min-h-11 rounded-xl border border-zinc-700 px-4 text-sm text-zinc-100 disabled:opacity-50">Add action</button><button type="button" disabled={editingDisabled || plan.items.length === 0} onClick={() => changePlan({ ...plan, effectiveness_checks: [...plan.effectiveness_checks, newEffectivenessCheck(plan.items[0]!.item_id)] })} className="min-h-11 rounded-xl border border-zinc-700 px-4 text-sm text-zinc-100 disabled:opacity-50">Add effectiveness check</button></div>

    {plan.effectiveness_checks.length > 0 ? <div className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-950/40 p-4"><h3 className="font-semibold text-zinc-100">Effectiveness planning</h3>{plan.effectiveness_checks.map((check, index) => <fieldset key={check.check_id} disabled={editingDisabled} className="mt-4 rounded-xl border border-zinc-800 p-3"><legend className="text-sm text-zinc-300">Check {index + 1}</legend><div className="mt-2 flex flex-wrap gap-3 text-sm text-zinc-400">{plan.items.map((item) => <label key={item.item_id}><input type="checkbox" checked={check.action_item_ids.includes(item.item_id)} onChange={(event) => changePlan(updateCheck(plan, check.check_id, { action_item_ids: event.target.checked ? [...check.action_item_ids, item.item_id] : check.action_item_ids.filter((id) => id !== item.item_id) }))} /> Action {plan.items.indexOf(item) + 1}</label>)}</div><div className="mt-3 grid gap-3 sm:grid-cols-2">{(["acceptance_criteria", "evaluation_method", "data_source", "timing", "responsible_role", "sample_or_rationale"] as const).map((field) => <label key={field} className="text-sm text-zinc-300">{field.replaceAll("_", " ")}<textarea value={fieldValue(check[field])} onChange={(event) => changePlan(updateCheck(plan, check.check_id, { [field]: textOrNull(event.target.value) }))} className="mt-2 min-h-16 w-full rounded-lg border border-zinc-700 bg-zinc-950 p-2 text-zinc-100" /></label>)}</div><button type="button" onClick={() => changePlan({ ...plan, effectiveness_checks: plan.effectiveness_checks.filter((candidate) => candidate.check_id !== check.check_id) })} className="mt-3 text-sm text-red-300">Remove check</button></fieldset>)}</div> : null}

    <div className="mt-6 flex flex-wrap items-center justify-between gap-3"><p role="status" className="text-sm text-zinc-400">{saveStatus === "saved" ? `Saved${draftRevision === null ? " · new workspace" : ` · draft revision ${draftRevision}`}` : saveStatus === "saving" ? "Saving…" : saveStatus === "unsaved" ? "Unsaved changes" : ""}</p><button type="button" disabled={editingDisabled || saveStatus !== "unsaved"} onClick={() => void save()} className="min-h-11 rounded-xl bg-blue-600 px-5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">Save Action Planning draft</button></div>
  </section>;
}
