'use client';
import { useState } from 'react';
import { api, date, useApi } from '@/lib/api';
import { Button, FormModal, Loaded, PageHead, Status, Table } from '@/components/ui';
export default function Help() {
  const list = useApi<any[]>('/influencer/disputes');
  const subs = useApi<any[]>('/influencer/submissions');
  const [open, setOpen] = useState(false);
  return (
    <>
      <PageHead title="Help and disputes" intro="Think a check got your post wrong? Raise a ticket and your store or an admin will look into it."
        action={<Button kind="primary" onClick={() => setOpen(true)}>Raise a ticket</Button>} />
      <Loaded state={list}>
        <Table rows={list.data} rowKey={(r) => r.id} empty="You have no tickets."
          cols={[
            { head: 'Issue', cell: (r) => <div className="max-w-lg text-left"><div className="font-semibold">{r.subject}</div><p className="text-muted">{r.description}</p>{r.resolution_note && <p className="mt-1">Reply: {r.resolution_note}</p>}</div> },
            { head: 'Raised', cell: (r) => date(r.created_at) },
            { head: 'Status', cell: (r) => r.status === 'OPEN' ? <Status value="PENDING" /> : <Status value={r.status} /> },
          ]} />
      </Loaded>
      {open && <FormModal title="Raise a ticket" submit="Send ticket" onClose={() => setOpen(false)}
        fields={[
          { name: 'submissionId', label: 'Which post is it about?', type: 'select', options: subs.data?.map((s) => ({ value: s.id, label: `${s.campaign} (${date(s.submitted_at)})` })), hint: 'Leave empty for a general question.' },
          { name: 'subject', label: 'Subject', required: true },
          { name: 'description', label: 'What happened?', type: 'textarea', required: true, hint: 'Include your insights numbers if they differ from what we show.' },
        ]}
        onSubmit={async (v) => { await api('/influencer/disputes', 'POST', { submissionId: v.submissionId || undefined, subject: v.subject, description: v.description }); await list.reload(); }} />}
    </>
  );
}
