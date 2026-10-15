# Lark / Feishu Inbox

MonoCode connects directly to the official OpenAPI. **Users do not need to install Lark CLI.**
This first version is a read-only, bring-your-own-app integration for Base tables and Docx/Wiki documents.
It does not provide personal OAuth login, native Task Center tasks, ordinary Sheets, legacy `/doc/` documents,
remote comments, status write-back, or Lark automation triggers.

## Connection and authorization

1. Create a self-built app in your region's developer console: [Lark](https://open.larksuite.com/app) or [Feishu](https://open.feishu.cn/app).
2. Request read scopes under **application identity permissions**, not only user identity permissions: `bitable:app:readonly`, `docx:document:readonly`, and `wiki:wiki:readonly` for Wiki links. Publish the app version and obtain administrator approval if your organization requires it.
3. Grant that app access to each Base/document or the relevant Wiki space. API scopes and resource permissions are separate. Advanced Base permissions can hide records even when requests succeed.
4. Open **Settings → Inbox → Lark / Feishu**, select the matching region, and enter your App ID and App Secret. **Verify and connect** checks credentials against the official API before saving them.
5. The App Secret is stored in the OS credential store. Non-secret source configuration is stored in `lark-config.json` in the app data directory. Access tokens are cached in native memory and renewed before expiry. Disconnect removes credentials and saved source configuration, not remote content.

This uses **app identity**, not the current user's personal Lark permissions. It cannot infer “assigned to me”.
Use a Base view filtered to your owner/status conditions and add that view's URL instead.
Do not distribute a shared app secret in an installation package or ask untrusted end users to use it.
A centrally distributed integration should use an OAuth/token-broker service rather than shipping an app secret.
Lark CLI remains an optional independent tool for agents; this Inbox never invokes it or reads its credentials.

### Connected, but link validation fails

Connecting verifies the credentials, not permission to read every resource. Lark can return HTTP `400` with
API code `99991672` when an application API scope is missing or not yet effective. MonoCode preserves the API
code and HTTP status and recommends a supported read scope from the permission response, without displaying
raw server messages or credentials. Open the app's **Permissions & Scopes**, enable the indicated application
identity scope, then publish and obtain approval if required. Use **Check connection** to refresh credentials
before validating the links again. If the next error reports resource access instead, have the owner grant
the app access to that Base, document or Wiki; API scopes do not replace resource permissions.

## Multiple links and validation gates

Paste up to 20 HTTPS links, one per line. Supported forms:

- `https://<tenant>.larksuite.com/base/<app_token>?table=<table_id>&view=<view_id>`
- `https://<tenant>.larksuite.com/docx/<document_id>`
- `https://<tenant>.larksuite.com/wiki/<node_token>`
- Corresponding `feishu.cn` links when connected to Feishu.

The verification flow is **connection → link type/region → resource access → sample content → field mapping → explicit confirmation**.

- A Base root link expands into its tables; a table/view link keeps that scope. For Bases with more than 20 tables, use individual table links.
- A Wiki link is resolved to its actual resource token and type. Wiki nodes are not assumed to be documents; a Wiki-backed Base becomes table sources.
- Verification reads table metadata, fields and sample records, or document metadata and plain text. Failed links remain visible with actionable errors while other links can succeed.
- Empty Base previews are not preselected. Confirm the view is genuinely empty and advanced permissions are correct before selecting them.
- Review the source name, title field, optional status/assignee fields, and exact values that mean closed. Mappings use field IDs so renamed fields continue working; removed fields require revalidation.
- Nothing is added until **Confirm sources**. The backend revalidates access and mappings before saving. An existing table is updated rather than duplicated, even when reached through another view or Wiki link.
- Each source can be disabled, revalidated/edited, or removed independently. There is a maximum of 50 configured sources. Removing a source never deletes its remote table or document.

### Removing a source in Settings

Use **Remove** on a saved table or document in **Settings → Inbox → Lark / Feishu**.
The confirmation shows its name and link and explains that only the MonoCode source is removed.
The original Lark table, Bug/task records and documents are never deleted; no remote delete API or write permission is used.
Cancel, Escape or clicking outside the dialog leaves the source unchanged. While saving, duplicate submissions
and dismissal are blocked. A failed save keeps the source and confirmation visible so you can retry.
After a successful removal, the source list and Inbox refresh; unrelated sources and the Lark connection remain intact.
Any pending validation preview for that source is also cleared so it cannot be accidentally re-added by **Confirm sources**.
To hide a source temporarily while keeping its mappings, uncheck it instead. A removed source can be added again
with the same link through the normal validation flow.

## Inbox behavior

- Provider tabs keep their labels at a readable width and scroll horizontally instead of overlapping. Use the trackpad, mouse wheel or arrow buttons; **+** stays visible for adding a connection. Drag tabs to reorder, including holding a tab near either edge to scroll. Order is saved on this device and retained when sources disconnect and reconnect. Keyboard users can select with Left/Right or Home/End and reorder with Alt+Left/Right; Escape cancels a drag.
- **Table records** aggregates enabled table sources, with an individual source selector, search and open/closed filters.
- The left record list stays in place. The right detail pane shows a **Field / Value** table in schema order, including empty fields. Text, people, selections, checkboxes, links and formula/lookup results retain their field types rather than becoming an unstructured text dump. Large integers retain their exact digits.
- Date fields are formatted in the device's locale and time zone; date-only fields omit the time, while created/modified times include it. The pane labels its time zone. Agent text context uses explicit UTC timestamps.
- Base attachment fields show names, types and sizes. Visible PNG/JPEG/GIF/WebP images up to 8 MB load lazily and open in the existing zoomable preview. Downloads are serialized, queued requests are cancelled when their UI unmounts, and media requests are rate-limited. An in-flight native download may finish after the user navigates away, but its result is ignored. Only four attachments per field are expanded initially; the user can reveal the rest.
- Image access is revalidated against the enabled source, record and attachment field. The native client constructs the official media URL and scoped Base permission parameters; it does not follow attachment URLs or expose access tokens to the renderer. Missing permissions show a retry action. Larger/non-image files and attachments derived from formula/lookup fields remain available through **Open record in Lark**. Ask/Send to agent still sends text context, not image bytes.
- **Documents** is a separate tab and selector; reference documents are not presented as Bug/task records. Issue status/time filters do not hide documents.
- **Ask** loads source context into the Inbox conversation. **Send to agent** / **Use as context** prepares a new session in the selected local project.
- Content remains read-only. Document previews use plain text; images, embedded tables, attachments and comments remain in Lark. Add embedded Base links separately.
- Pagination reads up to 1,000 records per source. A truncated source is explicitly reported; use a narrower view rather than treating the result as a complete count.
- One inaccessible source does not discard successful sources. Errors distinguish connectivity, authorization/resource access and rate limits. Refresh or revalidate after fixing permissions.
- Base records with a real modification timestamp participate in normal Inbox polling/notifications. Documents do not receive fabricated modification times or issue-created automation events.
- Context is capped at 32,000 characters with a visible truncation notice and the original source URL.

## User acceptance checklist

Use a non-production app and sample sources first. No remote write permission is needed.

1. **Credentials:** incorrect secret must show an error and not claim success; correct credentials must connect without any CLI installed. Restart and recheck using the system credential store.
2. **Permissions:** submit one permitted Base link, one private link and one permitted Docx link together. The private link must show an actionable error; the other two must still preview. Merely validating must not add Inbox sources.
3. **Two tables:** add two different Bug tables with different title/status/owner column names. Review mappings, confirm, then verify both sources and their records in Inbox. IDs must not collide across tables.
4. **Views:** add a filtered view URL; compare visible record IDs with that same view in Lark. An empty view should warn rather than claim there are no Bugs across the entire Base.
5. **Wiki:** test one Wiki-backed Base and one Wiki-backed Docx. The former belongs in Table records, the latter in Documents.
6. **Documents:** verify titles and plain-text content; switching to Documents must not mix in table records. Confirm **Use as context** and **Ask** include the correct content and link.
7. **Duplicate/rename:** validate the same table again and confirm it is recognized as existing. Rename a mapped column in Lark, refresh, and verify it still resolves by field ID.
8. **Independent control:** in Settings, click **Remove** on one table and cancel; the source must remain. Confirm removal and verify that only that source disappears from Settings and Inbox, while other tables/documents remain. Repeat for a document. Restart MonoCode and confirm source choices persist. The original table, Bug/task records and document must remain unchanged in Lark. Add the same link again to restore the source. Disable/re-enable remains a separate, temporary visibility control.
9. **Partial failure:** revoke access to one enabled source, refresh, and verify an error plus intact results from other sources. Restore access and retry.
10. **Limits/security:** test more than one page, Unicode/large content and malicious/off-domain links. Truncation must be visible; credentials must never appear in source configuration, browser storage, logs or agent context.
11. **Record fields:** select a Bug containing people, multiple options, unchecked/zero/empty values and date fields. Check the right-hand field table against Lark, verify the displayed device time zone and confirm the left list remains usable.
12. **Screenshots:** verify a real screenshot loads and can be enlarged/zoomed. Escape should close only the image. Revoke media access and check the retry/error state; verify large files, non-image attachments and unsupported formats show a Lark fallback rather than a broken thumbnail.

Automated tests use mocked native IPC / local HTTP fixtures. They are not proof of permissions or data fidelity against your tenant.

## API references

- [Lark app access token](https://open.larksuite.com/document/server-docs/getting-started/api-access-token/auth-v3/tenant_access_token_internal.md)
- [Base record search](https://open.feishu.cn/document/docs/bitable-v1/app-table-record/search.md)
- [Base record batch lookup](https://open.feishu.cn/document/docs/bitable-v1/app-table-record/batch_get.md)
- [Wiki node resolution](https://open.feishu.cn/document/server-docs/docs/wiki-v2/space-node/get_node.md)
- [Docx plain-text content](https://open.feishu.cn/document/server-docs/docs/docs/docx-v1/document/raw_content.md)
- [Base field value types](https://open.larksuite.com/document/uAjLw4CM/ukTMukTMukTM/reference/bitable-v1/app-table-record/bitable-record-data-structure-overview.md)
- [Download media](https://open.larksuite.com/document/server-docs/docs/drive-v1/media/download.md)
- [Base attachment permission parameters](https://open.larksuite.com/document/uAjLw4CM/ukTMukTMukTM/reference/drive-v1/media/introduction.md)
