'use client';
import { api, dateTimeIst, useApi } from '@/lib/api';
import { Button, Loaded, Notice, PageHead, Section, Table, useAct } from '@/components/ui';

export default function Sharing() {
  const list = useApi<any[]>('/admin/sharing');
  const { run, busy } = useAct();
  const mark = (id: string, done: boolean) => run(async () => { await api(`/admin/sharing/${id}`, 'POST', { done }); await list.reload(); }, done ? 'Marked as shared' : 'Moved back to the to-do list');
  const todo = list.data?.filter((r) => !r.shared_at);
  const done = list.data?.filter((r) => r.shared_at);
  const what = (r: any) => r.platform === 'INSTAGRAM'
    ? (r.collab_account ? (r.collab_confirmed ? `Accept the collab invite on ${r.collab_account}` : 'No collab asked for. Repost or share it if you like.') : 'Repost or share to your story')
    : 'Add it to your YouTube playlist';
  const cols = (isDone: boolean) => [
    { head: 'Creator', cell: (r: any) => <><b>{r.creator}</b><br /><span className="text-muted">{r.store}</span></> },
    { head: 'Campaign', cell: (r: any) => r.campaign },
    { head: 'Post', cell: (r: any) => <a className="underline" href={r.post_url} target="_blank" rel="noopener noreferrer">Open {r.platform === 'INSTAGRAM' ? 'Instagram' : 'YouTube'} post</a> },
    isDone
      ? { head: 'Shared', cell: (r: any) => `${dateTimeIst(r.shared_at)} by ${r.shared_by_name ?? 'admin'}` }
      : { head: 'What to do', cell: (r: any) => what(r) },
    { head: 'Action', cell: (r: any) => isDone
        ? <Button disabled={busy} onClick={() => mark(r.id, false)}>Undo</Button>
        : <Button kind="primary" disabled={busy} onClick={() => mark(r.id, true)}>Mark as shared</Button> },
  ];
  return (
    <>
      <PageHead title="Share on our pages" intro="Posts that passed content review, ready to show on your own Instagram and YouTube." />
      <Notice tone="info">Instagram: open the Instagram app on your company account and accept the creator's collab invite, under Notifications or Activity. The post then shows on your profile too. YouTube: add the video to a playlist on your channel. Then mark it as shared here.</Notice>
      <Loaded state={list}>
        <Section title="To do"><Table rows={todo} rowKey={(r) => r.id} empty="Nothing waiting. Approved posts appear here." cols={cols(false)} /></Section>
        <Section title="Shared"><Table rows={done} rowKey={(r) => r.id} empty="Nothing shared yet." cols={cols(true)} /></Section>
      </Loaded>
    </>
  );
}
