'use client';
import { useState } from 'react';
import { api, useApi } from '@/lib/api';
import { Button, Loaded, Modal, Notice } from './ui';

/** Records the exact version the creator accepted. The accept box unlocks after they reach the end. */
export function TermsModal({ onClose, onAccepted }: { onClose: () => void; onAccepted: () => void }) {
  const doc = useApi<any>('/influencer/legal/current');
  const [read, setRead] = useState(false);
  const [agree, setAgree] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={doc.data?.title ?? 'Terms & Conditions'} wide onClose={onClose}>
      <Loaded state={doc}>
        <p className="mb-2 text-sm text-muted">Version {doc.data?.version}. This covers copyright transfer, brand rules, liability, and how disputes are handled.</p>
        <div tabIndex={0} aria-label="Terms text" ref={(el) => { if (el && el.scrollHeight <= el.clientHeight + 8) setRead(true); }}
          onScroll={(e) => { const t = e.currentTarget; if (t.scrollTop + t.clientHeight >= t.scrollHeight - 8) setRead(true); }}
          className="max-h-[45dvh] overflow-y-auto whitespace-pre-line border border-line p-3 text-sm leading-relaxed">{doc.data?.body}</div>
        {err && <div className="mt-3"><Notice tone="bad">{err}</Notice></div>}
        <label className={`mt-4 flex items-start gap-2 text-sm ${read ? '' : 'text-muted'}`}>
          <input type="checkbox" className="mt-0.5 h-4 w-4" disabled={!read} checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          {read ? 'I have read these terms and agree to them, including the transfer of copyright in my content.' : 'Scroll to the end of the terms to continue.'}
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={onClose}>Not now</Button>
          <Button kind="primary" busy={busy} disabled={!agree} onClick={async () => {
            setBusy(true);
            try { await api('/influencer/legal/accept', 'POST', { documentId: doc.data.id }); onAccepted(); }
            catch (e) { setErr((e as Error).message); setBusy(false); }
          }}>Accept terms</Button>
        </div>
      </Loaded>
    </Modal>
  );
}
