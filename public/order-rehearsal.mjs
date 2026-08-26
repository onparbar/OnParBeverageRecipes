function cloneIssues(items = []) {
  return items.map((item) => ({ ...item }));
}

function cloneDraft(draft = {}) {
  return {
    ...draft,
    lines: (draft.lines || []).map((line) => ({
      ...line,
      blockers: cloneIssues(line.blockers),
      warnings: cloneIssues(line.warnings),
    })),
    blockers: cloneIssues(draft.blockers),
    warnings: cloneIssues(draft.warnings),
  };
}

export function buildOrderRehearsalModel(sourceModel = {}) {
  const drafts = (sourceModel.drafts || []).map(cloneDraft);
  const savedDrafts = drafts.map((draft) => ({
    id: draft.id,
    generatedAt: draft.generatedAt,
    vendor: draft.vendor,
    createdBy: "Rehearsal",
    createdAt: "rehearsal",
    approvedBy: "Rehearsal",
    approvedAt: "rehearsal",
    status: "reviewed",
    rehearsal: true,
  }));
  return {
    ...sourceModel,
    rehearsal: true,
    schedule: {
      ...(sourceModel.schedule || {}),
      status: "rehearsal",
      label: "Rehearsal",
    },
    drafts,
    savedDrafts,
    canApproveAll: drafts.length > 0 && drafts.every((draft) => !(draft.blockers || []).length),
  };
}
