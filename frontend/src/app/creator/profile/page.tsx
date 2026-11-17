'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { api, count, useApi } from '@/lib/api';
import { Badge, Button, Loaded, PageForm, PageHead, Status, useAct, useToast } from '@/components/ui';
import { TermsModal } from '@/components/TermsModal';

function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children: ReactNode }) {
  return (
    <section className="mb-7 border-t-2 border-ink pt-3">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="display text-lg">{n}</span>
        <h2 className="display">{title}</h2>
        {done && <Badge tone="good">Done</Badge>}
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
  return (
    <>
      <PageHead title="Your profile" intro="Finish these steps to start submitting posts." action={d && (d.is_blacklisted ? <Badge tone="bad">Account restricted</Badge> : <Status value={d.vetting_status} />)} />
      <Loaded state={me}>
        {d && <div className="max-w-2xl">
          <Step n={1} title="Accept the terms" done={d.terms_accepted}>
            {d.terms_accepted ? <p className="text-muted">You accepted the current terms.</p> : <Button kind="primary" onClick={() => setTerms(true)}>Read and accept terms</Button>}
          </Step>
          <Step n={2} title="Add your PAN" done={!!d.pan_last4}>
            {d.pan_last4 && edit !== 'pan' ? (
              <p>PAN ending <strong>{d.pan_last4}</strong> <Status value={d.pan_status === 'VERIFIED' ? 'APPROVED' : 'PENDING'} /> <button className="ml-2 text-link underline" onClick={() => setEdit('pan')}>Change</button></p>
            ) : (
              <PageForm submit="Save PAN" fields={[
                { name: 'pan', label: 'PAN', required: true, placeholder: 'ABCDE1234F', hint: 'Needed for tax deduction at source. Stored encrypted.' },
                { name: 'legalName', label: 'Name as on PAN', required: true },
                { name: 'gstin', label: 'GSTIN (if you have one)' },
              ]} onSubmit={async (v) => { await api('/influencer/tax', 'PUT', { pan: v.pan, legalName: v.legalName, gstin: v.gstin || undefined }); setEdit(null); toast('PAN saved'); await me.reload(); }} />
            )}
          </Step>
          <Step n={3} title="Add your bank account" done={!!d.payout_account}>
            {d.payout_account && edit !== 'pay' ? (
              <p><strong>{d.payout_account}</strong> <Status value={d.bank_confirmed ? 'APPROVED' : 'PENDING'} /> <button className="ml-2 text-link underline" onClick={() => setEdit('pay')}>Change</button></p>
            ) : (
              <PageForm submit="Save bank details" fields={[
                { name: 'accountHolder', label: 'Account holder name', required: true, hint: 'Exactly as your bank has it. Any change pauses payments until an admin confirms it.' },
                { name: 'accountNumber', label: 'Account number', required: true, type: 'password' },
                { name: 'confirm', label: 'Enter account number again', required: true },
                { name: 'ifsc', label: 'IFSC', required: true, placeholder: 'HDFC0001234' },
                { name: 'currentPassword', label: 'Your login password', type: 'password', required: true, hint: 'To confirm this is really you.' },
              ]} onSubmit={async (v) => {
                if (v.accountNumber.trim() !== v.confirm.trim()) throw new Error('The two account numbers do not match.');
                await api('/influencer/payout-account', 'PUT', { currentPassword: v.currentPassword, accountHolder: v.accountHolder, accountNumber: v.accountNumber.trim(), ifsc: v.ifsc });
                setEdit(null); toast('Bank details saved'); await me.reload();
              }} />
            )}
          </Step>
          <Step n={4} title="Connect your accounts" done={!!d.social}>
            <p className="mb-3 text-muted">We use this to confirm your posts are live and read their views. We never post for you.</p>
            <div className="mb-5">
              <h3 className="font-bold">Instagram</h3>
              {ig ? <p>Connected as @{ig.handle} ({count(ig.followers)} followers)</p> : <p className="mb-2 text-sm text-muted">Needs a Business or Creator account. You can switch for free in the Instagram app settings.</p>}
              <Button className="mt-1" busy={busy} onClick={() => run(async () => { const r = await api('/influencer/social/instagram/connect-url'); window.location.href = r.url; })}>{ig ? 'Reconnect Instagram' : 'Connect Instagram'}</Button>
            </div>
            <h3 className="font-bold">YouTube</h3>
            {yt && edit !== 'yt' ? <p>Connected as @{yt.handle} ({count(yt.followers)} subscribers) <button className="ml-2 text-link underline" onClick={() => setEdit('yt')}>Change</button></p> : (
              ytProof ? (
                <div className="max-w-md">
                  <p className="mb-2">Add this code anywhere in the description of <strong>{ytProof.channel}</strong> on YouTube, then come back. You can remove it afterwards.</p>
                  <p data-testid="yt-code" className="mb-3 inline-block border border-line bg-white px-3 py-2 text-lg font-bold">{ytProof.code}</p>
                  <div><Button kind="primary" busy={busy} onClick={() => run(async () => { const r = await api('/influencer/social/youtube/connect', 'POST', { proof: ytProof.proof }); setYtProof(null); setEdit(null); toast(`Connected ${r.channel}`); await me.reload(); })}>I added the code</Button></div>
                </div>
              ) : (
                <PageForm submit="Continue" fields={[{ name: 'handle', label: 'Your channel handle', required: true, placeholder: '@yourchannel', hint: 'Next you prove it is yours with a short code.' }]}
                  onSubmit={async (v) => setYtProof(await api('/influencer/social/youtube/start', 'POST', { handle: v.handle }))} />
              )
            )}
          </Step>
          <Step n={5} title="Wait for approval" done={d.vetting_status === 'APPROVED'}>
            <p className="text-muted">{d.vetting_status === 'APPROVED' ? 'You are approved and can submit to any open campaign.' : d.vetting_status === 'REJECTED' ? 'Your profile was not approved. Raise a ticket under Help to ask why.' : 'Our team reviews your profile.'}</p>
          </Step>
        </div>}
      </Loaded>
      {terms && <TermsModal onClose={() => setTerms(false)} onAccepted={async () => { setTerms(false); toast('Terms accepted'); await me.reload(); }} />}
    </>
  );
}
