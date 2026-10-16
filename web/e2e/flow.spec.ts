// E2E against a deployed environment (staging): drop sample plan → crop → (parse) → review → style → 3D.
//
//   E2E_BASE_URL=https://soraplan.web.app E2E_EMAIL=... E2E_PASSWORD=... npx playwright test
//
// Parsing calls the real worker (≈1 min); set E2E_STUB_PARSE=1 when the API runs with a stubbed worker.
import { expect, test } from "@playwright/test";
import path from "node:path";

const SAMPLE = path.resolve(__dirname, "../../samples/floorplan_1.png");

test.skip(!process.env.E2E_EMAIL, "set E2E_EMAIL / E2E_PASSWORD / E2E_BASE_URL");
test.setTimeout(6 * 60_000);

test("plan to 3D", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(process.env.E2E_EMAIL!);
  await page.getByLabel("Password").fill(process.env.E2E_PASSWORD!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Drop your floor plan to start a new project")).toBeVisible();

  // drop → preview → create
  await page.locator('input[type="file"]').setInputFiles(SAMPLE);
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL(/\/p\/[A-Za-z0-9]+$/, { timeout: 60_000 });

  // crop
  await expect(page.getByText("Let's crop your plan.")).toBeVisible();
  await page.getByRole("button", { name: "Confirm crop" }).click();
  await expect(page.getByText("Reading your floor plan…")).toBeVisible();

  // parse → review
  await expect(page.getByText("Your plan is ready.")).toBeVisible({ timeout: 4 * 60_000 });
  await page.getByRole("button", { name: "Looks right" }).first().click();

  // style
  await page.getByRole("button", { name: /Japandi/ }).click();
  const skip = page.getByRole("button", { name: /Skip (all|remaining)/ }).first();
  if (await skip.isVisible({ timeout: 15_000 }).catch(() => false)) await skip.click();

  // 3D
  await expect(page.getByText("Your 3D home is ready")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".canvas-pane canvas")).toBeVisible();

  // chat edit through Gemini
  await page.getByLabel("Message").fill("paint the walls white");
  await page.keyboard.press("Enter");
  await expect(page.getByText(/Wall color #/)).toBeVisible({ timeout: 60_000 });
});
