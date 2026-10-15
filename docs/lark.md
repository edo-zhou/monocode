# Lark / Feishu Inbox

MonoCode connects directly to the official OpenAPI. **Users do not need to install Lark CLI.**
This first version is a read-only, bring-your-own-app integration for Base tables and Docx/Wiki documents.
It does not provide personal OAuth login, native Task Center tasks, ordinary Sheets, legacy `/doc/` documents,
remote comments, status write-back, or Lark automation triggers.

## Connection and authorization

1. Create a self-built app in your region's developer console: [Lark](https://open.larksuite.com/app) or [Feishu](https://open.feishu.cn/app).
2. Request and publish read scopes: `bitable:app:readonly`, `docx:document:readonly`, and `wiki:wiki:readonly` for Wiki links. Your organization may require administrator approval.
3. Grant that app access to each Base/document or the relevant Wiki space. API scopes and resource permissions are separate. Advanced Base permissions can hide records even when requests succeed.
4. Open **Settings → Inbox → Lark / Feishu**, select the matching region, and enter your App ID and App Secret. **Verify and connect** checks credentials against the official API before saving them.
5. The App Secret is stored in the OS credential store. Non-secret source configuration is stored in `lark-config.json` in the app data directory. Access tokens are cached in native memory and renewed before expiry. Disconnect removes credentials and saved source configuration, not remote content.

This uses **app identity**, not the current user's personal Lark permissions. It cannot infer “assigned to me”.
Use a Base view filtered to your owner/status conditions and add that view's URL instead.
Do not distribute a shared app secret in an installation package or ask untrusted end users to use it.
A centrally distributed integration should use an OAuth/token-broker service rather than shipping an app secret.
Lark CLI remains an optional independent tool for agents; this Inbox never invokes it or reads its credentials.

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

## Inbox behavior

- **Table records** aggregates enabled table sources, with an individual source selector, search and open/closed filters.
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
8. **Independent control:** disable/remove one source; other sources must remain. Restart MonoCode and confirm source choices persist. Removal must leave the remote resource unchanged.
9. **Partial failure:** revoke access to one enabled source, refresh, and verify an error plus intact results from other sources. Restore access and retry.
10. **Limits/security:** test more than one page, Unicode/large content and malicious/off-domain links. Truncation must be visible; credentials must never appear in source configuration, browser storage, logs or agent context.

Automated tests use mocked native IPC / local HTTP fixtures. They are not proof of permissions or data fidelity against your tenant.

## API references

- [Lark app access token](https://open.larksuite.com/document/server-docs/getting-started/api-access-token/auth-v3/tenant_access_token_internal.md)
- [Base record search](https://open.feishu.cn/document/docs/bitable-v1/app-table-record/search.md)
- [Base record batch lookup](https://open.feishu.cn/document/docs/bitable-v1/app-table-record/batch_get.md)
- [Wiki node resolution](https://open.feishu.cn/document/server-docs/docs/wiki-v2/space-node/get_node.md)
- [Docx plain-text content](https://open.feishu.cn/document/server-docs/docs/docs/docx-v1/document/raw_content.md)
