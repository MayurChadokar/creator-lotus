'use client';
import { useState } from 'react';
import { api, count, date, fromPaise, percent, rupees, toPaise, useApi } from '@/lib/api';
import { Button, FormModal, Loaded, PageHead, Section, Table } from '@/components/ui';

export default function Matrix() {
  const m = useApi<any>('/admin/matrix');
  const tds = useApi<any[]>('/admin/tds-rules');
  const holidays = useApi<any[]>('/admin/holidays');
  const [dialog, setDialog] = useState<{ type: 'tier' | 'cat' | 'tds' | 'holiday' | 'newTier' | 'newCat'; row?: any } | null>(null);
  return (
    <>
      <PageHead title="Pay rates" intro="Standard pay for every campaign: (base pay + view bonus) x category multiplier. To pay differently for one campaign, use Pay and targets on the Campaigns page. Changes apply to new posts; posts already submitted keep their pay." />
      <Loaded state={m}>
        <Section title="Tiers and rate cards" intro="Creators move tiers automatically using their last 5 posts, once they have at least 3." action={<Button onClick={() => setDialog({ type: 'newTier' })}>Add tier</Button>}>
          <Table<any> rows={m.data?.tiers} rowKey={(r) => r.id} empty="No tiers."
            cols={[
              { head: 'Tier', cell: (r) => <span className="font-semibold">{r.name}</span> },
              { head: 'Base pay', right: true, cell: (r) => rupees(r.base_pay_paise, false) },
              { head: 'Per 10,000 views', right: true, cell: (r) => rupees(r.bonus_per_10k_paise, false) },
              { head: 'Bonus cap', right: true, cell: (r) => rupees(r.max_view_bonus_paise, false) },
              { head: 'Average views needed', right: true, cell: (r) => count(r.min_avg_views) },
              { head: 'Engagement needed', right: true, cell: (r) => percent(r.min_engagement_bps) },
              { head: '', cell: (r) => <Button onClick={() => setDialog({ type: 'tier', row: r })}>Edit</Button> },
            ]} />
        </Section>
        <Section title="Category multipliers" action={<Button onClick={() => setDialog({ type: 'newCat' })}>Add category</Button>}>
          <Table<any> rows={m.data?.categories} rowKey={(r) => r.id} empty="No categories."
            cols={[
              { head: 'Category', cell: (r) => <span className="font-semibold">{r.name}</span> },
              { head: 'Multiplier', right: true, cell: (r) => `${(r.multiplier_bps / 10000).toFixed(2)}x` },
              { head: '', cell: (r) => <Button onClick={() => setDialog({ type: 'cat', row: r })}>Edit</Button> },
            ]} />
        </Section>
        <Section title="Custom rate cards" intro="Set these from the Creators page.">
          <Table<any> rows={m.data?.customRateCards} rowKey={(r) => r.id} empty="No creator has a custom rate."
            cols={[
              { head: 'Creator', cell: (r) => <span className="font-semibold">{r.full_name}</span> },
              { head: 'Base pay', right: true, cell: (r) => rupees(r.base_pay_paise, false) },
              { head: 'Per 10,000 views', right: true, cell: (r) => rupees(r.bonus_per_10k_paise, false) },
              { head: 'Bonus cap', right: true, cell: (r) => rupees(r.max_view_bonus_paise, false) },
              { head: 'Reason', cell: (r) => r.reason },
            ]} />
        </Section>
      </Loaded>
      <Section title="TDS rules" intro="For each type, the rule with the latest start date applies. Add a new rule when the law changes; confirm rates with your CA. A tax return not being filed does not change these rates." action={<Button onClick={() => setDialog({ type: 'tds' })}>Add rule</Button>}>
        <Loaded state={tds}>
          <Table rows={tds.data} rowKey={(r) => r.id} empty="No TDS rules. Add one before creating a payment sheet."
            cols={[
              { head: 'Rule', cell: (r) => <span className="font-semibold">{r.label}</span> }, { head: 'Old section', cell: (r) => r.legacy_section },
              { head: 'Rate', right: true, cell: (r) => percent(r.rate_bps) }, { head: 'PAN inoperative', right: true, cell: (r) => percent(r.no_pan_rate_bps) },
              { head: 'Yearly limit', right: true, cell: (r) => rupees(r.annual_threshold_paise, false) }, { head: 'Single payment limit', right: true, cell: (r) => r.single_threshold_paise === null ? '-' : rupees(r.single_threshold_paise, false) }, { head: 'From', cell: (r) => date(r.effective_from) },
            ]} />
        </Loaded>
      </Section>
      <Section title="Bank holidays" intro="Add these each year so the 3-working-day dates stay right." action={<Button onClick={() => setDialog({ type: 'holiday' })}>Add holiday</Button>}>
        <Loaded state={holidays}>
          <Table<any> rows={holidays.data} rowKey={(r) => r.date} empty="No bank holidays listed. Only weekends are being skipped."
            cols={[{ head: 'Date', cell: (r) => date(r.date) }, { head: 'Holiday', cell: (r) => r.name }]} />
        </Loaded>
      </Section>
      {dialog?.type === 'tier' && <FormModal title={`Edit ${dialog.row.name} tier`} submit="Save tier" onClose={() => setDialog(null)}
        fields={[
          { name: 'base', label: 'Base pay', type: 'rupees', required: true, initial: fromPaise(dialog.row.base_pay_paise ?? 0) },
          { name: 'bonus', label: 'Bonus per 10,000 views', type: 'rupees', required: true, initial: fromPaise(dialog.row.bonus_per_10k_paise ?? 0) },
          { name: 'cap', label: 'Bonus cap', type: 'rupees', required: true, initial: fromPaise(dialog.row.max_view_bonus_paise ?? 0) },
          { name: 'views', label: 'Average views needed for this tier', type: 'number', min: 0, required: true, initial: String(dialog.row.min_avg_views) },
          { name: 'eng', label: 'Engagement needed (%)', type: 'number', min: 0, step: '0.01', required: true, initial: String(dialog.row.min_engagement_bps / 100) },
        ]}
        onSubmit={async (v) => { await api(`/admin/matrix/tiers/${dialog.row.id}`, 'PUT', { basePayPaise: toPaise(v.base), bonusPer10kPaise: toPaise(v.bonus), maxViewBonusPaise: toPaise(v.cap), minAvgViews: Number(v.views), minEngagementBps: Math.round(Number(v.eng) * 100) }); await m.reload(); }} />}
      {dialog?.type === 'newTier' && <FormModal title="Add tier" submit="Add tier" onClose={() => setDialog(null)} intro="New tiers rank above the existing ones."
        fields={[
          { name: 'name', label: 'Tier name', required: true },
          { name: 'base', label: 'Base pay', type: 'rupees', required: true }, { name: 'bonus', label: 'Bonus per 10,000 views', type: 'rupees', required: true }, { name: 'cap', label: 'Bonus cap', type: 'rupees', required: true },
          { name: 'views', label: 'Average views needed for this tier', type: 'number', min: 0, required: true }, { name: 'eng', label: 'Engagement needed (%)', type: 'number', min: 0, step: '0.01', required: true },
        ]}
        onSubmit={async (v) => { await api('/admin/matrix/tiers', 'POST', { name: v.name, basePayPaise: toPaise(v.base), bonusPer10kPaise: toPaise(v.bonus), maxViewBonusPaise: toPaise(v.cap), minAvgViews: Number(v.views), minEngagementBps: Math.round(Number(v.eng) * 100) }); await m.reload(); }} />}
      {dialog?.type === 'newCat' && <FormModal title="Add category" submit="Add category" onClose={() => setDialog(null)}
        fields={[{ name: 'name', label: 'Category name', required: true }, { name: 'mult', label: 'Multiplier', type: 'number', min: 0.1, max: 10, step: '0.01', required: true, initial: '1' }]}
        onSubmit={async (v) => { await api('/admin/matrix/categories', 'POST', { name: v.name, multiplierBps: Math.round(Number(v.mult) * 10000) }); await m.reload(); }} />}
      {dialog?.type === 'cat' && <FormModal title={`Edit ${dialog.row.name}`} submit="Save multiplier" onClose={() => setDialog(null)}
        fields={[{ name: 'mult', label: 'Multiplier', type: 'number', min: 0.1, max: 10, step: '0.01', required: true, initial: String(dialog.row.multiplier_bps / 10000), hint: 'For example, 1.5 pays 50% more.' }]}
        onSubmit={async (v) => { await api(`/admin/matrix/categories/${dialog.row.id}`, 'PUT', { multiplierBps: Math.round(Number(v.mult) * 10000) }); await m.reload(); }} />}
      {dialog?.type === 'tds' && <FormModal title="Add TDS rule" submit="Add rule" onClose={() => setDialog(null)}
        fields={[
          { name: 'code', label: 'Applies to', type: 'select', required: true, options: [{ value: 'PROF_194J', label: 'Professional fees (194J)' }, { value: 'CONTRACT_194C_IND', label: 'Contract work, individual (194C)' }, { value: 'CONTRACT_194C_OTHER', label: 'Contract work, company (194C)' }, { value: 'BENEFIT_194R', label: 'Free products and benefits (194R)' }] },
          { name: 'label', label: 'Name', required: true }, { name: 'section', label: 'Old section number', required: true },
          { name: 'rate', label: 'Rate (%)', type: 'number', min: 0, max: 100, step: '0.01', required: true }, { name: 'noPan', label: 'Rate when PAN is inoperative (%)', type: 'number', min: 0, max: 100, step: '0.01', required: true },
          { name: 'limit', label: 'Yearly limit', type: 'rupees', required: true }, { name: 'single', label: 'Single payment limit, if any', type: 'rupees' }, { name: 'from', label: 'Applies from', type: 'date', required: true },
        ]}
        onSubmit={async (v) => { await api('/admin/tds-rules', 'POST', { code: v.code, singleThresholdPaise: v.single === '' ? undefined : toPaise(v.single), label: v.label, legacySection: v.section, rateBps: Math.round(Number(v.rate) * 100), noPanRateBps: Math.round(Number(v.noPan) * 100), annualThresholdPaise: toPaise(v.limit), effectiveFrom: v.from }); await tds.reload(); }} />}
      {dialog?.type === 'holiday' && <FormModal title="Add bank holiday" submit="Add holiday" onClose={() => setDialog(null)}
        fields={[{ name: 'date', label: 'Date', type: 'date', required: true }, { name: 'name', label: 'Holiday', required: true }]}
        onSubmit={async (v) => { await api('/admin/holidays', 'POST', { date: v.date, name: v.name }); await holidays.reload(); }} />}
    </>
  );
}
