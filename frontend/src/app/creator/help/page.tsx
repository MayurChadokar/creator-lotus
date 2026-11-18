'use client';
import { useState } from 'react';
import { api, date, useApi } from '@/lib/api';
import { Button, FormModal, Loaded, Status, Table } from '@/components/ui';
import { CreatorPageHead } from '@/components/CreatorPageHead';
export default function Help() {
  const list = useApi<any[]>('/influencer/disputes');
  const subs = useApi<any[]>('/influencer/submissions');
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="mx-auto max-w-6xl">
      <CreatorPageHead eyebrow="Creator support" title="Help and disputes" intro="Have a question or need a post reviewed? Your store or an admin can help."
        action={<Button kind="primary" onClick={() => setOpen(true)}>Raise a ticket</Button>} />
      <div className="rounded-2xl border border-[#dce7ef] bg-white p-5 shadow-sm sm:p-6">
      <div className="mb-4"><h2 className="text-lg font-semibold text-[#17365a]">Your tickets</h2><p className="mt-1 text-sm text-muted">View your requests and replies from the team.</p></div>
      <Loaded state={list}>
        <Table rows={list.data} rowKey={(r) => r.id} empty="You have no tickets."
          cols={[
            { head: 'Issue', cell: (r) => <div className="max-w-lg text-left"><div className="font-semibold">{r.subject}</div><p className="text-muted">{r.description}</p>{r.resolution_note && <p className="mt-1">Reply: {r.resolution_note}</p>}</div> },
            { head: 'Raised', cell: (r) => date(r.created_at) },
            { head: 'Status', cell: (r) => r.status === 'OPEN' ? <Status value="PENDING" /> : <Status value={r.status} /> },
          ]} />
      </Loaded>
      </div>
      {open && <FormModal title="Raise a ticket" submit="Send ticket" onClose={() => setOpen(false)}
        fields={[
          { name: 'submissionId', label: 'Which post is it about?', type: 'select', options: subs.data?.map((s) => ({ value: s.id, label: `${s.campaign} (${date(s.submitted_at)})` })), hint: 'Leave empty for a general question.' },
          { name: 'subject', label: 'Subject', required: true },
          { name: 'description', label: 'What happened?', type: 'textarea', required: true, hint: 'Include your insights numbers if they differ from what we show.' },
        ]}
        onSubmit={async (v) => { await api('/influencer/disputes', 'POST', { submissionId: v.submissionId || undefined, subject: v.subject, description: v.description }); await list.reload(); }} />}
      </div>
    </>
  );
}
