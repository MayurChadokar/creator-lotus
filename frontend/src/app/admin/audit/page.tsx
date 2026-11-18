'use client';
import { dateTimeIst, useApi } from '@/lib/api';
import { Loaded, PageHead, Table } from '@/components/ui';
const words = (s: string) => { const t = s.replaceAll('_', ' ').toLowerCase(); return t[0]!.toUpperCase() + t.slice(1); };
export default function Audit() {
  const list = useApi<any[]>('/admin/audit');
  return (
    <>
      <PageHead title="Audit log" intro="The latest 500 actions. Entries cannot be edited or deleted." />
      <Loaded state={list}>
        <Table rows={list.data} rowKey={(r) => r.id} empty="Nothing has been logged yet."
          cols={[
            { head: 'When (IST)', cell: (r) => dateTimeIst(r.created_at) },
            { head: 'Who', cell: (r) => r.actor ?? 'System' },
            { head: 'Action', cell: (r) => words(r.action) },
            { head: 'Reason', cell: (r) => r.reason ?? '-' },
          ]} />
      </Loaded>
    </>
  );
}
