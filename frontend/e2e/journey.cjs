// Clicks through the whole product as an admin, a store manager and a creator.
const { chromium, devices } = require('playwright');
const { Secret, TOTP } = require('../../backend/node_modules/otpauth');
const secrets = {};
const { execSync } = require('child_process');
const fs = require('fs');
const OUT = process.env.SHOTS; fs.mkdirSync(OUT, { recursive: true });
const WEB = 'http://localhost:3000';
const sql = (q) => execSync(`mysql -h 127.0.0.1 -P 3306 -u root browser -Nse "${q}"`).toString().trim();
const problems = [];
const dt = (days) => { const d = new Date(Date.now() + days * 864e5); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T10:00`; };

async function session(browser, opts, name) {
  const ctx = await browser.newContext({ ...opts, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !/40[0-9]|ERR_TUNNEL_CONNECTION_FAILED/.test(m.text())) problems.push(`${name} console: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`${name} crash: ${e.message}`));
  return page;
}
async function login(page, email) {
  await page.goto(`${WEB}/login`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('test-password-1');
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForFunction(() => /\/(admin|manager|creator)/.test(location.pathname) || /Enter your code|Turn on two-step/.test(document.body.innerText));
  if (await page.getByText('Turn on two-step').count()) {
    const secret = await page.getByTestId('totp-secret').innerText({ timeout: 8000 });
    secrets[email] = secret;
    await page.screenshot({ path: `${OUT}/two-step-setup.png` });
    await page.getByLabel('6-digit code').fill(new TOTP({ secret: Secret.fromBase32(secret) }).generate());
    await page.getByRole('button', { name: 'Turn on' }).click();
    await page.getByRole('button', { name: 'I have saved them' }).click();
  } else if (await page.getByText('Enter your code').count()) {
    await page.getByLabel('Code').fill(new TOTP({ secret: Secret.fromBase32(secrets[email]) }).generate());
    await page.getByRole('button', { name: 'Verify' }).click();
  }
  await page.waitForURL(/\/(admin|manager|creator)/);
}
async function shot(page, name) {
  await page.waitForTimeout(250);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (over > 0) problems.push(`${name}: sideways scroll of ${over}px`);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
}
const toast = (page, text) => page.getByText(text).first().waitFor({ timeout: 8000 });
const expectText = async (page, t, label) => { try { await page.getByText(t).first().waitFor({ timeout: 8000 }); console.log('ok  ', label); } catch { problems.push(`FAILED: ${label} (no "${t}")`); console.log('FAIL', label); await page.screenshot({ path: `${OUT}/FAIL-${label.replace(/\W+/g,'-')}.png`, fullPage: true }); } };

(async () => {
  try { fs.unlinkSync('/tmp/yt-desc'); } catch {}
  const browser = await chromium.launch();
  const desk = { viewport: { width: 1360, height: 850 } };
  const phone = devices['iPhone 13'];
  const admin = await session(browser, desk, 'admin'); const finance = await session(browser, desk, 'finance');
  const mgr = await session(browser, desk, 'manager'); const me = await session(browser, phone, 'creator');

  // Admin creates and opens a campaign
  await login(admin, 'admin@test.in');
  await admin.getByRole('button', { name: 'New campaign' }).click();
  const d = admin.getByRole('dialog');
  await d.getByLabel('Title').fill('Diwali TV reviews, Indore');
  await d.getByLabel('Brief for creators').fill('Film a short walk-through of our 55-inch TV range in store and mention the festive offer.');
  await d.getByLabel('Product category').selectOption({ label: 'TVs' });
  await d.getByLabel('Vijay Nagar Store, Indore').check();
  await d.getByLabel('Starts').fill(dt(-1)); await d.getByLabel('Ends').fill(dt(30));
  await d.getByLabel(/Total budget/).fill('50000'); await d.getByLabel('Maximum submissions').fill('20');
  await d.getByRole('tab', { name: 'Posting specs' }).click();
  await d.getByLabel('Hashtags the caption must include').fill('#LotusDiwali');
  await d.getByLabel('Caption instructions').fill('Say the store name in the first line.');
  await d.getByLabel('Instagram collab: account creators must invite').fill('lotuselectronics');
  await shot(admin, 'admin-posting-specs');
  await d.getByRole('button', { name: 'Save as draft' }).click();
  await expectText(admin, 'Diwali TV reviews, Indore', 'admin created campaign');
  await admin.getByRole('button', { name: 'Open', exact: true }).click();
  await expectText(admin, 'Campaign opened', 'admin opened campaign');
  await admin.getByRole('button', { name: 'Pay and targets' }).click();
  const pt = admin.getByRole('dialog');
  await pt.getByLabel('Minimum views').fill('500');
  await pt.getByRole('tab', { name: 'Pay by level' }).click();
  await pt.getByLabel('Nano: base pay').fill('2500');
  await shot(admin, 'admin-pay-by-level');
  await pt.getByRole('button', { name: 'Save pay and targets' }).click();
  await expectText(admin, 'Fill in all three pay boxes for Nano', 'half-filled level pay is refused');
  await pt.getByLabel('Nano: base pay').fill('');
  await pt.getByRole('button', { name: 'Save pay and targets' }).click();
  await expectText(admin, 'Standard pay.', 'campaign keeps standard pay when levels are left empty');
  await shot(admin, 'admin-campaigns');

  // Public page and creator sign-up, on a phone
  await me.goto(WEB); await expectText(me, 'Diwali TV reviews, Indore', 'public page lists campaign');
  await shot(me, 'public-phone');
  await me.getByRole('link', { name: 'Join as a creator' }).click();
  await me.getByLabel('Full name').fill('Priya Sharma'); await me.getByLabel('Email').fill('priya@test.in');
  await me.getByLabel('Mobile number').fill('9876501234');
  await me.getByLabel('Your nearest store').selectOption({ label: 'Vijay Nagar Store, Indore' });
  await me.getByLabel('City').fill('Indore'); await me.getByLabel('Password').fill('test-password-1');
  await shot(me, 'register-phone');
  await me.getByLabel(/I agree to my details/).check();
  await me.getByRole('button', { name: 'Create account' }).click();
  await me.waitForURL(/creator\/profile/);
  // Terms modal opens by itself; accept stays locked until the end is reached
  const t = me.getByRole('dialog');
  await t.getByText('Scroll to the end').waitFor();
  await shot(me, 'terms-phone');
  if (!(await t.getByRole('button', { name: 'Accept terms' }).isDisabled())) problems.push('Accept enabled before reading');
  await t.getByLabel('Terms text').evaluate((e) => { e.scrollTop = e.scrollHeight; });
  await t.getByRole('checkbox').check();
  await t.getByRole('button', { name: 'Accept terms' }).click();
  await toast(me, 'Terms accepted'); console.log('ok   terms accepted');
  await me.getByLabel('PAN', { exact: true }).fill('nope');
  await me.getByLabel('Name as on PAN').fill('Priya Sharma');
  await me.getByRole('button', { name: 'Save PAN' }).click();
  await expectText(me, 'valid 10-character PAN', 'bad PAN refused with a clear message');
  await me.getByLabel('PAN', { exact: true }).fill('abcpe1234k');
  await me.getByRole('button', { name: 'Save PAN' }).click();
  await expectText(me, 'PAN saved', 'PAN saved');
  await me.getByLabel('Account holder name').fill('Priya Sharma');
  await me.getByLabel('Account number', { exact: true }).fill('123456789012345678'); await me.getByLabel('Enter account number again').fill('123456789012345679'); await me.getByLabel('IFSC').fill('hdfc0001234');
  await me.getByLabel('Your login password').fill('test-password-1');
  await me.getByRole('button', { name: 'Save bank details' }).click();
  await expectText(me, 'do not match', 'mismatched account numbers refused');
  await me.getByLabel('Enter account number again').fill('123456789012345678');
  await me.getByRole('button', { name: 'Save bank details' }).click();
  await expectText(me, 'Bank details saved', 'bank details saved');
  await me.getByLabel('Your channel handle').fill('@priyatech');
  await me.getByRole('button', { name: 'Continue' }).click();
  const ytCode = await me.getByTestId('yt-code').innerText({ timeout: 8000 });
  await me.getByRole('button', { name: 'I added the code' }).click();
  await expectText(me, 'could not find', 'YouTube refused without the ownership code');
  fs.writeFileSync('/tmp/yt-desc', `Tech reviews ${ytCode}`);
  await me.getByRole('button', { name: 'I added the code' }).click();
  await expectText(me, 'Connected priyatech', 'YouTube connected after proving ownership');
  await shot(me, 'creator-profile-phone');
  if (sql("select count(*) from tax_records where pan_encrypted like '%ABCPE1234K%'") !== '0') problems.push('PAN stored in plain text');
  if (sql("select count(*) from payout_accounts where account_number_enc like '%1234567890%'") !== '0') problems.push('Account stored in plain text');

  // Submitting before approval is refused
  await me.goto(`${WEB}/creator/campaigns`);
  await me.getByRole('button', { name: 'Submit a post' }).click();
  await me.getByRole('dialog').getByLabel('Link to your post').fill('https://youtu.be/AAAAAAAAAA1');
  await me.getByRole('dialog').getByLabel('Store featured').selectOption({ index: 1 });
  await me.getByRole('dialog').getByRole('button', { name: 'Submit post' }).click();
  await expectText(me, 'awaiting approval', 'unapproved creator cannot submit');
  await me.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();

  // Vetting: one admin is enough
  await admin.goto(`${WEB}/admin/creators`);
  await admin.getByRole('button', { name: 'Approve', exact: true }).click();
  await admin.getByRole('dialog').getByLabel('Reason').fill('PAN checked');
  await admin.getByRole('dialog').getByRole('button', { name: 'Approve creator' }).click();
  await admin.getByRole('dialog').waitFor({ state: 'detached' });
  await expectText(admin, 'Confirmed', 'one admin approved creator');
  await shot(admin, 'admin-creators');
  await login(finance, 'finance@test.in');
  await login(mgr, 'manager@test.in');

  // Creator: calculator and real submission
  await me.goto(`${WEB}/creator/calculator`);
  await me.getByLabel('Product category').selectOption({ label: 'TVs' });
  await expectText(me, '₹3,000.00', 'calculator: 50,000 views on TVs = (1000+1000) x 1.5');

  await shot(me, 'creator-calculator-phone');
  await me.goto(`${WEB}/creator/campaigns`);
  await expectText(me, '#LotusDiwali', 'creator sees posting specs');
  await expectText(me, 'Invite collaborator', 'creator sees collab ask');
  await expectText(me, 'Your pay: ₹1,500, plus ₹300 per 10,000 views', 'creator sees their own pay for the campaign');
  await shot(me, 'creator-campaigns-phone');
  // A deleted post earns nothing
  await me.getByRole('button', { name: 'Submit a post' }).click();
  await me.getByRole('dialog').getByLabel('Link to your post').fill('https://youtu.be/GONEAAAAAAA');
  await me.getByRole('dialog').getByLabel('Store featured').selectOption({ index: 1 });
  await me.getByRole('dialog').getByRole('button', { name: 'Submit post' }).click();
  await expectText(me, 'does not exist', 'missing post told plainly');
  // A post that earned nothing frees the creator to try again
  await me.getByRole('button', { name: 'Submit a post' }).click();
  await me.getByRole('dialog').getByLabel('Link to your post').fill('https://www.youtube.com/shorts/AAAAAAAAAA1');
  await me.getByRole('dialog').getByLabel('Store featured').selectOption({ index: 1 });
  await me.getByRole('dialog').getByRole('button', { name: 'Submit post' }).click();
  await expectText(me, 'Post found', 'post verified live on submission');
  await expectText(me, 'You have a post in this campaign', 'second entry in the same campaign is blocked');
  if (await me.getByRole('button', { name: 'Submit a post' }).count()) problems.push('Submit button still shown after entering');
  await me.goto(`${WEB}/creator`);
  await expectText(me, 'Collecting views', 'tracker shows live post'); await expectText(me, 'Post not live', 'tracker shows missing post');
  await shot(me, 'creator-tracker-measuring-phone');

  // Admin approves the content
  await admin.goto(`${WEB}/admin/review`);
  await admin.getByRole('button', { name: 'Approve content' }).click();
  await toast(admin, 'Content approved'); console.log('ok   content approved by admin');
  await admin.goto(`${WEB}/admin/sharing`);
  await expectText(admin, 'Add it to your YouTube playlist', 'approved post waits on the sharing list');
  await shot(admin, 'admin-sharing');
  await admin.getByRole('button', { name: 'Mark as shared' }).first().click();
  await toast(admin, 'Marked as shared'); console.log('ok   post marked as shared');
  await shot(admin, 'admin-reviews');

  // Store sets its visit times; creator books; store approves
  await mgr.goto(`${WEB}/manager`);
  await mgr.getByRole('button', { name: 'Add a time' }).click();
  for (let d = 0; d < 7; d++) { if (d) await mgr.getByRole('button', { name: 'Add a time' }).click(); await mgr.getByLabel(`Day ${d + 1}`).selectOption(String(d)); }
  await mgr.getByRole('button', { name: 'Save times' }).click();
  await expectText(mgr, 'Visit times saved', 'store saved its visit times');
  await me.goto(`${WEB}/creator/visits`);
  await me.locator('button[aria-pressed]').first().waitFor({ timeout: 8000 });
  await shot(me, 'creator-visits-pick-phone');
  await me.getByRole('group', { name: 'Choose a day' }).getByRole('button').first().click();
  await me.getByRole('group', { name: 'Choose a time' }).getByRole('button').first().click();
  await me.getByLabel(/What will you film/).fill('Film the 55-inch TV range; please have the display on.');
  await me.getByRole('button', { name: 'Request this time' }).click();
  await expectText(me, 'Request sent', 'creator requested a visit');
  await expectText(me, 'Waiting for reply', 'visit waits for store approval');
  await mgr.reload();
  await mgr.getByRole('button', { name: 'Approve', exact: true }).click();
  await mgr.getByRole('dialog').getByLabel(/Note for the creator/).fill('See Ravi at the TV wall');
  await mgr.getByRole('dialog').getByRole('button', { name: 'Approve visit' }).click();
  await mgr.getByRole('dialog').waitFor({ state: 'detached' });
  await shot(mgr, 'manager-visits');
  await me.reload(); await expectText(me, 'See Ravi at the TV wall', 'creator sees store approval'); await shot(me, 'creator-visits-phone');

  // Measurement ends; the job approves and prepares a sheet
  sql("update submissions set measure_due_at=now()-interval '1 minute' where status='MEASURING'");
  const job = await (await fetch('http://localhost:4000/internal/run-jobs', { method: 'POST', headers: { 'x-jobs-secret': 'jobs' } })).json();
  console.log('job:', JSON.stringify({ finalized: job.finalized, batch: job.batch?.items, errors: job.errors }));

  // Finance: review, approve, release, download
  // Bank details must be confirmed before payment
  sql("delete from payment_batch_items where false");
  await finance.goto(`${WEB}/admin/creators`);
  await finance.getByRole('button', { name: 'Confirm bank details' }).click();
  await finance.getByRole('dialog').getByRole('button', { name: 'Confirm details' }).click();
  await expectText(finance, 'Bank details confirmed', 'admin confirmed bank details');
  await finance.goto(`${WEB}/admin/payments`);
  await finance.getByRole('button', { name: 'Create payment sheet' }).click();
  await expectText(finance, 'Payment sheet created', 'sheet created once bank confirmed');
  await finance.getByRole('button', { name: 'Details' }).first().click();
  // 62,000 views: 6 blocks x Rs 200 = Rs 1,200; (1000+1200) x 1.5 = Rs 3,300, under the TDS limit
  await expectText(finance, '₹3,300.00', 'sheet shows pay with no TDS under the limit');
  await shot(finance, 'admin-payments-before');
  await finance.getByRole('button', { name: 'Approve', exact: true }).click();
  await toast(finance, 'Sheet approved');
  await finance.getByRole('button', { name: 'Prepare for bank' }).click();
  await expectText(finance, '1 ready to pay', 'sheet prepared after live re-check');
  const [bf] = await Promise.all([finance.waitForEvent('download'), finance.getByRole('button', { name: 'Download bank file' }).click()]);
  fs.copyFileSync(await bf.path(), `${OUT}/bank-file.xlsx`); console.log('ok   bank file downloaded');
  await finance.getByRole('button', { name: 'Mark paid' }).click();
  await finance.getByRole('dialog').getByLabel(/Bank reference/).fill('HDFCN52026110312');
  await finance.getByRole('dialog').getByRole('button', { name: 'Mark paid' }).click();
  await expectText(finance, 'UTR HDFCN52026110312', 'bank reference recorded');
  const [dl] = await Promise.all([finance.waitForEvent('download'), finance.getByRole('button', { name: 'CSV' }).click()]);
  const csv = fs.readFileSync(await dl.path(), 'utf8'); console.log(csv.split('\n')[1]);
  if (!/3300\.00,0\.00,0\.00,3300\.00,PAID,HDFCN/.test(csv)) problems.push('CSV amounts wrong');
  const [dl2] = await Promise.all([finance.waitForEvent('download'), finance.getByRole('button', { name: 'Download TDS report' }).click()]);
  if (!fs.readFileSync(await dl2.path(), 'utf8').includes('ABCPE1234K')) problems.push('TDS report lacks PAN');
  await finance.getByText('UTR').first().waitFor();
  await finance.goto(`${WEB}/admin/creators`); await finance.getByRole('button', { name: 'Bank details' }).click();
  await expectText(finance, '123456789012345678', 'admin can view bank details in profile');
  await shot(finance, 'admin-bank-modal'); await finance.getByRole('dialog').getByRole('button', { name: 'Close' }).click(); await finance.goto(`${WEB}/admin/payments`);
  if (sql("select count(*) from audit_logs where action='BANK_DETAILS_VIEWED'") !== '2') problems.push('each bank view must be audited (expected 2)');
  await finance.getByRole('button', { name: 'Details' }).click();
  await shot(finance, 'admin-payments-after');
  if (sql("select status from payment_batch_items limit 1") !== 'PAID') problems.push('item not PAID');
  if (sql("select count(*) from audit_logs where action='TAX_REPORT_DOWNLOADED'") !== '1') problems.push('tax report not audited');

  // Creator sees money; raises a dispute; manager answers; ad rights
  await admin.goto(`${WEB}/admin/review`);
  await admin.getByRole('button', { name: 'Request ad rights' }).click();
  await admin.getByRole('dialog').getByLabel('Length').selectOption('90');
  await admin.getByRole('dialog').getByRole('button', { name: 'Send request' }).click();
  await admin.getByRole('dialog').waitFor({ state: 'detached' });
  await me.goto(`${WEB}/creator`);
  await expectText(me, 'paid ad for 90 days', 'creator sees ad request');
  await me.getByRole('button', { name: 'Accept' }).click();
  await toast(me, 'Ad rights accepted');
  await me.getByRole('button', { name: /You receive/ }).click();
  await expectText(me, 'You receive', 'creator sees payslip');
  await shot(me, 'creator-tracker-paid-phone');
  await me.goto(`${WEB}/creator/help`);
  await me.getByRole('button', { name: 'Raise a ticket' }).click();
  m = me.getByRole('dialog');
  await m.getByLabel(/Which post/).selectOption({ index: 1 });
  await m.getByLabel('Subject').fill('Views look low'); await m.getByLabel('What happened?').fill('My insights show more views than the tracker.');
  await m.getByRole('button', { name: 'Send ticket' }).click();
  await expectText(me, 'Views look low', 'ticket raised'); await shot(me, 'creator-help-phone');
  await admin.goto(`${WEB}/admin/review`);
  await admin.getByRole('button', { name: 'Resolve' }).click();
  m = admin.getByRole('dialog');
  await m.getByLabel('Decision').selectOption('deny'); await m.getByLabel(/Note/).fill('Figures match YouTube on the check date.');
  await m.getByRole('button', { name: 'Save resolution' }).click();
  await expectText(admin, 'Denied', 'admin resolved ticket');
  // Second admin blacklists; store login sees only visits
  await finance.goto(`${WEB}/admin/creators`);
  await finance.getByRole('button', { name: 'Blacklist' }).click();
  await finance.getByRole('dialog').getByLabel('Reason').fill('Test of blacklist');
  await finance.getByRole('dialog').getByRole('button', { name: 'Blacklist creator' }).click();
  await expectText(finance, 'Blacklisted', 'second admin blacklisted a creator');
  await finance.getByRole('button', { name: 'Remove from blacklist' }).click();
  await finance.getByRole('dialog').getByLabel('Reason').fill('Test finished');
  await finance.getByRole('dialog').getByRole('button', { name: 'Remove from blacklist' }).click();
  await finance.getByRole('dialog').waitFor({ state: 'detached' });
  await mgr.goto(`${WEB}/manager`);
  if ((await mgr.locator('aside a').count()) !== 1) problems.push('Store login shows more than store visits');
  await shot(mgr, 'store-only-visits');

  // Boundaries
  await mgr.goto(`${WEB}/admin`); await mgr.waitForURL(/login/); console.log('ok   manager cannot open admin pages');
  await login(mgr, 'manager@test.in');
  // Remaining admin pages, plus every staff page at phone width
  for (const [p, n] of [['/admin/matrix', 'admin-matrix'], ['/admin/review', 'admin-review'], ['/admin/audit', 'admin-audit']]) { await admin.goto(WEB + p); await shot(admin, n); }
  await admin.goto(`${WEB}/admin/matrix`);
  await admin.getByRole('button', { name: 'Edit' }).first().click();
  await admin.getByRole('dialog').getByLabel(/Base pay/).fill('1100');
  await admin.getByRole('dialog').getByRole('button', { name: 'Save tier' }).click();
  await expectText(admin, '₹1,100', 'rate card edited');
  await admin.getByRole('button', { name: 'Add holiday' }).click();
  await admin.getByRole('dialog').getByLabel('Date').fill('2026-11-09'); await admin.getByRole('dialog').getByLabel('Holiday').fill('Diwali');
  await admin.getByRole('dialog').getByRole('button', { name: 'Add holiday' }).click();
  await expectText(admin, 'Diwali', 'holiday added');
  const pa = await session(browser, phone, 'admin-phone'); await login(pa, 'admin@test.in');
  for (const p of ['/admin', '/admin/visits', '/admin/payments', '/admin/creators', '/admin/matrix', '/admin/review', '/admin/audit']) { await pa.goto(WEB + p); await shot(pa, 'phone' + p.replace(/\//g, '-')); }
  const pm = await session(browser, phone, 'manager-phone'); await login(pm, 'manager@test.in');
  for (const p of ['/manager']) { await pm.goto(WEB + p); await shot(pm, 'phone' + p.replace(/\//g, '-')); }
  // New store login: temporary password must be replaced; three logins each land in their own portal
  await admin.goto(`${WEB}/admin`);
  await admin.getByRole('button', { name: 'Add staff login' }).click();
  m = admin.getByRole('dialog');
  await m.getByLabel('Role').selectOption('STORE_MANAGER'); await m.getByLabel('Store').selectOption({ index: 1 });
  await m.getByLabel('Full name').fill('New Store Lead'); await m.getByLabel('Email').fill('store2@test.in'); await m.getByLabel(/Temporary password/).fill('temporary-pass-1');
  await m.getByRole('button', { name: 'Create login' }).click();
  await m.waitFor({ state: 'detached' });
  const fresh = await session(browser, desk, 'new-manager');
  await fresh.goto(`${WEB}/login`); await fresh.getByLabel('Email').fill('store2@test.in'); await fresh.getByLabel('Password').fill('temporary-pass-1');
  await fresh.getByRole('button', { name: 'Log in' }).click();
  await fresh.waitForURL(/change-password/);
  console.log('ok   new store login must change temporary password');
  await fresh.getByLabel('Temporary password').fill('temporary-pass-1'); await fresh.getByLabel('New password').fill('store-own-password-1');
  await fresh.getByRole('button', { name: 'Save password' }).click();
  await fresh.waitForURL(/\/manager/); console.log('ok   new store login reached store portal');
  await me.goto(`${WEB}/admin`); await me.waitForURL(/login/); console.log('ok   creator cannot open admin pages');
  const pub = await session(browser, desk, 'public');
  await pub.goto(`${WEB}/forgot`); await pub.getByLabel('Email').fill('priya@test.in'); await pub.getByRole('button', { name: /reset link/ }).click();
  await expectText(pub, 'reset link is on its way', 'forgot password works');
  if (sql("select count(*) from notifications_outbox where template='password_reset' and status='SENT'") !== '1') problems.push('Reset email not sent'); await pub.goto(WEB); await shot(pub, 'public-desktop');
  await browser.close();
  console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'NO PROBLEMS');
  process.exit(problems.length ? 1 : 0);
})().catch((e) => { console.error('JOURNEY STOPPED:', e.message.slice(0, 600)); console.log(problems.join('\n')); process.exit(2); });
