'use client';
import { useState } from 'react';
import { api, count, useApi, toPaise } from '@/lib/api';
import { ResetLinkButton } from '@/components/ResetLink';
import { Button, FormModal, Loaded, Modal, PageHead, Status, Table, Badge, useToast } from '@/components/ui';

const TAX: Record<string, string> = {
  PROFESSIONAL: 'Professional or content creator (194J, 10%)',
  CONTRACT_INDIVIDUAL: 'Contract work, individual or HUF (194C, 1%)',
  CONTRACT_OTHER: 'Contract work, company or firm (194C, 2%)',
  SALARIED: 'Salaried employee (pay through payroll, section 192)',
};

export default function Creators() {
  const list = useApi<any[]>('/admin/influencers');
  const [dialog, setDialog] = useState<{ type: 'approve' | 'reject' | 'black' | 'unblack' | 'rate' | 'erase' | 'tax'; row: any } | null>(null);
  const [bank, setBank] = useState<any>(null);
  const [pan, setPan] = useState<any>(null);
  const waiting = list.data?.filter((r) => ['PENDING_STEP_1', 'PENDING_STEP_2'].includes(r.vetting_status)).length ?? 0;
  return (
    <>
      <PageHead title="Creators" intro={waiting ? `${waiting} creator${waiting > 1 ? 's are' : ' is'} waiting for approval.` : 'Either admin can approve a creator.'} />
      <Nearby />
      <Loaded state={list}>
        <Table rows={list.data} rowKey={(r) => r.user_id} empty="No creators have joined yet."
          cols={[
            { head: 'Creator', cell: (r) => <div className="text-left"><div className="font-semibold">{r.full_name}</div><div className="text-muted">{r.email}</div></div> },
            { head: 'Accounts', cell: (r) => r.social?.map((s: any) => <div key={s.platform}>{s.platform === 'INSTAGRAM' ? 'Instagram' : 'YouTube'} @{s.handle} ({count(s.followers)})</div>) ?? <span className="text-muted">None connected</span> },
            { head: 'Tier', cell: (r) => r.tier },
            { head: 'Tax type', cell: (r) => <button className="text-left text-link underline" onClick={() => setDialog({ type: 'tax', row: r })}>{TAX[r.engagement_type]}</button> },
            { head: 'PAN', cell: (r) => r.pan_last4 ? <>{r.legal_name}, ending {r.pan_last4}<div>{r.pan_status === 'INOPERATIVE' ? <Badge tone="bad">Invalid: 20% TDS</Badge> : r.pan_status === 'UNVERIFIED' ? <Badge tone="wait">Not confirmed</Badge> : <Badge tone="good">Confirmed</Badge>} <button className="font-semibold text-link underline" onClick={() => setPan(r)}>Check PAN</button></div></> : <span className="text-muted">Not added</span> },
            { head: 'Status', cell: (r) => r.is_blacklisted ? <div><Badge tone="bad">Blacklisted</Badge><p className="text-xs text-muted">{r.blacklist_reason}</p></div> : <Status value={r.vetting_status} /> },
            { head: '', cell: (r) => (
              <div className="flex flex-wrap justify-end gap-1.5">
                {['PENDING_STEP_1', 'PENDING_STEP_2'].includes(r.vetting_status) && <Button kind="primary" onClick={() => setDialog({ type: 'approve', row: r })}>Approve</Button>}
                {['PENDING_STEP_1', 'PENDING_STEP_2'].includes(r.vetting_status) && <Button onClick={() => setDialog({ type: 'reject', row: r })}>Decline</Button>}
                <Button kind={r.has_bank && !r.bank_confirmed ? 'primary' : 'plain'} onClick={() => setBank(r)}>{r.has_bank && !r.bank_confirmed ? 'Confirm bank details' : 'Bank details'}</Button>
                <Button onClick={() => setDialog({ type: 'rate', row: r })}>Custom rate</Button>
                <ResetLinkButton id={r.user_id} />
                <Button kind="danger" onClick={() => setDialog({ type: 'erase', row: r })}>Delete data</Button>
                {r.is_blacklisted ? <Button onClick={() => setDialog({ type: 'unblack', row: r })}>Remove from blacklist</Button> : <Button kind="danger" onClick={() => setDialog({ type: 'black', row: r })}>Blacklist</Button>}
              </div>
            ) },
          ]} />
      </Loaded>
      {(dialog?.type === 'approve' || dialog?.type === 'reject') && <FormModal title={`${dialog.type === 'approve' ? 'Approve' : 'Decline'} ${dialog.row.full_name}`} submit={dialog.type === 'approve' ? 'Approve creator' : 'Decline creator'} danger={dialog.type === 'reject'} onClose={() => setDialog(null)}
        intro={dialog.type === 'approve' ? `Approving confirms you have checked the PAN ending ${dialog.row.pan_last4 ?? '(not added)'} against ${dialog.row.legal_name ?? 'their legal name'}.` : undefined}
        fields={[{ name: 'reason', label: 'Reason', required: true }]}
        onSubmit={async (v) => { await api(`/admin/influencers/${dialog.row.user_id}/vet`, 'POST', { approve: dialog.type === 'approve', reason: v.reason }); await list.reload(); }} />}
      {(dialog?.type === 'black' || dialog?.type === 'unblack') && <FormModal title={`${dialog.type === 'black' ? 'Blacklist' : 'Remove from blacklist:'} ${dialog.row.full_name}`} submit={dialog.type === 'black' ? 'Blacklist creator' : 'Remove from blacklist'} danger={dialog.type === 'black'} onClose={() => setDialog(null)}
        intro={dialog.type === 'black' ? 'They will not be able to submit, and any unpaid amounts are held.' : undefined}
        fields={[{ name: 'reason', label: 'Reason', required: true }]}
        onSubmit={async (v) => { await api(`/admin/influencers/${dialog.row.user_id}/blacklist`, 'POST', { blacklisted: dialog.type === 'black', reason: v.reason }); await list.reload(); }} />}
      {dialog?.type === 'tax' && <FormModal title={`Tax type: ${dialog.row.full_name}`} submit="Save tax type" onClose={() => setDialog(null)}
        intro="Sets which TDS section applies to their future payments. Ask your CA if you are unsure."
        fields={[
          { name: 'type', label: 'How are they engaged?', type: 'select', required: true, initial: dialog.row.engagement_type, options: Object.entries(TAX).map(([value, label]) => ({ value, label })) },
          { name: 'reason', label: 'Reason', required: true },
        ]}
        onSubmit={async (v) => { await api(`/admin/influencers/${dialog.row.user_id}/engagement`, 'PUT', { type: v.type, reason: v.reason }); await list.reload(); }} />}
      {dialog?.type === 'erase' && <FormModal title={`Delete ${dialog.row.full_name}'s data`} submit="Delete permanently" danger onClose={() => setDialog(null)}
        intro="Removes their bank details, social accounts and contact details and closes the login. This cannot be undone. Tax and payment records stay, as the law requires."
        fields={[{ name: 'reason', label: 'Reason', required: true }]}
        onSubmit={async (v) => { await api(`/admin/influencers/${dialog.row.user_id}/erase`, 'POST', { reason: v.reason }); await list.reload(); }} />}
      {dialog?.type === 'rate' && <FormModal title={`Custom rate for ${dialog.row.full_name}`} submit="Save custom rate" onClose={() => setDialog(null)}
        intro="Replaces their tier rate on future submissions. The bonus cap sets the most they can earn from views."
        fields={[
          { name: 'base', label: 'Base pay', type: 'rupees', required: true }, { name: 'bonus', label: 'Bonus per 10,000 views', type: 'rupees', required: true },
          { name: 'cap', label: 'Bonus cap', type: 'rupees', required: true }, { name: 'reason', label: 'Reason', required: true },
        ]}
        onSubmit={async (v) => { await api(`/admin/influencers/${dialog.row.user_id}/custom-rate`, 'PUT', { basePayPaise: toPaise(v.base), bonusPer10kPaise: toPaise(v.bonus), maxViewBonusPaise: toPaise(v.cap), reason: v.reason }); }} />}
      {pan && <PanModal row={pan} onClose={() => { setPan(null); list.reload(); }} />}
      {bank && <BankModal row={bank} onClose={() => { setBank(null); list.reload(); }} />}
    </>
  );
}

function BankModal({ row, onClose }: { row: any; onClose: () => void }) {
  const d = useApi<any>(`/admin/influencers/${row.user_id}/bank`);
  const toast = useToast();
  return (
    <Modal title={`Bank details: ${row.full_name}`} onClose={onClose}>
      <p className="mb-3 text-sm text-muted">Each view is recorded in the audit log.</p>
      {d.error ? <p>{d.error === 'Bank details not found' ? 'This creator has not added bank details yet.' : d.error}</p> : d.data ? (
        <dl className="space-y-2">
          <div><dt className="text-sm text-muted">Account holder</dt><dd className="font-semibold">{d.data.accountHolder}</dd></div>
          <div><dt className="text-sm text-muted">Account number</dt><dd className="font-semibold">{d.data.accountNumber}</dd></div>
          <div><dt className="text-sm text-muted">IFSC</dt><dd className="font-semibold">{d.data.ifsc}</dd></div>
        </dl>
      ) : <p>Loading…</p>}
      {d.data && !d.data.confirmed && <p className="mt-3 text-sm font-medium text-wait">New or changed details. Payments stay on hold until you confirm these belong to the creator, ideally by calling them or sending a small test payment.</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Button onClick={onClose}>Close</Button>
        {d.data && !d.data.confirmed && <Button kind="primary" onClick={async () => {
          try { await api(`/admin/influencers/${row.user_id}/bank/confirm`, 'POST', { viewedVersion: d.data.version }); toast('Bank details confirmed'); onClose(); }
          catch (e) { toast((e as Error).message, true); }
        }}>Confirm details</Button>}
      </div>
    </Modal>
  );
}

function PanModal({ row, onClose }: { row: any; onClose: () => void }) {
  const d = useApi<any>(`/admin/influencers/${row.user_id}/pan`);
  const toast = useToast();
  return (
    <Modal title={`PAN: ${row.full_name}`} onClose={onClose}>
      <p className="mb-3 text-sm text-muted">Check this against their PAN card. Payments wait until you confirm it. If it is invalid, payment can go ahead with TDS at 20%. Each view is logged.</p>
      {d.data ? <p className="font-semibold">{d.data.pan}, {d.data.legalName}</p> : <p>Loading…</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Button onClick={onClose}>Close</Button>
        {d.data && <Button kind="danger" onClick={async () => {
          try { await api(`/admin/influencers/${row.user_id}/pan/invalid`, 'POST', { viewedVersion: d.data.version }); toast('PAN marked invalid. TDS will be 20%.'); onClose(); }
          catch (e) { toast((e as Error).message, true); }
        }}>PAN is invalid</Button>}
        {d.data && <Button kind="primary" onClick={async () => {
          try { await api(`/admin/influencers/${row.user_id}/pan/confirm`, 'POST', { viewedVersion: d.data.version }); toast('PAN confirmed'); onClose(); }
          catch (e) { toast((e as Error).message, true); }
        }}>Confirm PAN</Button>}
      </div>
    </Modal>
  );
}

function Nearby() {
  const stores = useApi<any[]>('/admin/stores');
  const [storeId, setStoreId] = useState('');
  const [km, setKm] = useState(10);
  const near = useApi<any[]>(storeId ? `/admin/stores/${storeId}/nearby-creators?km=${km}` : null);
  return (
    <details className="mb-6 border border-line bg-white p-3">
      <summary className="cursor-pointer font-semibold">Find approved creators near a store</summary>
      <div className="mt-3 flex flex-wrap gap-2">
        <select aria-label="Store" className="min-h-[40px] border border-line bg-white px-2" value={storeId} onChange={(e) => setStoreId(e.target.value)}>
          <option value="">Choose a store…</option>
          {stores.data?.map((s) => <option key={s.id} value={s.id}>{s.name}, {s.city}</option>)}
        </select>
        <select aria-label="Distance" className="min-h-[40px] border border-line bg-white px-2" value={km} onChange={(e) => setKm(Number(e.target.value))}>
          <option value={5}>Within 5 km</option><option value={7}>Within 7 km</option><option value={10}>Within 10 km</option>
        </select>
      </div>
      {storeId && <Table rows={near.data} rowKey={(r) => r.user_id} empty="No approved creators in this range."
        cols={[{ head: 'Creator', cell: (r) => r.full_name }, { head: 'Tier', cell: (r) => r.tier }, { head: 'Distance', right: true, cell: (r) => `${Number(r.km).toFixed(1)} km` }]} />}
    </details>
  );
}
