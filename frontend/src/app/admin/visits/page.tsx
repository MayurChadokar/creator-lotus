'use client';
import { useState } from 'react';
import { useApi } from '@/lib/api';
import { inputCls, PageHead } from '@/components/ui';
import { VisitDesk } from '@/components/VisitDesk';

export default function P() {
  const stores = useApi<any[]>('/admin/stores');
  const [storeId, setStoreId] = useState('');
  return (
    <>
      <PageHead title="Store visits" intro="Every store's visits. Choose a store to see only its requests and change its times." />
      <div className="mb-5 max-w-md">
        <label htmlFor="admin-store" className="mb-1 block text-sm font-semibold">Store</label>
        <select id="admin-store" className={inputCls} value={storeId} onChange={(e) => setStoreId(e.target.value)}>
          <option value="">All stores</option>
          {stores.data?.map((s) => <option key={s.id} value={s.id}>{s.name}, {s.city}</option>)}
        </select>
      </div>
      <VisitDesk key={storeId} base="/admin" storeId={storeId || null} />
    </>
  );
}
