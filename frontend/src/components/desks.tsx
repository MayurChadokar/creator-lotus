'use client';
// Post and dispute desks for admins.
import { useState } from 'react';
import { api, count, date, percent, useApi } from '@/lib/api';
import { Button, Field, FormModal, Loaded, Status, Table, useAct } from './ui';

export function SubmissionDesk({ base, canWaive }: { base: string; canWaive: boolean }) {
  const [filter, setFilter] = useState('');
  const list = useApi<any[]>(`${base}/submissions${filter ? `?status=${filter}` : ''}`);
  const [dialog, setDialog] = useState<{ type: 'reject' | 'force' | 'ad'; row: any } | null>(null);
  const { busy, run } = useAct();
  const FILTERS = [['', 'All'], ['MEASURING', 'Collecting views'], ['RESTRICTED', 'Needs review'], ['APPROVED', 'Approved'], ['REJECTED', 'Rejected'], ['PENDING_VERIFICATION', 'Check failed']];
  return (
    <>
      <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Filter by status">
        {FILTERS.map(([v, l]) => (
          <button key={v} onClick={() => setFilter(v!)} aria-pressed={filter === v}
            className={`min-h-[36px] rounded-full border px-3 text-sm font-medium ${filter === v ? 'border-ink bg-ink text-white' : 'border-line bg-white'}`}>{l}</button>
        ))}
      </div>
      <Loaded state={list}>
        <Table rows={list.data} rowKey={(r) => r.id} empty="No submissions here yet."
          cols={[
            { head: 'Creator', cell: (r) => <><div className="font-semibold">{r.creator}</div><a className="text-link underline" href={r.post_url} target="_blank" rel="noreferrer">Open post</a></> },
            { head: 'Campaign', cell: (r) => r.campaign },
            { head: 'Views', right: true, cell: (r) => count(r.views) },
            { head: 'Engagement', right: true, cell: (r) => r.engagement_bps !== null ? percent(r.engagement_bps) : (r.views && r.likes !== null && r.comments !== null ? percent(Math.floor(((r.likes + r.comments) * 10000) / r.views)) : '-') },
            { head: 'Status', cell: (r) => <div className="max-w-[16rem]"><Status value={r.status} />{r.status_reason && <p className="mt-1 text-left text-xs text-muted">{r.status_reason}</p>}</div> },
            { head: 'Content', cell: (r) => (['NOT_LIVE', 'WITHDRAWN'].includes(r.status) && r.content_review === 'PENDING') ? '-' : <Status value={r.content_review} /> },
            { head: '', cell: (r) => (
              <div className="flex flex-wrap justify-end gap-1.5">
                {['PENDING_VERIFICATION', 'MEASURING', 'RESTRICTED'].includes(r.status) && r.content_review === 'PENDING' && (
                  <Button busy={busy} onClick={() => run(async () => { await api(`${base}/submissions/${r.id}/content-review`, 'POST', { decision: 'APPROVED' }); await list.reload(); }, 'Content approved')}>Approve content</Button>
                )}
                {['PENDING_VERIFICATION', 'MEASURING', 'RESTRICTED'].includes(r.status) && <Button kind="danger" onClick={() => setDialog({ type: 'reject', row: r })}>Reject</Button>}
                {['RESTRICTED', 'REJECTED', ...(canWaive ? ['PENDING_VERIFICATION', 'MEASURING'] : [])].includes(r.status) && <Button onClick={() => setDialog({ type: 'force', row: r })}>Force approve</Button>}
                {['APPROVED', 'IN_BATCH', 'PAID'].includes(r.status) && <Button onClick={() => setDialog({ type: 'ad', row: r })}>Request ad rights</Button>}
              </div>
            ) },
          ]} />
      </Loaded>
      {dialog?.type === 'reject' && <FormModal title={`Reject ${dialog.row.creator}'s post`} submit="Reject post" danger onClose={() => setDialog(null)}
        intro="The creator will see this reason and receive no payment for this post."
        fields={[{ name: 'reason', label: 'Reason', type: 'textarea', required: true }]}
        onSubmit={async (v) => { await api(`${base}/submissions/${dialog.row.id}/content-review`, 'POST', { decision: 'REJECTED', reason: v.reason }); await list.reload(); }} />}
      {dialog?.type === 'force' && <FormModal title={`Force approve ${dialog.row.creator}'s post`} submit="Force approve" onClose={() => setDialog(null)}
        intro="This is logged with your name. A post confirmed deleted can never be approved."
        fields={[
          { name: 'reason', label: 'Reason', type: 'textarea', required: true },
          ...(canWaive ? [{ name: 'manualViews', label: 'Views you confirmed by hand', type: 'number', min: 0, hint: 'Only needed when the platform cannot be checked.' } as Field] : []),
        ]}
        onSubmit={async (v) => { await api(`${base}/submissions/${dialog.row.id}/force-approve`, 'POST', { reason: v.reason, manualViews: v.manualViews === '' || v.manualViews === undefined ? undefined : Number(v.manualViews) }); await list.reload(); }} />}
      {dialog?.type === 'ad' && <FormModal title="Request paid ad rights" submit="Send request" onClose={() => setDialog(null)}
        intro={`${dialog.row.creator} must accept before the rights begin.`}
        fields={[{ name: 'days', label: 'Length', type: 'select', required: true, options: [{ value: '30', label: '30 days' }, { value: '90', label: '90 days' }] }]}
        onSubmit={async (v) => { await api(`${base}/submissions/${dialog.row.id}/ad-request`, 'POST', { durationDays: Number(v.days) }); await list.reload(); }} />}
    </>
  );
}

export function DisputeDesk({ base, canWaive }: { base: string; canWaive: boolean }) {
  const list = useApi<any[]>(`${base}/disputes`);
  const [open, setOpen] = useState<any>(null);
  return (
    <Loaded state={list}>
      <Table rows={list.data} rowKey={(r) => r.id} empty="No dispute tickets. Tickets creators raise will appear here."
        cols={[
          { head: 'Creator', cell: (r) => <span className="font-semibold">{r.creator}</span> },
          { head: 'Issue', cell: (r) => <div className="max-w-md text-left"><div className="font-medium">{r.subject}</div><p className="text-muted">{r.description}</p>{r.resolution_note && <p className="mt-1 text-left">Resolution: {r.resolution_note}</p>}</div> },
          { head: 'Raised', cell: (r) => date(r.created_at) },
          { head: 'Status', cell: (r) => r.status === 'OPEN' ? <Status value="PENDING" /> : <Status value={r.status} /> },
          { head: '', cell: (r) => r.status === 'OPEN' && <Button onClick={() => setOpen(r)}>Resolve</Button> },
        ]} />
      {open && <FormModal title={`Resolve: ${open.subject}`} submit="Save resolution" onClose={() => setOpen(null)}
        fields={[
          { name: 'outcome', label: 'Decision', type: 'select', required: true, options: [{ value: 'uphold', label: "Uphold: the creator is right" }, { value: 'deny', label: 'Deny' }] },
          ...(open.submission_id ? [{ name: 'force', label: 'Also force approve the linked post for payment', type: 'checkbox', show: (v: any) => v.outcome === 'uphold', hint: 'Logged with your name. Refused if the post is confirmed deleted.' } as Field] : []),
          ...(canWaive && open.submission_id ? [{ name: 'views', label: 'Views you confirmed by hand', type: 'number', min: 0, show: (v: any) => !!v.force, hint: 'Only needed when the platform cannot be checked.' } as Field] : []),
          { name: 'note', label: 'Note to the creator', type: 'textarea', required: true },
        ]}
        onSubmit={async (v) => {
          await api(`${base}/disputes/${open.id}/resolve`, 'POST', { uphold: v.outcome === 'uphold', forceApprove: !!v.force && v.outcome === 'uphold', note: v.note, manualViews: v.views ? Number(v.views) : undefined });
          await list.reload();
        }} />}
    </Loaded>
  );
}
