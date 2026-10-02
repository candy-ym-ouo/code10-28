import { expect, test } from "@playwright/test";

function createWav(): Buffer {
  const sampleRate = 44_100;
  const samples = sampleRate;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index += 1) {
    buffer.writeInt16LE(Math.round(Math.sin((index * 2 * Math.PI * 440) / sampleRate) * 12_000), 44 + index * 2);
  }
  return buffer;
}

test("complete the practice review closed loop", async ({ page }) => {
  const email = `e2e-${Date.now()}@example.com`;
  await page.goto("/register");
  await page.getByLabel("展示名").fill("E2E 用户");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel(/^密码/).fill("Practice1234");
  await page.getByLabel("确认密码").fill("Practice1234");
  await page.getByRole("button", { name: "创建账户" }).click();
  await expect(page.getByRole("heading", { name: "今天继续练习什么？" })).toBeVisible();

  await page.goto("/sessions/new");
  await page.getByLabel("练习标题 / 曲目片段").fill("E2E 节奏练习");
  await page.getByLabel("乐器").fill("小提琴");
  await page.getByRole("button", { name: "创建并上传音频" }).click();
  await expect(page.getByRole("heading", { name: "E2E 节奏练习" })).toBeVisible();

  await page.locator('input[type="file"]').setInputFiles({ name: "tone-1s.wav", mimeType: "audio/wav", buffer: createWav() });
  await expect(page.getByText("可用").first()).toBeVisible({ timeout: 60_000 });

  await page.getByRole("button", { name: "新增标记" }).click();
  await page.getByLabel("短标题").fill("第一拍抢拍");
  await page.getByLabel("详细描述").fill("节拍器落点前抢先进入");
  await page.getByRole("button", { name: "保存标记" }).click();
  await expect(page.getByText("第一拍抢拍")).toBeVisible();

  await page.getByLabel("下次练习重点（必填）").fill("17-24 小节保持 88 BPM");
  await page.getByRole("button", { name: "新增目标" }).click();
  await page.getByLabel("可执行标题").fill("17-24 小节连续 3 次保持 88 BPM");
  await page.getByLabel("目标值").fill("88");
  await page.getByRole("button", { name: "完成复盘" }).click();

  await expect(page.getByText("已完成").first()).toBeVisible();
  await page.goto("/statistics");
  await expect(page.getByText("完成练习")).toBeVisible();
  await expect(page.getByText("1 次")).toBeVisible();
});
