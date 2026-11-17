'use client';
import { useState } from 'react';
import { PageHead } from '@/components/ui';
import { VisitDesk } from '@/components/VisitDesk';

const myStore = () => { try { return JSON.parse(atob(localStorage.getItem('session-token')!.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))).storeId as string; } catch { return null; } };
export default function P() {
  const [storeId] = useState(myStore);
  return <><PageHead title="Store visits" intro="Creators film demos here at the store. Approve their visits so the team and display are ready, and open only the times that avoid your rush hours." /><VisitDesk base="/manager" storeId={storeId} /></>;
}
