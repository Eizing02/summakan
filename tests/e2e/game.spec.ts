import { expect, test, type Locator, type Page } from '@playwright/test';

const tile = (page: Page, symbol: string) => page.locator('.inventory-tile').filter({ hasText: symbol });
const slot = (page: Page, side: 'left' | 'right') => page.locator('[data-drop-side="' + side + '"]');
const anchor = (page: Page, side: 'left' | 'right') => page.getByTestId('anchor-' + side);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('balance-quest-first-camera', 'true'));
});

async function reduced(page: Page) {
  await page.addInitScript(() => localStorage.setItem('balance-quest-preferences', JSON.stringify({ reduced: true, settle: 760, mute: true })));
}

async function tutorial(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'วิธีเล่น', exact: true }).click();
  await page.getByRole('button', { name: 'เล่นด้วยเมาส์' }).click();
  await expect(page.getByRole('heading', { name: 'ก้าวแรกสู่สมดุล' })).toBeVisible();
  await expect(page.locator('[data-renderer="3d"] canvas')).toBeVisible();
}

async function to(page: Page, source: Locator, target: Locator) {
  await source.hover();
  await page.mouse.down();
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
}

async function place(page: Page, symbol: string, side: 'left' | 'right') {
  await to(page, tile(page, symbol), slot(page, side));
}

async function clickTile(page: Page, symbol: string, side: 'left' | 'right') {
  await tile(page, symbol).click();
  await slot(page, side).click();
}

test('mouse tutorial from drag to equivalent rounds, answer verification, history and CSV', async ({ page }) => {
  await reduced(page);
  await tutorial(page);
  await tile(page, '+').hover();
  await expect(tile(page, '+')).toBeInViewport();
  await place(page, '+', 'left');
  await place(page, '3', 'left');
  await expect(page.getByTestId('expression-left')).toHaveAttribute('aria-label', 'x - 3 + 3');
  await expect(page.getByRole('status').filter({ hasText: 'ฝั่งซ้ายต่ำกว่า' })).toBeVisible();
  await expect.poll(async () => +(await anchor(page, 'left').getAttribute('data-angle'))!).toBeGreaterThan(0.15);
  const angles: number[] = [];
  for (let i = 0; i < 3; i++) {
    await place(page, '+', 'right');
    await place(page, '1', 'right');
    await expect.poll(async () => +(await anchor(page, 'right').getAttribute('data-angle'))!).toBeLessThan(.22 - .06 * i);
    angles.push(+(await anchor(page, 'right').getAttribute('data-angle'))!);
  }
  expect(angles[0]).toBeGreaterThan(angles[1]);
  expect(angles[2]).toBe(0);
  const correct = page.getByRole('dialog', { name: 'ถูกต้อง!' });
  await expect(correct.locator('.answer-value annotation')).toHaveText('x = 8');
  await expect(correct.getByRole('textbox')).toHaveCount(0);
  await expect(correct.getByRole('button', { name: 'ข้อต่อไป' })).toBeVisible();
  await correct.getByRole('button', { name: 'ดูผลและวิธีทำ' }).click();
  await expect(page.getByRole('heading', { name: 'ผ่านภารกิจ' })).toBeVisible();
  await page.getByRole('button', { name: 'ดูประวัติ' }).click();
  await expect(page.getByRole('dialog').getByText('x - 3 + 3 = 5 + 1 + 1 + 1')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'ปิด' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'ส่งออก CSV' }).click();
  expect((await download).suggestedFilename()).toBe('balance-quest-results.csv');
  await page.getByRole('button', { name: 'โจทย์ถัดไป' }).click();
  await expect(page.getByRole('heading', { name: 'สมการการบวก' })).toBeVisible();
});

test('invalid drop, removable pending operations, undo, resize, fullscreen and pause', async ({ page }) => {
  await reduced(page);
  await tutorial(page);
  await place(page, '4', 'left');
  await expect(page.getByText('วางเครื่องหมายก่อนวางตัวเลข')).toBeVisible();
  await place(page, '+', 'right');
  await place(page, '4', 'right');
  await expect.poll(async () => +(await anchor(page, 'right').getAttribute('data-angle'))!).toBeLessThan(-0.2);
  const projectedX = () => anchor(page, 'right').evaluate(node => node.style.getPropertyValue('--anchor-x'));
  const before = await projectedX();
  await page.setViewportSize({ width: 1160, height: 640 });
  await expect.poll(projectedX).not.toBe(before);
  const pending = page.getByRole('button', { name: 'หยิบ + 4 ออกจากฝั่งขวา' });
  await to(page, pending, page.locator('.inventory-header'));
  await expect.poll(async () => +(await anchor(page, 'right').getAttribute('data-angle'))!).toBe(0);
  await page.getByRole('button', { name: 'ย้อนกลับ' }).click();
  await expect(page.getByTestId('expression-right')).toHaveAttribute('aria-label', '5 + 4');
  const fullscreen = page.getByRole('button', { name: 'เต็มหน้าจอ', exact: true });
  await fullscreen.click();
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
  await page.getByRole('button', { name: 'ออกจากเต็มหน้าจอ' }).click();
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);
  await page.getByRole('button', { name: 'หยุดชั่วคราว' }).click();
  await expect(page.getByRole('dialog', { name: 'หยุดชั่วคราว' })).toBeVisible();
  await page.getByRole('button', { name: 'เล่นต่อ' }).click();
  await expect(page.getByRole('dialog', { name: 'หยุดชั่วคราว' })).toBeHidden();
});

test('teacher rejects malformed, unsupported and non-unique equations, and runs an ordered custom activity', async ({ page }) => {
  await reduced(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'โหมดครู', exact: true }).click();
  const equation = page.getByLabel('สมการที่กำหนดเอง');
  for (const [source, message] of [['x / 0 = 1', 'หารด้วย 0 ไม่ได้'], ['x = x', 'สมการเป็นจริงสำหรับ x ทุกค่า'],
    ['2x = x + 5', 'รองรับพจน์ x เพียงฝั่งเดียว'], ['x=alert(1)', 'ใช้จำนวนเต็ม']]) {
    await equation.fill(source);
    await page.getByRole('button', { name: 'เพิ่มสมการ' }).click();
    await expect(page.getByRole('status')).toContainText(message);
  }
  for (const source of ['3x=2', '-x=5']) {
    await equation.fill(source);
    await page.getByRole('button', { name: 'เพิ่มสมการ' }).click();
    await expect(page.getByRole('status')).toContainText('เพิ่มโจทย์');
  }
  await page.getByRole('button', { name: 'เลื่อนโจทย์ 2 ขึ้น' }).click();
  await page.getByLabel('แสดงคำใบ้').uncheck();
  await page.getByLabel('เปิดคำถาม POE').check();
  await page.getByRole('button', { name: 'เริ่มชุดกิจกรรม' }).click();
  await expect(page.getByRole('button', { name: 'คำใบ้' })).toHaveCount(0);
  await page.getByRole('button', { name: 'คาดการณ์' }).click();
  await page.getByLabel('คำคาดการณ์').fill('คูณด้วยจำนวนติดลบทั้งสองฝั่ง');
  await page.getByRole('dialog').getByRole('button', { name: 'ปิด' }).click();
  for (const side of ['left', 'right'] as const) {
    await clickTile(page, '×', side);
    await clickTile(page, '−', side);
    await clickTile(page, '1', side);
  }
  const correct = page.getByRole('dialog', { name: 'ถูกต้อง!' });
  await expect(correct.locator('.answer-value annotation')).toHaveText('x = -5');
  await correct.getByRole('button', { name: 'ดูผลและวิธีทำ' }).click();
  await expect(page.getByText('คำคาดการณ์ · คูณด้วยจำนวนติดลบทั้งสองฝั่ง')).toBeVisible();
  await page.getByRole('button', { name: 'โจทย์ถัดไป' }).click();
  await expect(page.getByTestId('expression-left')).toHaveAttribute('aria-label', '3x');
  await expect(page.getByTestId('expression-right')).toHaveAttribute('aria-label', '2');
  for (const side of ['left', 'right'] as const) {
    await clickTile(page, '÷', side);
    await clickTile(page, '3', side);
  }
  await expect(correct.locator('.answer-value annotation')).toHaveText(/frac.*2.*3/);
  await correct.getByRole('button', { name: 'ดูผลและวิธีทำ' }).click();
  await expect(page.getByRole('heading', { name: 'ผ่านภารกิจ' })).toBeVisible();
  await page.getByRole('button', { name: 'เมนูหลัก', exact: true }).click();
  await page.getByRole('button', { name: 'โหมดครู', exact: true }).click();
  await page.getByRole('button', { name: 'ผลประเมินในเครื่อง' }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: /3x=2/ })).toBeVisible();
});

test('2D mobile fallback supports click and keyboard, with the scale and inventory inside the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem('balance-quest-preferences', JSON.stringify({ quality: '2d', reduced: true, mute: true })));
  await page.goto('/');
  await page.getByRole('button', { name: 'เริ่มเรียนรู้' }).click();
  await expect(page.locator('.vector-scale')).toBeVisible();
  await expect(page.locator('.number-rail')).toBeInViewport();
  await expect(page.locator('.operator-rail')).toBeInViewport();
  await tile(page, '−').focus();
  await page.keyboard.press('Enter');
  await slot(page, 'left').focus();
  await page.keyboard.press('Enter');
  await clickTile(page, '3', 'left');
  await expect(page.getByTestId('expression-left')).toHaveAttribute('aria-label', 'x + 3 − 3');
  await expect.poll(async () => +(await anchor(page, 'left').getAttribute('data-angle'))!).toBeLessThan(0);
});

test('large digit tiles and both wide drop regions work away from the pans', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem('balance-quest-preferences', JSON.stringify({ quality: '2d', reduced: true, mute: true })));
  await page.goto('/');
  await page.getByRole('button', { name: 'เริ่มเรียนรู้' }).click();
  const region = (side: string) => page.locator('[data-drop-region="' + side + '"]');
  const mobileTile = (await tile(page, '4').boundingBox())!;
  expect(mobileTile.width).toBeGreaterThanOrEqual(44);
  expect(mobileTile.height).toBeGreaterThanOrEqual(44);
  await expect(region('left')).toHaveCount(0);

  await tile(page, '+').click();
  await expect(region('left')).toHaveAttribute('data-valid', 'true');
  await region('left').click({ position: { x: 19, y: 132 } });
  await expect(slot(page, 'left')).toHaveAccessibleName(/วางตัวเลข/);
  await expect(region('left')).toHaveCount(0);

  await page.setViewportSize({ width: 1280, height: 720 });
  const wideTile = (await tile(page, '4').boundingBox())!;
  expect(wideTile.width).toBeGreaterThanOrEqual(44);
  expect(wideTile.height).toBeGreaterThanOrEqual(44);
  const { x, y, width, height } = wideTile;
  await page.mouse.move(x + width / 2, y + height / 2);
  await page.mouse.down();
  const left = (await region('left').boundingBox())!;
  await page.mouse.move(left.x + 26, left.y + left.height - 85);
  await expect(region('left')).toHaveAttribute('data-over', 'true');
  await expect(region('right')).toHaveAttribute('data-valid', 'false');
  await page.mouse.up();
  await expect(page.getByTestId('expression-left')).toHaveAttribute('aria-label', 'x + 3 + 4');

  await tile(page, '+').click();
  const right = (await region('right').boundingBox())!;
  await region('right').click({ position: { x: right.width - 20, y: 146 } });
  await expect(slot(page, 'right')).toHaveAccessibleName(/วางตัวเลข/);
});

test.describe('edge inventories on touch screens', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 780 } });

  test('taps and drags across the stage while both inventories stay at the edges', async ({ page, context }) => {
    await page.addInitScript(() => localStorage.setItem('balance-quest-preferences', JSON.stringify({ quality: '2d', reduced: true, mute: true })));
    await page.goto('/');
    await page.getByRole('button', { name: 'เริ่มเรียนรู้' }).tap();
    const lab = (await page.locator('.lab').boundingBox())!;
    const digits = (await page.getByRole('group', { name: 'ตัวเลข' }).boundingBox())!;
    const operators = (await page.getByRole('group', { name: 'เครื่องหมาย' }).boundingBox())!;
    expect(digits.x).toBeLessThan(12);
    expect(digits.x + digits.width).toBeLessThan(lab.x);
    expect(operators.x).toBeGreaterThan(lab.x + lab.width);
    expect(operators.x + operators.width).toBeGreaterThan(378);

    await tile(page, '+').tap();
    await slot(page, 'left').tap();
    await expect(slot(page, 'left')).toHaveAccessibleName(/วางตัวเลข/);
    const digit = (await tile(page, '3').boundingBox())!;
    const from = { x: digit.x + digit.width / 2, y: digit.y + digit.height / 2 };
    const to = { x: lab.x + 13, y: lab.y + lab.height * .68 };
    const touch = await context.newCDPSession(page);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
    for (const fraction of [.2, .45, .75, 1]) {
      await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{
        x: from.x + (to.x - from.x) * fraction, y: from.y + (to.y - from.y) * fraction,
      }] });
    }
    await expect(page.locator('[data-drop-region="left"]')).toHaveAttribute('data-over', 'true');
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(page.getByTestId('expression-left')).toHaveAttribute('aria-label', 'x + 3 + 3');
  });
});

test('a level scale refuses to simplify when the two transformations are different', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('balance-quest-preferences', JSON.stringify({ quality: '2d', reduced: true, mute: true })));
  await page.goto('/');
  await page.getByRole('button', { name: 'เริ่มเรียนรู้' }).click();
  await clickTile(page, '×', 'left');
  await clickTile(page, '2', 'left');
  await clickTile(page, '+', 'right');
  await clickTile(page, '8', 'right');
  await expect(page.getByRole('status').filter({ hasText: 'ตาชั่งอยู่ในแนวระดับ แต่การดำเนินการทั้งสองฝั่งยังไม่สมมูลกัน' })).toBeVisible();
  await expect.poll(async () => +(await anchor(page, 'left').getAttribute('data-angle'))!).toBe(0);
  await page.getByRole('button', { name: 'ประวัติ' }).click();
  await expect(page.getByRole('dialog').getByText('ประวัติจะปรากฏเมื่อจัดรูปสมการรอบแรก')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'ปิด' }).click();
  await expect(page.getByTestId('expression-left')).toHaveAttribute('aria-label', '(x + 3) × 2');
  await expect(page.getByTestId('expression-right')).toHaveAttribute('aria-label', '8 + 8');
});
