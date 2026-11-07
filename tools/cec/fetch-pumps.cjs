// Download every CEC "Dedicated-Purpose Pool Pump" detail record (approved + archived) as JSON lines,
// the input for tools/import-pumps.mjs.
//
//   node tools/cec/fetch-pumps.cjs sources/cec/dppp-YYYY-MM-DD.jsonl
//
// Needs Playwright with Chromium (npm i playwright && npx playwright install chromium) and network
// access to cacertappliances.energy.ca.gov. Takes ~1.5-2 hours for ~1,850 records: it fetches one
// record at a time with a pause, to be polite to the state's server. Safe to stop and re-run: rows
// already in the output file are skipped.
//
// How it works: CEC's database (MAEDbS) is an ASP.NET site with no bulk export of the technical fields
// (its CSV/Excel export only has model, brand and dates). So it runs the "Pool Products > Dedicated-
// Purpose Pool Pumps" search once in a real browser, then replays the page's own form posts
// ("Select$i" for each row, "Page$n" for paging) with the browser's cookies, and reads the fields off
// each detail page. Field labels are taken from the rendered page, so CEC renaming a field shows up as
const fs = require('fs');
const { chromium } = require('playwright');
const STATUS = { approved: '1b8a27c3-a453-4287-b3ba-ebc403a6406d', archived: 'f2c14942-cd42-404f-8921-b023d568b0ae' };
async function search(page, type, status) {
  await page.goto('https://cacertappliances.energy.ca.gov/Pages/ApplianceSearch.aspx', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.click('a[href*="ApplianceTypeTab"]'); await page.waitForTimeout(3000);
  await page.selectOption('#ctl00_MainContent_ddlCategories_dropDownList', 'b3aa5cd9-c43d-40db-aefc-8998d1638e2f'); await page.waitForTimeout(4000);
  await page.selectOption('#ctl00_MainContent_ddlApplianceTypes_dropDownList', type); await page.waitForTimeout(4000);
  if (status) { await page.click('a[href*="ModelStatusTab"]'); await page.waitForTimeout(3000); await page.selectOption('#ctl00_MainContent_ddlModelStatus_dropDownList', STATUS[status]); await page.waitForTimeout(3000); }
  await page.click('#ctl00_MainContent_searchButton'); await page.waitForTimeout(9000);
  return ((await page.evaluate(() => document.body.innerText)).match(/(\d[\d,]*) record\(s\) found/) || [null, '0'])[1];
}
const [OUT, MAX] = [process.argv[2], Number(process.argv[3] || Infinity)];
const TYPE = '692e9a17-de25-4658-bb61-aebd87aa70c9';
const BASE = 'https://cacertappliances.energy.ca.gov/Pages/';
const PAUSE_MS = 600;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const done = new Set(fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').split('\n').filter(Boolean).map((l) => { const j = JSON.parse(l); return j._status + '|' + j._row; }) : []);

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const formFields = (html) => {
  const f = {};
  for (const m of html.matchAll(/<input[^>]*type="hidden"[^>]*>/g)) {
    const n = (m[0].match(/name="([^"]*)"/) || [])[1]; const v = (m[0].match(/value="([^"]*)"/) || [])[1] || '';
    if (n) f[n] = decode(v);
  }
  return f;
};
// Read every MainContent input/select value from a detail page, keyed by control id.
const detailValues = (html) => {
  const out = {};
  for (const m of html.matchAll(/<input[^>]*id="(ctl00_MainContent_[^"]+)"[^>]*>/g)) {
    if (/type="(hidden|submit|button)"/.test(m[0])) continue;
    const v = (m[0].match(/value="([^"]*)"/) || [])[1]; if (v != null && v !== '') out[m[1]] = decode(v);
  }
  for (const m of html.matchAll(/<select[^>]*id="(ctl00_MainContent_[^"]+)"[^>]*>([\s\S]*?)<\/select>/g)) {
    const sel = (m[2].match(/<option[^>]*selected="selected"[^>]*>([^<]*)<\/option>/) || [])[1];
    if (sel && sel !== 'Please Select') out[m[1]] = decode(sel);
  }
  return out;
};

(async () => {
  const browser = await chromium.launch(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY } } : {});
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const req = ctx.request;
  const out = fs.createWriteStream(OUT, { flags: 'a' });
  let labels = null, written = 0;

  for (const status of ['approved', 'archived']) {
    const total = Number(String(await search(page, TYPE, status)).replace(/,/g, ''));
    console.log(`${status}: ${total} records`);
    let html = await page.content();
    // Label map (control id -> visible label), built once from a rendered detail page.
    if (!labels) {
      await page.locator('a:text-is("Select")').nth(0).click();
      await page.waitForURL(/ApplianceDetail/, { timeout: 30000 });
      labels = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('input[id*=MainContent],select[id*=MainContent]')].map((e) => {
        const lab = document.querySelector('label[for="' + e.id + '"]'); let t = lab ? lab.innerText : '';
        let n = e.parentElement; for (let i = 0; i < 5 && n && !t.trim(); i++, n = n.parentElement) { const c = n.cloneNode(true); c.querySelectorAll('select,input,script,style').forEach((x) => x.remove()); t = c.innerText; }
        return [e.id, t.replace(/\s+/g, ' ').replace(/^\*/, '').trim()];
      })));
      fs.writeFileSync(OUT.replace(/\.jsonl$/, '') + '.labels.json', JSON.stringify(labels, null, 1));
      await search(page, TYPE, status); html = await page.content();
    }
    const pages = Math.ceil(total / 25);
    let formState = formFields(html);
    for (let pg = 1; pg <= pages; pg++) {
      if (pg > 1) { // move the grid to page pg via the site's own postback, from the previous page's state
        const r = await req.post(BASE + 'ApplianceSearch.aspx', { form: { ...formState, __EVENTTARGET: 'ctl00$MainContent$gvApplianceBase', __EVENTARGUMENT: 'Page$' + pg } });
        html = await r.text(); formState = formFields(html); await sleep(PAUSE_MS);
      }
      const rows = Math.min(25, total - (pg - 1) * 25);
      for (let i = 0; i < rows; i++) {
        const rowNo = (pg - 1) * 25 + i;
        if (rowNo >= MAX) break;
        if (done.has(status + '|' + rowNo)) continue;
        let rec = null;
        for (let attempt = 1; attempt <= 3 && !rec; attempt++) {
          try {
            const r = await req.post(BASE + 'ApplianceSearch.aspx', { form: { ...formState, __EVENTTARGET: 'ctl00$MainContent$gvApplianceBase', __EVENTARGUMENT: 'Select$' + i } });
            const d = await r.text();
            if (!/ApplianceDetail|ModelNumber_regularTextBox/.test(d + r.url())) throw new Error('not a detail page');
            const vals = detailValues(d);
            rec = { _status: status, _row: rowNo };
            for (const [id, v] of Object.entries(vals)) rec[labels[id] || id] = v;
          } catch (e) { console.log(`row ${rowNo} attempt ${attempt}: ${e.message}`); await sleep(3000 * attempt); }
        }
        if (rec) { out.write(JSON.stringify(rec) + '\n'); written++; }
        if (written % 50 === 0 && rec) console.log(`${status} ${rowNo + 1}/${total} (${written} written)`);
        await sleep(PAUSE_MS);
      }
      if ((pg - 1) * 25 >= MAX) break;
    }
  }
  out.end(); await browser.close();
  console.log(`done: ${written} new records`);
})();
