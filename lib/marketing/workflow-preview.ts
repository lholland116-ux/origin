export const WORKFLOW_PREVIEW_NOTICE =
  "Illustrative Workflow Preview — Customer-facing execution is in development." as const;

export const CAPA_WORKFLOW_PREVIEW_STAGES = [
  {
    key: "quality-signal",
    title: "Quality Signal",
    summary: "A fictional monthly example shows 6 flagged observations in 120 simulated inspections.",
    outputLabel: "Illustrative signal",
    output: "6 / 120 simulated inspections were flagged for human review. This example is not a validated defect rate or a risk score.",
  },
  {
    key: "intelligence-report",
    title: "Intelligence Report",
    summary: "A report organizes the observation, calculation assumptions, data limitations, and source references.",
    outputLabel: "Report section",
    output: "Observed pattern: the fictional sample contains repeated flags in one category. Cause is undetermined. Sample size and mapping assumptions are shown alongside the observation.",
  },
  {
    key: "human-review",
    title: "Human Review",
    summary: "A qualified reviewer checks the context and chooses whether any controlled follow-up is appropriate.",
    outputLabel: "Example reviewer decision",
    output: "Review status: needs human assessment. An AI suggestion cannot approve evidence, assign cause, or make a disposition.",
  },
  {
    key: "capa-draft",
    title: "CAPA Draft",
    summary: "Only after an explicit authorized human decision could an illustrative draft be prepared for review.",
    outputLabel: "Draft status",
    output: "Draft only — not submitted, approved, or advanced. A responsible person must verify and control any CAPA record.",
  },
  {
    key: "investigation",
    title: "Investigation",
    summary: "People gather and evaluate evidence using their organization's approved process.",
    outputLabel: "Investigation prompt",
    output: "Possible questions: What records are relevant? What additional evidence is needed? Which assumptions should be checked? No cause is concluded in this preview.",
  },
  {
    key: "action-planning",
    title: "Action Planning",
    summary: "A team may draft and review proposed actions after its own investigation and governance steps.",
    outputLabel: "Planning reminder",
    output: "Any proposed action requires qualified human review, authorization, and completion through the organization's controlled process.",
  },
] as const;
