import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const printStyles = readFileSync(new URL('../../src/styles/print.css', import.meta.url), 'utf8');

for (const receiptId of ['printable-receipt', 'printable-exchange-slip']) {
  test(`${receiptId} prints the full receipt outside a scrolled dialog`, async ({ page }, testInfo) => {
    await page.route('http://127.0.0.1:5173/', (route) => route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html><body></body></html>',
    }));
    await page.goto('/');
    // Exercise printing without needing a database transaction or login.
    await page.setContent(`
      <style>
        body { margin: 0; background: #111; }
        #app { width: 1600px; height: 2000px; }
        [role="dialog"] {
          position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
          width: 400px; max-height: 350px; overflow-y: auto; padding: 24px;
        }
        #${receiptId} { width: 302px; margin: auto; padding: 20px; }
        p { margin: 0; line-height: 24px; }
        .truncate { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
      </style>
      <div id="app">Application content must not print</div>
      <div role="dialog">
        <h2>Dialog title must not print</h2>
        <div id="${receiptId}">
          <p>MERYL RECEIPT HEADER</p>
          ${Array.from({ length: 24 }, (_, index) => `<p>Item ${index + 1}: PHP 100.00</p>`).join('')}
          <p class="truncate">A long customer and product description that must wrap instead of losing information</p>
          <svg width="96" height="96" viewBox="0 0 96 96"><path d="M0 0h96v96H0z" fill="black" /></svg>
          <p>RECEIPT FOOTER</p>
        </div>
        <button>Print</button>
      </div>
    `);
    await page.addStyleTag({ content: printStyles });
    await page.evaluate(async () => {
      const { setupReceiptPrinting } = await import('/src/lib/receipt-print.ts');
      setupReceiptPrinting();
      document.querySelector('[role="dialog"]')!.scrollTop = 250;
      window.dispatchEvent(new Event('beforeprint'));
    });
    await expect(page.locator('#receipt-print-root')).toBeHidden();
    await page.emulateMedia({ media: 'print' });

    await expect(page.locator('#app')).toBeHidden();
    await expect(page.locator('[role="dialog"]')).toBeHidden();
    const receipt = page.locator('#receipt-print-content');
    await expect(receipt).toBeVisible();
    const box = await receipt.boundingBox();
    const expectedWidth = 120 * 96 / 25.4;
    expect(box!.x).toBeCloseTo((1280 - expectedWidth) / 2, 0);
    expect(box!.y).toBe(0);
    expect(box!.width).toBeCloseTo(expectedWidth, 0);
    expect(box!.height).toBeGreaterThan(700);
    await expect(receipt).toHaveCSS('font-size', '13px');
    await expect(receipt.locator('p').last()).toHaveText('RECEIPT FOOTER');
    await expect(receipt.locator('.truncate')).toHaveCSS('white-space', 'normal');
    await expect(receipt.locator('svg')).toHaveCSS('width', '96px');

    const pdf = await page.pdf({ format: 'A4', preferCSSPageSize: true });
    expect(pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)).toHaveLength(1);
    await testInfo.attach(`${receiptId}.pdf`, { body: pdf, contentType: 'application/pdf' });

    const thermalPdf = await page.pdf({ width: '80mm', height: '300mm', preferCSSPageSize: true });
    expect(thermalPdf.toString('latin1').match(/\/Type\s*\/Page\b/g)).toHaveLength(1);
    await testInfo.attach(`${receiptId}-thermal.pdf`, { body: thermalPdf, contentType: 'application/pdf' });

    // Closing/cancelling print restores the original dialog and removes the copy.
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await page.emulateMedia({ media: 'screen' });
    await expect(page.locator('#receipt-print-root')).toHaveCount(0);
    await expect(page.locator('[role="dialog"]')).toBeVisible();
    await expect(page.locator(`#${receiptId}`)).toHaveCount(1);
  });
}
