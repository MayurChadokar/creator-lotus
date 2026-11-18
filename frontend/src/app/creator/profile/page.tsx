'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { api, count, useApi } from '@/lib/api';
import { Badge, Button, FormModal, Loaded, Modal, Status, useAct, useToast } from '@/components/ui';
import { TermsModal } from '@/components/TermsModal';
import { CreatorPageHead } from '@/components/CreatorPageHead';

const STEP_ICONS = [
  'M9 12.75 11.25 15 15 9.75M12 3 4.5 6v5.25c0 4.64 3.2 8.98 7.5 10.05 4.3-1.07 7.5-5.41 7.5-10.05V6L12 3Z',
  'M6.75 3.75h10.5v16.5H6.75V3.75Zm2.5 4h5.5m-5.5 4h5.5m-5.5 4h3.5',
  'M3.75 7.5h16.5v10.75H3.75V7.5Zm0 3.75h16.5m-13 3.5h3.5',
  'M8.5 12a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm7-1a3 3 0 1 0 0-6m-13 14.25c.55-3.07 2.57-4.75 6-4.75s5.45 1.68 6 4.75m1.25-5.25c2.9.18 4.75 1.9 5 5.25',
  'm7.5 12 3 3 6-7M12 2.75l2.25 1.5 2.7-.1.95 2.55 2.2 1.55-.65 2.6.65 2.6-2.2 1.55-.95 2.55-2.7-.1L12 19l-2.25-1.5-2.7.1L6.1 15l-2.2-1.55.65-2.6-.65-2.6L6.1 6.7l.95-2.55 2.7.1L12 2.75Z',
];

function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children: ReactNode }) {
  return (
    <section className="relative overflow-hidden rounded-lg border border-[#dce4ed] bg-white p-5 shadow-[0_1px_2px_rgba(23,54,90,0.04)] sm:p-6">
      <div className="mb-4 flex items-start gap-3">
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-md ${done ? 'bg-[#e8f5f3] text-[#087d72]' : 'bg-[#eef3f6] text-[#536779]'}`}>
          <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={STEP_ICONS[n - 1]} /></svg>
        </span>
        <div className="min-w-0 flex-1">
          <p className="mb-0.5 text-xs font-medium text-muted">Step {n} of 5</p>
          <h2 className="text-base font-semibold text-[#17365a]">{title}</h2>
        </div>
        {done ? <Badge tone="good">Complete</Badge> : <span className="whitespace-nowrap rounded-full bg-[#f1f4f7] px-2.5 py-1 text-xs font-bold text-muted">To do</span>}
      </div>
      {children}
    </section>
  );
}

export default function Profile() {
  const me = useApi<any>('/influencer/me');
  const [terms, setTerms] = useState(false);
  const [asked, setAsked] = useState(false);
  const [edit, setEdit] = useState<string | null>(null);
  const [ytProof, setYtProof] = useState<{ channel: string; code: string; proof: string } | null>(null);
  const toast = useToast();
  const { busy, run } = useAct();
  const d = me.data;
  useEffect(() => { if (d && !d.terms_accepted && !asked) { setTerms(true); setAsked(true); } }, [d, asked]);
  const ig = d?.social?.find((s: any) => s.platform === 'INSTAGRAM');
  const yt = d?.social?.find((s: any) => s.platform === 'YOUTUBE');
  const completed = d ? [d.terms_accepted, !!d.pan_last4, !!d.payout_account, !!(ig || yt), d.vetting_status === 'APPROVED'].filter(Boolean).length : 0;
  const progress = completed * 20;
  return (
    <>
      <Loaded state={me}>
        {d && <div className="mx-auto max-w-6xl">
          <CreatorPageHead eyebrow="Account settings" title="Your creator profile" intro="Manage your verification, payout details and connected accounts in one place." />
          <section className="relative mb-5 overflow-hidden rounded-2xl border border-[#d6e7f3] bg-[#e8f2fa] px-5 py-6 text-[#17365a] sm:px-7">
            <div className="relative flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
              <div className="max-w-2xl">
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-[#168b8e]">Profile setup</p>
                <h2 className="text-xl font-semibold text-[#17365a]">Complete your profile</h2>
                <p className="mt-2 max-w-xl text-sm leading-6 text-[#49657b]">Complete these steps to join campaigns and receive payments.</p>
              </div>
              <div className="w-full rounded-xl border border-[#d5e5ef] bg-white p-4 lg:w-80">
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="font-semibold">Profile completion</span>
                  <span className="font-bold">{progress}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-[#e4edf2]"><div className="h-full rounded-full bg-[#168f91] transition-all" style={{ width: `${progress}%` }} /></div>
                <div className="mt-3 flex items-center justify-between text-xs text-[#596f82]">
                  <span>{completed} of 5 steps complete</span>
                  {d.is_blacklisted ? <Badge tone="bad">Restricted</Badge> : <Status value={d.vetting_status} />}
                </div>
              </div>
            </div>
          </section>

          <div className="mb-5 flex items-start gap-3 rounded-2xl border border-[#cae7e3] bg-[#f1fbf9] px-4 py-3 text-sm text-[#275a59]">
            <svg aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-[#159b9c]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 3 5 6v5c0 4.2 2.9 8.1 7 9 4.1-.9 7-4.8 7-9V6l-7-3Z"/><path d="m9 12 2 2 4-5"/></svg>
            <p><strong>Your information stays protected.</strong> Tax and bank details are encrypted and used only for verification and creator payouts.</p>
          </div>

          <div className="mb-4"><h2 className="text-lg font-semibold text-[#17365a]">Profile details</h2><p className="mt-1 text-sm text-muted">Review your information and use the edit buttons to make changes.</p></div>
          <div className="grid items-start gap-4 lg:grid-cols-2">
          <Step n={1} title="Accept the terms" done={d.terms_accepted}>
            {d.terms_accepted ? <p className="text-muted">You accepted the current terms.</p> : <Button kind="primary" onClick={() => setTerms(true)}>Read and accept terms</Button>}
          </Step>
          <Step n={2} title="Add your PAN" done={!!d.pan_last4}>
            <p className="mb-3 text-sm text-muted">{d.pan_last4 ? <>PAN ending <strong className="text-ink">{d.pan_last4}</strong> <Status value={d.pan_status === 'VERIFIED' ? 'APPROVED' : 'PENDING'} /></> : 'Add your PAN for tax verification.'}</p>
            <Button onClick={() => setEdit('pan')}>{d.pan_last4 ? 'Edit PAN details' : 'Add PAN details'}</Button>
          </Step>
          <Step n={3} title="Add your bank account" done={!!d.payout_account}>
            <p className="mb-3 text-sm text-muted">{d.payout_account ? <><strong className="text-ink">{d.payout_account}</strong> <Status value={d.bank_confirmed ? 'APPROVED' : 'PENDING'} /></> : 'Add an account to receive your payouts.'}</p>
            <Button onClick={() => setEdit('pay')}>{d.payout_account ? 'Edit bank details' : 'Add bank details'}</Button>
          </Step>
          <Step n={4} title="Connect your accounts" done={!!(ig || yt)}>
            <p className="mb-3 text-muted">We use this to confirm your posts are live and read their views. We never post for you.</p>
            <div className="mb-3 rounded-xl border border-line bg-[#fafcfd] p-3">
              <h3 className="font-bold text-ink">Instagram</h3>
              {ig ? <p>Connected as @{ig.handle} ({count(ig.followers)} followers)</p> : <p className="mb-2 text-sm text-muted">Needs a Business or Creator account. You can switch for free in the Instagram app settings.</p>}
              <Button className="mt-1" busy={busy} onClick={() => run(async () => { const r = await api('/influencer/social/instagram/connect-url'); window.location.href = r.url; })}>{ig ? 'Reconnect Instagram' : 'Connect Instagram'}</Button>
            </div>
            <div className="rounded-xl border border-line bg-[#fafcfd] p-3"><h3 className="font-bold text-ink">YouTube</h3>
            <p className="mt-1 text-sm text-muted">{yt ? `Connected as @${yt.handle} (${count(yt.followers)} subscribers)` : 'Connect your channel to submit YouTube content.'}</p>
            <Button className="mt-3" onClick={() => setEdit('yt')}>{yt ? 'Change YouTube account' : 'Connect YouTube'}</Button>
            </div>
          </Step>
          <Step n={5} title="Wait for approval" done={d.vetting_status === 'APPROVED'}>
            <p className="text-muted">{d.vetting_status === 'APPROVED' ? 'You are approved and can submit to any open campaign.' : d.vetting_status === 'REJECTED' ? 'Your profile was not approved. Raise a ticket under Help to ask why.' : 'Our team reviews your profile.'}</p>
          </Step>
          </div>
        </div>}
      </Loaded>
      {terms && <TermsModal onClose={() => setTerms(false)} onAccepted={async () => { setTerms(false); toast('Terms accepted'); await me.reload(); }} />}
      {edit === 'pan' && <FormModal title={d?.pan_last4 ? 'Edit PAN details' : 'Add PAN details'} intro={d?.pan_last4 ? `Your saved PAN ends in ${d.pan_last4}. For security, enter the full PAN again to save changes.` : 'Enter the name exactly as it appears on your PAN. Your details are stored securely.'} submit="Save PAN" onClose={() => setEdit(null)} fields={[
        { name: 'pan', label: 'PAN', required: true, hint: 'Enter your 10-character PAN.' },
        { name: 'legalName', label: 'Name as on PAN', required: true, initial: d?.pan_legal_name ?? '' },
        { name: 'gstin', label: 'GSTIN (if you have one)', initial: d?.gstin ?? '' },
      ]} onSubmit={async (v) => { await api('/influencer/tax', 'PUT', { pan: v.pan, legalName: v.legalName, gstin: v.gstin || undefined }); toast('PAN saved'); await me.reload(); }} />}
      {edit === 'pay' && <FormModal title={d?.payout_account ? 'Edit bank details' : 'Add bank details'} intro={d?.payout_account ? `Saved account: ${d.payout_account}. For security, enter the full account number again. Changes pause payments until an admin confirms the account.` : 'Changes pause payments until an admin confirms the account. Enter your login password to confirm.'} submit="Save bank details" onClose={() => setEdit(null)} fields={[
        { name: 'accountHolder', label: 'Account holder name', required: true, initial: d?.payout_account_holder ?? '', hint: 'Exactly as your bank has it.' },
        { name: 'accountNumber', label: 'Account number', required: true, type: 'password' },
        { name: 'confirm', label: 'Enter account number again', required: true, type: 'password' },
        { name: 'ifsc', label: 'IFSC', required: true, initial: d?.payout_ifsc ?? '' },
        { name: 'currentPassword', label: 'Your login password', type: 'password', required: true },
      ]} onSubmit={async (v) => { if (v.accountNumber.trim() !== v.confirm.trim()) throw new Error('The two account numbers do not match.'); await api('/influencer/payout-account', 'PUT', { currentPassword: v.currentPassword, accountHolder: v.accountHolder, accountNumber: v.accountNumber.trim(), ifsc: v.ifsc }); toast('Bank details saved'); await me.reload(); }} />}
      {edit === 'yt' && !ytProof && <FormModal title={yt ? 'Change YouTube account' : 'Connect YouTube'} intro="Enter your channel handle. You will verify ownership with a short code." submit="Continue" onClose={() => setEdit(null)} fields={[{ name: 'handle', label: 'Your channel handle', required: true, placeholder: '@yourchannel' }]} onSubmit={async (v) => { const proof = await api('/influencer/social/youtube/start', 'POST', { handle: v.handle }); setYtProof(proof); }} />}
      {ytProof && <Modal title="Verify your YouTube channel" onClose={() => setYtProof(null)}><p className="mb-3 text-sm text-muted">Add this code to the description of <strong>{ytProof.channel}</strong> on YouTube, then come back. You can remove it afterwards.</p><p data-testid="yt-code" className="mb-4 inline-block rounded-lg border border-line bg-paper px-4 py-2 text-lg font-bold">{ytProof.code}</p><div className="flex flex-wrap justify-end gap-2"><Button onClick={() => setYtProof(null)}>Cancel</Button><Button kind="primary" busy={busy} onClick={() => run(async () => { const r = await api('/influencer/social/youtube/connect', 'POST', { proof: ytProof.proof }); setYtProof(null); toast(`Connected ${r.channel}`); await me.reload(); })}>I added the code</Button></div></Modal>}
    </>
  );
}
