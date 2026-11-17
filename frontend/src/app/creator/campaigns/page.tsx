'use client';
import { useState } from 'react';
import Link from 'next/link';
import { api, date, percent, rupees, useApi } from '@/lib/api';
import { Button, FormModal, Loaded, PageHead, useToast } from '@/components/ui';
import { TermsModal } from '@/components/TermsModal';

export default function Campaigns() {
  const list = useApi<any[]>('/influencer/campaigns');
  const me = useApi<any>('/influencer/me');
  const [submit, setSubmit] = useState<any>(null);
  const [terms, setTerms] = useState<any>(null);
  const toast = useToast();
  return (
    <>
      <PageHead title="Open campaigns" intro="Post the video live on your own account first, then paste the link here."
        action={<Link href="/creator/calculator" className="inline-block min-h-[40px] content-center rounded-[3px] border border-line bg-white px-3.5 text-sm font-semibold">Earnings calculator</Link>} />
      <Loaded state={list}>
        {list.data?.length === 0 && <p className="py-5 text-muted">No campaigns are open right now. New ones appear here as stores launch them.</p>}
        <ul>
          {list.data?.map((c) => (
            <li key={c.id} className="border-b border-line py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="max-w-2xl">
                  <h2 className="display">{c.title}</h2>
                  <p className="mt-1">{c.brief}</p>
                  <p className="mt-2 text-sm text-muted">{c.category}. Open until {date(c.expires_at)}. Needs at least {c.min_views} views and {percent(c.min_engagement_bps)} engagement after {c.measurement_days} days.</p>
                  <p className="mt-1 text-sm text-muted">Stores: {c.stores?.map((s: any) => s.name).join(', ')}</p>
                  {c.my_pay && <p data-testid="my-pay" className="mt-2 font-semibold">Your pay: {rupees(Math.round(c.my_pay.basePayPaise * c.my_pay.multiplierBps / 10000), false)}{c.my_pay.bonusPer10kPaise > 0 && <>, plus {rupees(Math.round(c.my_pay.bonusPer10kPaise * c.my_pay.multiplierBps / 10000), false)} per 10,000 views</>}. Up to {rupees(c.my_pay.maxPaise, false)} in total.</p>}
                  <PostingSpecs c={c} />
                </div>
                {c.my_entry
                  ? <p data-testid="already-entered" className="max-w-[16rem] text-sm"><b>You have a post in this campaign.</b> Each creator is paid once per campaign. Track it on <Link className="underline" href="/creator">Earnings</Link>.</p>
                  : <Button kind="primary" onClick={() => (me.data && !me.data.terms_accepted ? setTerms(c) : setSubmit(c))}>Submit a post</Button>}
              </div>
            </li>
          ))}
        </ul>
      </Loaded>
      {terms && <TermsModal onClose={() => setTerms(null)} onAccepted={async () => { await me.reload(); setSubmit(terms); setTerms(null); }} />}
      {submit && <FormModal title={`Submit to ${submit.title}`} submit="Submit post" onClose={() => setSubmit(null)}
        intro={<>{(submit.posting_hashtags?.length > 0 || submit.posting_mentions?.length > 0) && <span className="mb-2 block font-semibold text-ink">Check your caption includes {[...submit.posting_hashtags, ...submit.posting_mentions].join(' ')}. </span>}Your post must be public on your connected account. <Link className="underline" href="/creator/profile">Check your profile</Link></>}
        fields={[
          { name: 'postUrl', label: 'Link to your post', required: true, placeholder: 'https://www.instagram.com/reel/...', hint: 'An Instagram post or reel, or a YouTube video or Short.' },
          { name: 'storeId', label: 'Store featured', type: 'select', required: true, options: submit.stores?.map((s: any) => ({ value: s.id, label: `${s.name}, ${s.city}` })) },
          ...(submit.collab_account ? [{ name: 'collab', type: 'checkbox' as const, required: true, show: (v: any) => /instagram\.com/i.test(v.postUrl ?? ''),
            label: `I invited ${submit.collab_account} as a collaborator on this Instagram post` }] : []),
        ]}
        onSubmit={async (v) => {
          const r = await api('/influencer/submissions', 'POST', { campaignId: submit.id, storeId: v.storeId, postUrl: v.postUrl.trim(), collabConfirmed: Boolean(v.collab) });
          if (r.status === 'NOT_LIVE') toast(r.status_reason ?? 'We could not find this post on your account', true);
          else if (r.status === 'REJECTED') toast(r.status_reason ?? 'This post was not accepted', true);
          else toast(r.status === 'MEASURING' ? `Post found. Final check on ${date(r.measure_due_at)}.` : 'Post received. We will keep trying to check it.');
          await list.reload();
        }} />}
    </>
  );
}

function PostingSpecs({ c }: { c: any }) {
  const toast = useToast();
  const tags = [...(c.posting_hashtags ?? []), ...(c.posting_mentions ?? [])];
  if (!tags.length && !c.posting_guidelines && !c.required_disclosure && !c.collab_account) return null;
  return (
    <div className="mt-3 border-l-4 border-tag bg-white p-3">
      <h3 className="font-bold">What to put in your caption</h3>
      {tags.length > 0 && <div className="mt-2 flex flex-wrap items-center gap-2">
        <p data-testid="caption-tags" className="font-semibold">{tags.join(' ')}</p>
        <Button onClick={async () => { try { await navigator.clipboard.writeText(tags.join(' ')); toast('Copied. Paste them into your caption.'); } catch { toast('Copy did not work. Select the text instead.', true); } }}>Copy</Button>
      </div>}
      {c.required_disclosure && <p className="mt-1 text-sm">Also label it as an ad, for example with #ad.</p>}
      {c.posting_guidelines && <p className="mt-2 whitespace-pre-line text-sm">{c.posting_guidelines}</p>}
      {c.collab_account && <p data-testid="collab-ask" className="mt-2 text-sm"><b>On Instagram:</b> before you share, tap Tag people, then Invite collaborator, and add <b>{c.collab_account}</b>. Your post will also appear on our page.</p>}
      <p className="mt-2 text-sm text-muted">Posts missing these are held for review before payment.</p>
    </div>
  );
}
