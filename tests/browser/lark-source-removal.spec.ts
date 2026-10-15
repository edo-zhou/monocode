import { expect, test, type Page } from "@playwright/test";

const pageErrors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  pageErrors.set(page, errors);
});

test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page)).toEqual([]);
});

test("confirms local source removal and leaves other tables and documents intact", async ({
  page,
}) => {
  await page.goto("/tests/browser/lark-inbox.html?records=1&all-sources=1");
  await expect(
    page.getByRole("button", { name: /: Checkout bug$/ }),
  ).toBeVisible();
  await page.getByLabel("Lark source", { exact: true }).selectOption("BaseA");
  await page.getByRole("button", { name: "Manage Lark", exact: true }).click();
  const remove = page.getByRole("button", {
    name: "Remove Frontend bugs",
    exact: true,
  });
  await remove.click();
  const dialog = page.getByRole("dialog", { name: "Remove table source?" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Frontend bugs");
  await expect(dialog).toContainText("will not be deleted");
  await expect(page.getByLabel("Enable Frontend bugs")).toBeChecked();
  await expect(
    dialog.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeFocused();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(remove).toBeFocused();
  await remove.click();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(remove).toBeFocused();
  await remove.click();
  await page.mouse.click(4, 4);
  await expect(dialog).toHaveCount(0);
  await expect(remove).toBeFocused();
  await remove.click();
  await dialog
    .getByRole("button", { name: "Remove source", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel("Enable Frontend bugs")).toHaveCount(0);
  await expect(page.getByLabel("Enable Backend bugs")).toBeChecked();
  await expect(page.getByLabel("Enable Checkout PRD")).toBeChecked();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Removed “Frontend bugs” from MonoCode" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "View Inbox", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /: Checkout bug$/ }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: /: Auth bug$/ })).toBeVisible();
  await page.getByRole("tab", { name: "Documents", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /: Checkout PRD$/ }),
  ).toBeVisible();
});

test("keeps a source on save failure and allows retry without leaving the confirmation", async ({
  page,
}) => {
  await page.goto(
    "/tests/browser/lark-inbox.html?records=1&all-sources=1&settings=1&remove-error=1",
  );
  await page
    .getByRole("button", { name: "Remove Frontend bugs", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Remove table source?" });
  const confirm = dialog.getByRole("button", {
    name: "Remove source",
    exact: true,
  });
  await confirm.focus();
  await confirm.click({ clickCount: 2 });
  await expect(
    dialog.getByRole("button", { name: "Removing…", exact: true }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Tab");
  await expect(
    dialog.getByRole("button", { name: "Close", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(page.getByLabel("Enable Frontend bugs")).toBeChecked();
  await page.evaluate(() =>
    window.dispatchEvent(new Event("fixture:fail-removal")),
  );
  await expect(dialog.getByRole("alert")).toContainText(
    "Could not save Lark settings",
  );
  await expect(page.getByLabel("Enable Frontend bugs")).toBeChecked();
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel("Enable Frontend bugs")).toHaveCount(0);
  await expect(page.getByLabel("Enable Backend bugs")).toBeChecked();
  await expect(
    page.getByRole("heading", { name: "Table sources (1)", exact: true }),
  ).toBeFocused();
});

test("removes a document separately and can add the same link again", async ({
  page,
}) => {
  await page.setViewportSize({ width: 480, height: 720 });
  await page.goto(
    "/tests/browser/lark-inbox.html?records=1&all-sources=1&settings=1",
  );
  await page
    .getByRole("button", { name: "Remove Checkout PRD", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Remove document source?" });
  await expect(dialog).toContainText(
    "The original Lark document will not be deleted.",
  );
  await expect(
    dialog.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    dialog.getByRole("button", { name: "Remove source", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    dialog.getByRole("button", { name: "Close", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    dialog.getByRole("button", { name: "Remove source", exact: true }),
  ).toBeFocused();
  await page.screenshot({
    path: test.info().outputPath("remove-document-confirmation.png"),
  });
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Documents (0)", exact: true }),
  ).toBeFocused();
  await expect(page.getByLabel("Enable Frontend bugs")).toBeChecked();
  await expect(page.getByLabel("Enable Backend bugs")).toBeChecked();
  await expect(page.getByLabel("Enable Checkout PRD")).toHaveCount(0);
  await page.getByRole("button", { name: "View Inbox", exact: true }).click();
  await page.getByRole("tab", { name: "Documents", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /: Checkout PRD$/ }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Manage Lark", exact: true }).click();
  await expect(page.getByLabel("Enable Frontend bugs")).toBeChecked();
  await expect(page.getByLabel("Enable Checkout PRD")).toHaveCount(0);
  await page
    .getByLabel("Lark source links")
    .fill("https://team.larksuite.com/docx/DocA");
  await page
    .getByRole("button", { name: "Validate links", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm 1 source", exact: true })
    .click();
  await expect(page.getByLabel("Enable Checkout PRD")).toBeChecked();
  await page.getByRole("button", { name: "View Inbox", exact: true }).click();
  await page.getByRole("tab", { name: "Documents", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /: Checkout PRD$/ }),
  ).toBeVisible();
});

test("removes a stale source preview without discarding other pending previews", async ({
  page,
}) => {
  await page.goto(
    "/tests/browser/lark-inbox.html?records=1&all-sources=1&settings=1",
  );
  await page
    .getByLabel("Lark source links")
    .fill(
      [
        "https://team.larksuite.com/base/BaseA?table=TableA",
        "https://team.larksuite.com/docx/DocA",
      ].join("\n"),
    );
  await page
    .getByRole("button", { name: "Validate links", exact: true })
    .click();
  await page.getByLabel("Select Frontend bugs", { exact: true }).check();
  await page.getByLabel("Select Checkout PRD", { exact: true }).check();
  await expect(
    page.getByRole("button", { name: "Confirm 2 sources", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Remove Frontend bugs", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Remove source", exact: true })
    .click();
  await expect(
    page.getByLabel("Select Frontend bugs", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByLabel("Select Checkout PRD", { exact: true }),
  ).toBeChecked();
  await page
    .getByRole("button", { name: "Confirm 1 source", exact: true })
    .click();
  await expect(page.getByLabel("Enable Frontend bugs")).toHaveCount(0);
  await expect(page.getByLabel("Enable Checkout PRD")).toBeChecked();
});
