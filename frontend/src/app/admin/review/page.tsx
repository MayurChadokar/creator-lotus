'use client';
import { DisputeDesk, SubmissionDesk } from '@/components/desks';
import { PageHead, Section } from '@/components/ui';
export default function Review() {
  return (
    <>
      <PageHead title="Reviews and disputes" intro="All stores. Only admins can step in when a platform cannot be checked; every override is logged." />
      <Section title="Submissions"><SubmissionDesk base="/admin" canWaive /></Section>
      <Section title="Dispute tickets"><DisputeDesk base="/admin" canWaive /></Section>
    </>
  );
}
