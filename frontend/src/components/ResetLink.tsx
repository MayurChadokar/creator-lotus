'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { Button, Modal, useAct } from './ui';

/** Creates a one-time password reset link for someone who cannot receive email. */
export function ResetLinkButton({ id }: { id: string }) {
  const [link, setLink] = useState<string | null>(null);
  const { busy, run } = useAct();
  return (
    <>
      <Button busy={busy} onClick={() => run(async () => setLink((await api(`/admin/users/${id}/reset-link`, 'POST')).link))}>Reset password</Button>
      {link && <Modal title="One-time reset link" onClose={() => setLink(null)}>
        <p className="mb-3 text-sm text-muted">Send this only to the person themselves, after checking who they are. It works once, expires in 24 hours, and is not shown again.</p>
        <p className="break-all border border-line p-2 text-sm font-semibold">{link}</p>
        <div className="mt-4 flex justify-end"><Button onClick={() => setLink(null)}>Close</Button></div>
      </Modal>}
    </>
  );
}
