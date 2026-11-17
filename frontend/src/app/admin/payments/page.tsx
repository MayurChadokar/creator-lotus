'use client';
import { useState } from 'react';
import { api, count, date, download, rupees, toPaise, useApi } from '@/lib/api';
import { Button, Figure, FormModal, Loaded, Notice, PageHead, PriceTag, Section, Status, Table, useAct, useToast } from '@/components/ui';

export default function Payments() {
  const sum = useApi<any>('/admin/finance-summary');
  const queue = useApi<any[]>('/admin/payable-queue');
  const batches = useApi<any[]>('/admin/payment-batches');
  const [openId, setOpenId] = useState<string | null>(null);
  const [held, setHeld] = useState<any[]>([]);
  const [redo, setRedo] = useState<any>(null);
  const benefits = useApi<any[]>('/admin/benefits');
  const creators = useApi<any[]>('/admin/influencers');
  const [benefit, setBenefit] = useState(false);
  const [voiding, setVoiding] = useState<any>(null);
  const { busy, run } = useAct();
  const toast = useToast();
  const reload = () => Promise.all([sum.reload(), queue.reload(), batches.reload()]);
  const names = Object.fromEntries((queue.data ?? []).map((q) => [q.id, q.creator]));
  return (
    <>
      <PageHead title="Payments and tax" intro="You pay from your own bank. Each post is re-checked before it goes on the bank file; a deleted post is never paid."
        action={<>
          <Button onClick={() => run(() => download('/admin/tax-report.csv', `tds-${sum.data?.taxYear}.csv`), 'TDS report downloaded')}>Download TDS report</Button>
          <Button kind="primary" busy={busy} onClick={() => run(async () => {
            const r = await api('/admin/payment-batches', 'POST');
            setHeld(r.held);
            if (!r.batchId) toast(r.held.length ? 'Nothing could go on a sheet: every payment is locked' : 'Nothing is waiting to be paid');
            else toast(`Payment sheet created with ${r.items} payment${r.items === 1 ? '' : 's'}`);
            await reload();
          })}>Create payment sheet</Button>
        </>} />
      <Loaded state={sum}>
        {sum.data && <div className="mb-8 flex flex-wrap items-center gap-x-8 gap-y-4">
          <PriceTag label="Waiting to be paid" amount={rupees(sum.data.queue_paise)} />
          <Figure label="Past the 3-day date" value={count(sum.data.overdue)} tone={sum.data.overdue > 0 ? 'bad' : undefined} />
          <Figure label="Net paid to date" value={rupees(sum.data.paid_paise, false)} />
          <Figure label={`TDS, tax year ${sum.data.taxYear}`} value={rupees(sum.data.tds_paise, false)} />
        </div>}
      </Loaded>
      {held.length > 0 && <Notice tone="bad">
        <strong>Left off the sheet:</strong>
        <ul className="mt-1 list-disc pl-5">{held.map((h) => <li key={h.earningId}>{names[h.earningId] ?? 'Creator'}: {h.reason}</li>)}</ul>
      </Notice>}
      {redo && <FormModal title="Download the bank file again?" submit="Download again" danger onClose={() => setRedo(null)}
        intro="Only do this if the first upload paid nobody. Uploading the same file twice pays everyone twice. This is logged with your name."
        fields={[{ name: 'reason', label: 'Why do you need it again?', required: true }]}
        onSubmit={async (v) => { await download(`/admin/payment-batches/${redo.id}/bank-file.xlsx?reExportReason=${encodeURIComponent(v.reason)}`, `${redo.reference}-bank-repeat.xlsx`); }} />}
      <Section title="Waiting for a payment sheet" intro="Payment is due within 3 working days of approval. Weekends and listed bank holidays do not count.">
        <Loaded state={queue}>
          <Table rows={queue.data} rowKey={(r) => r.id} empty="Nothing is waiting. Approved posts will appear here."
            cols={[
              { head: 'Creator', cell: (r) => <span className="font-semibold">{r.creator}</span> },
              { head: 'Gross', right: true, cell: (r) => rupees(r.gross_paise) },
              { head: 'Due by', cell: (r) => <span className={r.overdue ? 'font-semibold text-stop' : ''}>{date(r.payout_due_date)}{r.overdue ? ' (late)' : ''}</span> },
            ]} />
        </Loaded>
      </Section>
      <Section title="Payment sheets" intro="Steps: approve the sheet and prepare it (either admin can do both). Pay the bank file from your bank, then record each bank reference below.">
        <Loaded state={batches}>
          <Table rows={batches.data} rowKey={(r) => r.id} empty="No payment sheets yet."
            cols={[
              { head: 'Sheet', cell: (r) => <><div className="font-semibold">{r.reference}</div><div className="text-muted">For {date(r.scheduled_for)}</div></> },
              { head: 'Status', cell: (r) => <Status value={r.status} /> },
              { head: 'Payments', right: true, cell: (r) => count(r.items) },
              { head: 'Gross', right: true, cell: (r) => rupees(r.gross_paise) },
              { head: 'TDS', right: true, cell: (r) => rupees(r.tds_paise) },
              { head: 'Net', right: true, cell: (r) => <strong>{rupees(r.net_paise)}</strong> },
              { head: '', cell: (r) => (
                <div className="flex flex-wrap justify-end gap-1.5">
                  {r.status === 'DRAFT' && <Button kind="primary" busy={busy} onClick={() => run(async () => { await api(`/admin/payment-batches/${r.id}/approve`, 'POST'); await reload(); }, 'Sheet approved')}>Approve</Button>}
                  {r.status === 'APPROVED' && <Button kind="primary" busy={busy} onClick={() => run(async () => {
                    const x = await api(`/admin/payment-batches/${r.id}/release`, 'POST');
                    toast(`Prepared: ${x.ready} ready to pay, ${x.voided} cancelled, ${x.requeued} moved to the next sheet`);
                    setOpenId(r.id);
                    await reload();
                  })}>Prepare for bank</Button>}
                  {r.status === 'RELEASED' && <Button kind="primary" busy={busy} onClick={() => run(async () => {
                    const skipped = await download(`/admin/payment-batches/${r.id}/bank-file.xlsx`, `${r.reference}-bank.xlsx`);
                    toast(skipped > 0 ? `Bank file downloaded. ${skipped} payment${skipped === 1 ? '' : 's'} left out: unconfirmed details or a post that could not be checked.` : 'Bank file downloaded. Each payment goes on one file only.', skipped > 0);
                    await reload();
                  })}>Download bank file</Button>}
                  {r.status === 'RELEASED' && <Button onClick={() => setRedo(r)}>Download again</Button>}
                  <Button onClick={() => setOpenId(openId === r.id ? null : r.id)} aria-expanded={openId === r.id}>{openId === r.id ? 'Hide' : 'Details'}</Button>
                  <Button onClick={() => run(() => download(`/admin/payment-batches/${r.id}/report.csv`, `${r.reference}.csv`), 'CSV downloaded')}>CSV</Button>
                </div>
              ) },
            ]} />
        </Loaded>
        {openId && <SheetDetail id={openId} onChange={reload} key={openId + (batches.data?.find((b) => b.id === openId)?.status ?? '')} />}
      </Section>
      <Section title="Free products, gifts, travel (section 194R)" intro="Record anything of value given to a creator. TDS applies once their yearly total crosses the limit." action={<Button onClick={() => setBenefit(true)}>Record a benefit</Button>}>
        <Loaded state={benefits}>
          <Table rows={benefits.data} rowKey={(r) => r.id} empty="Nothing recorded. Demos happen in store, so this is only for anything a creator keeps."
            cols={[
              { head: 'Creator', cell: (r) => <span className="font-semibold">{r.creator}</span> },
              { head: 'What', cell: (r) => r.description },
              { head: 'Given on', cell: (r) => date(r.given_on) },
              { head: 'Value', right: true, cell: (r) => rupees(r.value_paise) },
              { head: 'TDS', right: true, cell: (r) => rupees(r.tds_paise) },
              { head: 'Taken from pay', right: true, cell: (r) => r.recover_from_payout ? rupees(r.recovered_paise) : 'Company pays' },
              { head: 'Status', cell: (r) => r.status === 'OPEN' ? <Status value="PENDING" /> : r.status === 'VOID' ? <Status value="VOID" /> : <Status value="SETTLED" /> },
              { head: '', cell: (r) => r.status !== 'VOID' && r.recovered_paise === 0 && <Button onClick={() => setVoiding(r)}>Cancel</Button> },
            ]} />
        </Loaded>
      </Section>
      {benefit && <FormModal title="Record a benefit" submit="Save benefit" onClose={() => setBenefit(false)}
        fields={[
          { name: 'influencerId', label: 'Creator', type: 'select', required: true, options: (creators.data ?? []).map((c) => ({ value: c.user_id, label: c.full_name })) },
          { name: 'description', label: 'What was given', required: true, placeholder: 'Paid travel to product launch' },
          { name: 'value', label: 'Fair market value', type: 'rupees', required: true },
          { name: 'givenOn', label: 'Date given', type: 'date', required: true },
          { name: 'who', label: 'Who bears the TDS?', type: 'select', required: true, options: [{ value: 'creator', label: 'Take it from their next payment' }, { value: 'company', label: 'The company pays it' }] },
        ]}
        onSubmit={async (v) => { const r = await api('/admin/benefits', 'POST', { influencerId: v.influencerId, description: v.description, valuePaise: toPaise(v.value), givenOn: v.givenOn, recoverFromPayout: v.who === 'creator' }); toast(`Benefit saved. TDS: ${rupees(r.tds_paise)}`); await Promise.all([benefits.reload(), sum.reload()]); }} />}
      {voiding && <FormModal title="Cancel this benefit?" submit="Cancel benefit" danger onClose={() => setVoiding(null)}
        fields={[{ name: 'reason', label: 'Reason', required: true }]}
        onSubmit={async (v) => { await api(`/admin/benefits/${voiding.id}/void`, 'POST', { reason: v.reason }); await Promise.all([benefits.reload(), sum.reload()]); }} />}
    </>
  );
}

function SheetDetail({ id, onChange }: { id: string; onChange: () => void }) {
  const items = useApi<any[]>(`/admin/payment-batches/${id}/items`);
  const [dialog, setDialog] = useState<{ type: 'paid' | 'failed'; row: any } | null>(null);
  return (
    <div className="mt-4 border-l-4 border-tag bg-white p-3">
      <h3 className="mb-1 font-bold">Sheet details</h3>
      <Loaded state={items}>
        <Table rows={items.data} rowKey={(r) => r.id} empty="This sheet has no payments."
          cols={[
            { head: 'Creator', cell: (r) => <><div className="font-semibold">{r.creator}</div><div className="text-muted">PAN ending {r.pan_last4 ?? '-'}</div></> },
            { head: 'Verified post', cell: (r) => <><a className="text-link underline" href={r.post_url} target="_blank" rel="noreferrer">Open post</a><div className="text-muted">{count(r.views_at_final)} views</div></> },
            { head: 'Gross', right: true, cell: (r) => rupees(r.gross_paise) },
            { head: 'TDS', right: true, cell: (r) => rupees(r.tds_paise) },
            { head: 'TDS on benefits', right: true, cell: (r) => rupees(r.benefit_tds_paise) },
            { head: 'Net', right: true, cell: (r) => <strong>{rupees(r.net_paise)}</strong> },
            { head: 'Status', cell: (r) => <><Status value={r.status} />{r.status_reason && <div className="text-xs text-muted">{r.status_reason}</div>}{r.utr && <div className="text-xs text-muted">UTR {r.utr}</div>}</> },
            { head: '', cell: (r) => (
              <div className="flex flex-wrap justify-end gap-1.5">
                {r.status === 'PROCESSING' && <Button kind="primary" onClick={() => setDialog({ type: 'paid', row: r })}>Mark paid</Button>}
                {['PROCESSING', 'PAID'].includes(r.status) && <Button onClick={() => setDialog({ type: 'failed', row: r })}>{r.status === 'PAID' ? 'Bank returned it' : 'Bank failed'}</Button>}
              </div>
            ) },
          ]} />
      </Loaded>
      {dialog?.type === 'paid' && <FormModal title={`Mark ${dialog.row.creator} as paid`} submit="Mark paid" onClose={() => setDialog(null)}
        intro={`Only do this once your bank has paid ${rupees(dialog.row.net_paise)}.`}
        fields={[{ name: 'utr', label: 'Bank reference (UTR)', required: true }]}
        onSubmit={async (v) => { await api(`/admin/payment-items/${dialog.row.id}/paid`, 'POST', { utr: v.utr }); await items.reload(); onChange(); }} />}
      {dialog?.type === 'failed' && <FormModal title={`Payment to ${dialog.row.creator} did not go through`} submit="Move to next sheet" danger onClose={() => setDialog(null)}
        intro="Tax entries are undone and the payment joins the next sheet. Ask the creator to check their bank details."
        fields={[{ name: 'reason', label: 'What did the bank say?', required: true }]}
        onSubmit={async (v) => { await api(`/admin/payment-items/${dialog.row.id}/failed`, 'POST', { reason: v.reason }); await items.reload(); onChange(); }} />}
    </div>
  );
}
