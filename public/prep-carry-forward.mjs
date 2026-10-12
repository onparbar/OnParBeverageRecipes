// A carry-forward acknowledgement closes the old prep reminder, not its history.
export function buildPriorWeekWorkAlert(prior, completion, current, acknowledgements = {}) {
  if (!prior || !completion) return null;
  const moved = acknowledgements[prior.id];
  const prepCarried = moved?.fromSnapshotId === prior.id && Boolean(moved?.toSnapshotId)
    && moved.toSnapshotId !== prior.id && Boolean(moved.acknowledgedAt);
  const deliveries = completion.deliveryChecked < completion.deliveryTotal;
  const prep = completion.cocktailCompleted < completion.cocktailTotal && !prepCarried;
  if (!deliveries && !prep) return null;
  return {
    id: 'prior-week-checkoffs-incomplete', severity: 'warning', priority: 57,
    title: 'Last week still has unchecked work',
    message: [
      deliveries ? `Deliveries: ${completion.deliveryChecked} of ${completion.deliveryTotal} checked.` : '',
      prep ? `Cocktails: ${completion.cocktailCompleted} of ${completion.cocktailTotal} prepared.` : '',
    ].filter(Boolean).join(' '),
    details: [],
    action: { label: 'Open Weekly Snapshots', target: 'weekly-snapshots' },
    ...(prep && current?.id && current.id !== prior.id ? {
      actionLabel: 'Prep moved to this week',
      action: { target: `prep-carried-forward:${encodeURIComponent(prior.id)}` },
    } : {}),
  };
}
