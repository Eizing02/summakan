import { expect, test } from '@playwright/test';

test('uses a chosen duration, scores once, advances, and stops immediately at the deadline', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('balance-quest-preferences', JSON.stringify({ quality: '2d', reduced: true, mute: true }));
    localStorage.setItem('balance-quest-first-camera', 'true');
    Math.random = () => .999999;
  });
  await page.clock.install();
  await page.goto('/');
  await page.getByRole('button', { name: 'แข่งจับเวลา' }).click();
  const minutes = page.getByRole('spinbutton', { name: 'กำหนดเวลาเอง (นาที)' });
  const start = page.getByRole('button', { name: 'เริ่มแข่ง' });
  await expect(minutes).toHaveValue('5');
  await page.getByRole('button', { name: '3 นาที' }).click();
  await expect(minutes).toHaveValue('3');
  await minutes.fill('61');
  await expect(start).toBeDisabled();
  await minutes.fill('1');
  await page.getByLabel('ประเภทโจทย์').selectOption('1');
  await start.click();
  await expect(page.getByRole('timer')).toHaveText('01:00');
  const equation = page.getByTestId('expression-left');
  await expect(equation).toHaveAttribute('aria-label', 'x + 1');
  for (const side of ['left', 'right']) {
    for (const symbol of ['−', '1']) {
      await page.locator('.inventory-tile[data-tile="' + symbol + '"]').click();
      await page.locator('[data-drop-side="' + side + '"]').click();
    }
  }
  await expect(page.locator('.race-correct annotation')).toHaveText('x = 3');
  await expect(page.getByTestId('race-score')).toHaveText('1 คะแนน');
  await expect(equation).toHaveAttribute('aria-label', 'x + 3');
  await expect(page.getByRole('timer')).not.toHaveText('01:00');

  await page.clock.fastForward(60_000);
  const summary = page.getByRole('dialog', { name: 'หมดเวลา' });
  await expect(summary.getByTestId('race-final-score')).toHaveText('1');
  await expect(summary.getByText('ทำถูก 1 ข้อ · ใช้เวลา 01:00')).toBeVisible();
  await expect(page.getByRole('timer', { includeHidden: true })).toHaveText('00:00');
  await expect(page.locator('.inventory-tile').first()).toBeDisabled();
  await summary.getByRole('button', { name: 'เลือกประเภทโจทย์' }).click();
  await expect(minutes).toHaveValue('1');
  await expect(page.getByLabel('ประเภทโจทย์')).toHaveValue('1');
});
