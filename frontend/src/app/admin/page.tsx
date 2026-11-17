'use client';
import { useState } from 'react';
import { api, count, date, percent, rupees, toIso, toPaise, useApi, fromPaise } from '@/lib/api';
import { ResetLinkButton } from '@/components/ResetLink';
import { Button, FormModal, Loaded, Notice, PageHead, Section, Status, Table, useAct } from '@/components/ui';

const words = (text: string, mark: string) => (text ?? '').split(/[\s,]+/).filter(Boolean).map((t) => (t.startsWith(mark) ? t : mark + t));
const specs = (v: Record<string, any>) => ({ postingHashtags: words(v.hashtags, '#'), postingMentions: words(v.mentions, '@'), postingGuidelines: v.guidelines || undefined, collabAccount: words(v.collab, '@')[0] });

const specFields = (row?: any) => [
  { name: 'disclosure', label: 'Require a sponsored label such as #ad in the caption', type: 'checkbox' as const, initial: row ? row.required_disclosure : true, tab: 'Posting specs' },
  { name: 'hashtags', label: 'Hashtags the caption must include', tab: 'Posting specs', initial: (row?.posting_hashtags ?? []).join(' '), placeholder: '#LotusElectronics #LotusDiwali', hint: 'Separate with spaces. Posts missing any of these are held for an admin to review.' },
  { name: 'mentions', label: 'Accounts to tag', tab: 'Posting specs', initial: (row?.posting_mentions ?? []).join(' '), placeholder: '@lotuselectronics', hint: 'Also checked in the caption.' },
  { name: 'guidelines', label: 'Caption instructions', type: 'textarea' as const, tab: 'Posting specs', initial: row?.posting_guidelines ?? '', placeholder: 'Mention the festive offer and the store name in the first line.' },
  { name: 'collab', label: 'Instagram collab: account creators must invite', tab: 'Posting specs', initial: row?.collab_account ?? '', placeholder: '@lotuselectronics', hint: 'The post then also shows on this account once your team accepts the invite. Leave empty if not needed.' },
];

const TARGETS = 'Views and engagement';
const targetFields = (row?: any) => [
  { name: 'minViews', label: 'Minimum views', type: 'number' as const, min: 0, initial: String(row?.min_views ?? 500), required: true, tab: TARGETS },
  { name: 'minEng', label: 'Minimum engagement (%)', type: 'number' as const, min: 0.5, max: 10, step: '0.1', initial: String((row?.min_engagement_bps ?? 150) / 100), required: true, tab: TARGETS,
    hint: 'Likes plus comments, divided by views. Your brief suggests 1.5% to 3%.' },
  { name: 'days', label: 'Days to collect views before final check', type: 'number' as const, min: 1, max: 90, initial: String(row?.measurement_days ?? 7), required: true, tab: TARGETS },
];

/** Three boxes per creator level. Leave a level empty to use the standard rate from Pay rates. */
const PAY = 'Pay by level';
const payFields = (tiers: any[], row?: any) => tiers.flatMap((t) => {
  const cur = (row?.tier_rates ?? []).find((x: any) => x.tier_id === t.id);
  const v = (p?: number) => (p === undefined ? '' : fromPaise(p));
  return [
    { name: `pay_${t.id}_base`, label: `${t.name}: base pay`, type: 'rupees' as const, third: true, tab: PAY, initial: v(cur?.base_pay_paise), placeholder: `Standard ${fromPaise(t.base_pay_paise ?? 0)}` },
    { name: `pay_${t.id}_bonus`, label: `${t.name}: per 10,000 views`, type: 'rupees' as const, third: true, tab: PAY, initial: v(cur?.bonus_per_10k_paise), placeholder: `Standard ${fromPaise(t.bonus_per_10k_paise ?? 0)}` },
    { name: `pay_${t.id}_cap`, label: `${t.name}: view bonus limit`, type: 'rupees' as const, third: true, tab: PAY, initial: v(cur?.max_view_bonus_paise), placeholder: `Standard ${fromPaise(t.max_view_bonus_paise ?? 0)}` },
  ];
});
const PAY_NOTE = 'Leave a level empty to use the standard rate, which is then multiplied by the category multiplier. Pay you enter here is used exactly as written. Personal rates set on a creator still come first.';
const readTierRates = (tiers: any[], v: Record<string, any>) => tiers.flatMap((t) => {
  const vals = ['base', 'bonus', 'cap'].map((k) => String(v[`pay_${t.id}_${k}`] ?? '').trim());
  if (vals.every((x) => x === '')) return [];
  if (vals.some((x) => x === '')) throw new Error(`Fill in all three pay boxes for ${t.name}, or leave all three empty.`);
  return [{ tierId: t.id, basePayPaise: toPaise(vals[0]!), bonusPer10kPaise: toPaise(vals[1]!), maxViewBonusPaise: toPaise(vals[2]!) }];
});
const readTargets = (v: Record<string, any>) => ({ minViews: Number(v.minViews), minEngagementBps: Math.round(Number(v.minEng) * 100), measurementDays: Number(v.days) });

export default function Campaigns() {
  const list = useApi<any[]>('/admin/campaigns');
  const stores = useApi<any[]>('/admin/stores');
  const cats = useApi<any[]>('/public/categories');
  const matrix = useApi<any>('/admin/matrix');
  const tiers: any[] = matrix.data?.tiers ?? [];
  const staff = useApi<any[]>('/admin/staff');
  const security = useApi<any>('/admin/security-status');
  const [staffAct, setStaffAct] = useState<{ row: any; type: 'reset' | 'off' | 'on' } | null>(null);
  const [dialog, setDialog] = useState<{ type: 'new' | 'budget' | 'store' | 'staff' | 'specs' | 'terms'; row?: any } | null>(null);
  const { busy, run } = useAct();
  const setStatus = (id: string, status: string, msg: string) => run(async () => { await api(`/admin/campaigns/${id}/status`, 'POST', { status }); await list.reload(); }, msg);
  const storeOpts = stores.data?.map((s) => ({ value: s.id, label: `${s.name}, ${s.city}` })) ?? [];
  return (
    <>
      {security.data?.twoStepOff && <Notice tone="bad">Testing mode: two-step login is off for admins. Use only made-up PANs and bank details, and turn it on before real creators join.</Notice>}
      <PageHead title="Campaigns" intro="Campaigns lock themselves when the budget or submission limit is reached."
        action={<Button kind="primary" onClick={() => setDialog({ type: 'new' })}>New campaign</Button>} />
      <Loaded state={list}>
        <Table rows={list.data} rowKey={(r) => r.id} empty="No campaigns yet. Create your first one."
          cols={[
            { head: 'Campaign', cell: (r) => <div className="text-left"><div className="font-semibold">{r.title}</div><div className="text-muted">{r.category}, {r.store_ids?.length ?? 0} store{r.store_ids?.length === 1 ? '' : 's'}</div>
              <div className="text-muted">Needs {count(r.min_views)} views, {percent(r.min_engagement_bps)} engagement. {r.tier_rates?.length ? 'Own pay for this campaign.' : 'Standard pay.'}</div></div> },
            { head: 'Status', cell: (r) => <><Status value={r.status} />{r.lock_reason && <div className="text-xs text-muted">{r.lock_reason === 'BUDGET' ? 'Budget used' : 'Limit reached'}</div>}</> },
            { head: 'Budget used', cell: (r) => <BudgetBar used={r.reserved_paise} total={r.budget_paise} /> },
            { head: 'Submissions', right: true, cell: (r) => `${count(r.active_submissions)} of ${count(r.submission_quota)}` },
            { head: 'Ends', cell: (r) => date(r.expires_at) },
            { head: '', cell: (r) => (
              <div className="flex flex-wrap justify-end gap-1.5">
                {['DRAFT', 'PAUSED'].includes(r.status) && <Button kind="primary" busy={busy} onClick={() => setStatus(r.id, 'OPEN', 'Campaign opened')}>Open</Button>}
                {r.status === 'OPEN' && <Button busy={busy} onClick={() => setStatus(r.id, 'PAUSED', 'Campaign paused')}>Pause</Button>}
                {!['CLOSED', 'EXPIRED'].includes(r.status) && <Button onClick={() => setDialog({ type: 'terms', row: r })}>Pay and targets</Button>}
                {!['CLOSED', 'EXPIRED'].includes(r.status) && <Button onClick={() => setDialog({ type: 'specs', row: r })}>Posting specs</Button>}
                {!['CLOSED', 'EXPIRED'].includes(r.status) && <Button onClick={() => setDialog({ type: 'budget', row: r })}>Budget</Button>}
                {!['CLOSED', 'EXPIRED'].includes(r.status) && <Button kind="danger" busy={busy} onClick={() => setStatus(r.id, 'CLOSED', 'Campaign closed')}>Close</Button>}
              </div>
            ) },
          ]} />
      </Loaded>
      <div className="mt-10" />
      <Section title="Stores and staff" action={<div className="flex gap-2"><Button onClick={() => setDialog({ type: 'store' })}>Add store</Button><Button onClick={() => setDialog({ type: 'staff' })}>Add staff login</Button></div>}>
        <Loaded state={stores}>
          <Table rows={stores.data} rowKey={(r) => r.id} empty="No stores yet. Add your stores before creating campaigns."
            cols={[{ head: 'Store', cell: (r) => <span className="font-semibold">{r.name}</span> }, { head: 'Code', cell: (r) => r.code }, { head: 'City', cell: (r) => r.city }, { head: 'State', cell: (r) => r.state }]} />
        </Loaded>
        <h3 className="mb-1 mt-6 font-bold">Staff logins</h3>
        <Loaded state={staff}>
          <Table rows={staff.data} rowKey={(r) => r.id} empty="No staff logins."
            cols={[
              { head: 'Name', cell: (r) => <div className="text-left"><div className="font-semibold">{r.full_name}</div><div className="text-muted">{r.email}</div></div> },
              { head: 'Role', cell: (r) => r.role === 'ADMIN' ? 'Admin' : `Manager, ${r.store}` },
              { head: 'Status', cell: (r) => <Status value={r.is_active ? 'OPEN' : 'CLOSED'} /> },
              { head: '', cell: (r) => (
                <div className="flex flex-wrap justify-end gap-1.5">
                  <ResetLinkButton id={r.id} />
                  {r.role === 'ADMIN' && r.mfa_on && <Button onClick={() => setStaffAct({ row: r, type: 'reset' })}>Reset two-step</Button>}
                  <Button kind={r.is_active ? 'danger' : 'plain'} onClick={() => setStaffAct({ row: r, type: r.is_active ? 'off' : 'on' })}>{r.is_active ? 'Disable' : 'Enable'}</Button>
                </div>
              ) },
            ]} />
        </Loaded>
      </Section>
      {staffAct && <FormModal title={`${{ reset: 'Reset two-step login for', off: 'Disable', on: 'Enable' }[staffAct.type]} ${staffAct.row.full_name}`} submit="Confirm" danger={staffAct.type !== 'on'} onClose={() => setStaffAct(null)}
        fields={[{ name: 'reason', label: 'Reason', required: true }]}
        onSubmit={async (v) => { await api(staffAct.type === 'reset' ? `/admin/staff/${staffAct.row.id}/reset-two-step` : `/admin/staff/${staffAct.row.id}/active`, 'POST', staffAct.type === 'reset' ? { reason: v.reason } : { active: staffAct.type === 'on', reason: v.reason }); await staff.reload(); }} />}
      {dialog?.type === 'specs' && <FormModal wide title={`Posting specs: ${dialog.row.title}`} submit="Save posting specs" onClose={() => setDialog(null)} firstTab="Posting specs"
        intro="Shown to creators on the campaign. Changes apply to posts not yet finally checked."
        fields={specFields(dialog.row)}
        onSubmit={async (v) => { await api(`/admin/campaigns/${dialog.row.id}/posting`, 'PUT', { ...specs(v), requiredDisclosure: v.disclosure }); await list.reload(); }} />}
      {dialog?.type === 'terms' && <FormModal wide title={`Pay and targets: ${dialog.row.title}`} submit="Save pay and targets" onClose={() => setDialog(null)} firstTab={TARGETS}
        intro={<>Posts already submitted keep the pay and targets they started with. Changes apply to new posts. {PAY_NOTE}</>}
        fields={[...targetFields(dialog.row), ...payFields(tiers, dialog.row)]}
        onSubmit={async (v) => { await api(`/admin/campaigns/${dialog.row.id}/terms`, 'PUT', { ...readTargets(v), tierRates: readTierRates(tiers, v) }); await list.reload(); }} />}
      {dialog?.type === 'new' && <FormModal wide firstTab="Brief" title="New campaign" submit="Save as draft" onClose={() => setDialog(null)}
        intro={<>It stays a draft until you open it. Use the tabs to set targets, pay by creator level and what to put in the caption. {PAY_NOTE}</>}
        fields={[
          { name: 'title', label: 'Title', required: true },
          { name: 'brief', label: 'Brief for creators', type: 'textarea', required: true },
          { name: 'categoryId', label: 'Product category', type: 'select', required: true, options: cats.data?.map((c) => ({ value: c.id, label: c.name })) },
          { name: 'storeIds', label: 'Stores', type: 'checks', options: storeOpts },
          { name: 'startsAt', label: 'Starts', type: 'datetime', required: true },
          { name: 'expiresAt', label: 'Ends', type: 'datetime', required: true },
          { name: 'budget', label: 'Total budget', type: 'rupees', required: true },
          { name: 'quota', label: 'Maximum submissions', type: 'number', min: 1, required: true },
          ...targetFields(), ...payFields(tiers), ...specFields(),
        ]}
        onSubmit={async (v) => {
          if (!v.storeIds.length) throw new Error('Choose at least one store.');
          await api('/admin/campaigns', 'POST', {
            title: v.title, brief: v.brief, categoryId: v.categoryId, storeIds: v.storeIds, startsAt: toIso(v.startsAt), expiresAt: toIso(v.expiresAt),
            budgetPaise: toPaise(v.budget), submissionQuota: Number(v.quota), ...readTargets(v), tierRates: readTierRates(tiers, v), requiredDisclosure: v.disclosure, ...specs(v),
          });
          await list.reload();
        }} />}
      {dialog?.type === 'budget' && <FormModal title={`Change budget: ${dialog.row.title}`} submit="Save budget" onClose={() => setDialog(null)}
        intro={`${rupees(dialog.row.reserved_paise)} is already committed. A locked campaign reopens by itself if there is now room.`}
        fields={[
          { name: 'budget', label: 'Total budget', type: 'rupees', required: true, initial: fromPaise(dialog.row.budget_paise) },
          { name: 'quota', label: 'Maximum submissions', type: 'number', min: 1, required: true, initial: String(dialog.row.submission_quota) },
          { name: 'reason', label: 'Reason', required: true },
        ]}
        onSubmit={async (v) => { await api(`/admin/campaigns/${dialog.row.id}/budget`, 'PUT', { budgetPaise: toPaise(v.budget), submissionQuota: Number(v.quota), reason: v.reason }); await list.reload(); }} />}
      {dialog?.type === 'store' && <FormModal title="Add store" submit="Add store" onClose={() => setDialog(null)}
        fields={[
          { name: 'code', label: 'Store code', required: true }, { name: 'name', label: 'Name', required: true }, { name: 'city', label: 'City', required: true }, { name: 'state', label: 'State', required: true },
          { name: 'lat', label: 'Latitude', type: 'number', step: 'any', required: true, hint: 'Used to match creators within 5 to 10 km. Copy it from Google Maps.' }, { name: 'lng', label: 'Longitude', type: 'number', step: 'any', required: true },
        ]}
        onSubmit={async (v) => { await api('/admin/stores', 'POST', { code: v.code, name: v.name, city: v.city, state: v.state, latitude: Number(v.lat), longitude: Number(v.lng) }); await stores.reload(); }} />}
      {dialog?.type === 'staff' && <FormModal title="Add staff login" submit="Create login" onClose={() => setDialog(null)}
        fields={[
          { name: 'role', label: 'Role', type: 'select', required: true, options: [{ value: 'STORE_MANAGER', label: 'Store manager' }, { value: 'ADMIN', label: 'Admin' }] },
          { name: 'storeId', label: 'Store', type: 'select', options: storeOpts, required: true, show: (v) => v.role === 'STORE_MANAGER' },
          { name: 'fullName', label: 'Full name', required: true }, { name: 'email', label: 'Email', type: 'email', required: true },
          { name: 'password', label: 'Temporary password', type: 'password', required: true, hint: 'At least 10 characters. They must change it when they first log in.' },
          { name: 'yourPassword', label: 'Your own password', type: 'password', required: true, show: (v) => v.role === 'ADMIN', hint: 'Adding an admin gives access to bank details. Other admins are alerted.' },
        ]}
        onSubmit={async (v) => { await api('/admin/staff', 'POST', { role: v.role, storeId: v.storeId || undefined, fullName: v.fullName, email: v.email, password: v.password, yourPassword: v.yourPassword || undefined }); await staff.reload(); }} />}
    </>
  );
}

function BudgetBar({ used, total }: { used: number; total: number }) {
  const pct = Math.min(100, Math.round((used / total) * 100));
  return (
    <div className="w-full min-w-[9rem] max-w-[13rem] text-left">
      <div className="h-2 bg-line" role="img" aria-label={`${pct}% of budget used`}><div className={`h-2 ${pct >= 90 ? 'bg-stop' : 'bg-ink'}`} style={{ width: `${pct}%` }} /></div>
      <div className="mt-1 text-xs text-muted">{rupees(used, false)} of {rupees(total, false)}</div>
    </div>
  );
}
