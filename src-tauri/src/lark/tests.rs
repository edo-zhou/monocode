use super::*;

fn source() -> Source {
    Source {
        id: "larksuite.com:base:BaseA:TableA".into(),
        kind: SourceKind::Base,
        name: "Bugs".into(),
        url: "https://team.larksuite.com/base/BaseA?table=TableA".into(),
        token: "BaseA".into(),
        table_id: "TableA".into(),
        view_id: String::new(),
        enabled: true,
        mapping: FieldMapping {
            title: "title".into(),
            status: "status".into(),
            assignee: "owner".into(),
            closed_values: vec!["Done".into()],
        },
    }
}

fn fields() -> Vec<Field> {
    vec![
        parse_field(&json!({"field_id":"title","field_name":"Title","type":1,"is_primary":true})),
        parse_field(
            &json!({"field_id":"status","field_name":"Status","type":3,"property":{"options":[{"name":"Done"},{"name":"Not Done"}]}}),
        ),
        parse_field(&json!({"field_id":"owner","field_name":"Owner","type":11})),
    ]
}

#[test]
fn accepts_scoped_base_and_wiki_links_without_forwarding_tracking_parameters() {
    let parsed = parse_link(
        "https://team.larksuite.com/base/BaseA?table=TableA&view=ViewA&secret=ignored#heading",
        Realm::Lark,
    )
    .unwrap();
    assert_eq!(parsed.table_id, "TableA");
    assert_eq!(parsed.view_id, "ViewA");
    assert_eq!(parsed.url.as_str(), "https://team.larksuite.com/base/BaseA");
    assert_eq!(
        parse_link("https://team.feishu.cn/wiki/WikiA", Realm::Feishu)
            .unwrap()
            .kind,
        "wiki"
    );
}

#[test]
fn rejects_unsafe_mismatched_ambiguous_and_unsupported_links() {
    for url in [
        "http://team.larksuite.com/base/BaseA",
        "https://larksuite.com.evil.test/base/BaseA",
        "https://evil-larksuite.com/base/BaseA",
        "https://user:secret@team.larksuite.com/base/BaseA",
        "https://team.larksuite.com:8443/base/BaseA",
        "https://team.feishu.cn/base/BaseA",
        "https://team.larksuite.com/base/%2fsecret",
        "https://team.larksuite.com/base/BaseA?table=one&table=two",
        "https://team.larksuite.com/base/BaseA?view=ViewA",
        "https://team.larksuite.com/sheets/SheetA",
        "https://team.larksuite.com/doc/LegacyA",
        "https://127.0.0.1/base/BaseA",
    ] {
        assert!(parse_link(url, Realm::Lark).is_err(), "{url}");
    }
}

#[test]
fn reads_all_pages_including_an_empty_intermediate_page() {
    let mut calls = vec![];
    let (items, truncated) = pages(10, |token| {
        calls.push(token.map(str::to_string));
        Ok(match token {
            None => json!({"items":[1],"has_more":true,"page_token":"next"}),
            Some("next") => json!({"items":[],"has_more":true,"page_token":"last"}),
            _ => json!({"items":[2],"has_more":false}),
        })
    })
    .unwrap();
    assert_eq!(items, vec![json!(1), json!(2)]);
    assert_eq!(calls.len(), 3);
    assert!(!truncated);
}

#[test]
fn marks_truncated_results_and_rejects_stalled_pagination() {
    assert!(
        pages(1, |_| Ok(
            json!({"items":[1],"has_more":true,"page_token":"next"})
        ))
        .unwrap()
        .1
    );
    assert!(pages(100, |_| Ok(
        json!({"items":[],"has_more":true,"page_token":"same"})
    ))
    .is_err());
    assert!(pages(100, |_| Ok(json!({"items":[],"has_more":true}))).is_err());
}

#[test]
fn maps_records_without_number_coercion_or_fabricated_update_times() {
    let record = json!({"record_id":"rec9007199254740993123","last_modified_time":1720000000123_i64,"fields":{"Title":[{"text":"Exact ID"}],"Status":"Not Done","Owner":[{"name":"Kai","id":"ou_one"}]}});
    let item = record_item(&source(), &record, &fields());
    assert_eq!(item.title, "Exact ID");
    assert!(item.id.ends_with("rec9007199254740993123"));
    assert!(!item.closed);
    assert_eq!(item.assignees, vec!["Kai"]);
    assert_eq!(item.updated_at, "2024-07-03T09:46:40Z");
    assert!(record_item(
        &source(),
        &json!({"record_id":"recX","fields":{}}),
        &fields()
    )
    .updated_at
    .is_empty());
}

#[test]
fn detects_removed_fields_and_invalid_people_mapping() {
    let mut mapping = source().mapping;
    assert!(validate_mapping(&SourceKind::Base, &mapping, &fields()).is_ok());
    mapping.assignee = "title".into();
    assert!(validate_mapping(&SourceKind::Base, &mapping, &fields()).is_err());
    mapping.assignee.clear();
    mapping.title = "deleted".into();
    assert!(validate_mapping(&SourceKind::Base, &mapping, &fields()).is_err());
    assert_eq!(default_mapping(&fields()).closed_values, vec!["Done"]);
}

#[test]
fn renamed_fields_still_resolve_by_field_id() {
    let mut fields = fields();
    fields[0].name = "Renamed title".into();
    let record = json!({"record_id":"recA","fields":{"Renamed title":"Still works"}});
    assert_eq!(
        record_item(&source(), &record, &fields).title,
        "Still works"
    );
}

#[test]
fn bounds_context_without_breaking_unicode_and_keeps_boolean_values() {
    let details = limit_body("测".repeat(MAX_BODY + 1));
    assert!(details.truncated);
    assert!(details.body.contains("Content truncated"));
    assert_eq!(cell_text(&json!(false)), "false");
    assert_eq!(
        cell_text(&json!(9007199254740993123_u64)),
        "9007199254740993123"
    );
}

#[test]
fn preserves_opaque_cursor_characters() {
    assert_eq!(
        with_page("/items?page_size=100", Some("one&two=+")),
        "/items?page_size=100&page_token=one%26two%3D%2B"
    );
}

#[test]
fn errors_explain_scope_and_resource_permissions() {
    assert!(api_error(91403).contains("API scopes alone"));
    assert!(api_error(429).contains("rate limit"));
    assert!(api_error(401).contains("Recheck"));
}

#[test]
fn retains_hyperlink_targets_in_agent_context() {
    assert_eq!(
        cell_text(&json!({ "text": "Requirements", "link": "https://example.com/prd" })),
        "Requirements (https://example.com/prd)"
    );
}

#[test]
fn does_not_follow_redirects_or_accept_their_success_payloads() {
    use std::net::TcpListener;
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let destination = TcpListener::bind("127.0.0.1:0").unwrap();
    destination.set_nonblocking(true).unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let location = format!("http://{}/steal", destination.local_addr().unwrap());
    let worker = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut bytes = [0; 4096];
        let _ = stream.read(&mut bytes).unwrap();
        let body = r#"{"code":0,"data":{"content":"do not accept"}}"#;
        write!(stream, "HTTP/1.1 302 Found\r\nLocation: {location}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body).unwrap();
    });
    let client = Client {
        origin,
        token: "private-token".into(),
        agent: agent(),
    };
    assert!(client.request("/redirect", None).is_err());
    worker.join().unwrap();
    assert_eq!(
        destination.accept().unwrap_err().kind(),
        std::io::ErrorKind::WouldBlock
    );
}

fn mock_client(responses: Vec<Value>) -> (Client, std::thread::JoinHandle<Vec<(String, Value)>>) {
    mock_http_client(
        responses
            .into_iter()
            .map(|data| {
                (
                    200,
                    "application/json",
                    json!({ "code": 0, "data": data }).to_string().into_bytes(),
                )
            })
            .collect(),
    )
}

fn mock_http_client(
    responses: Vec<(u16, &'static str, Vec<u8>)>,
) -> (Client, std::thread::JoinHandle<Vec<(String, Value)>>) {
    use std::io::{BufRead, BufReader};
    use std::net::TcpListener;
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let worker = std::thread::spawn(move || {
        let mut requests = vec![];
        for (status, content_type, body) in responses {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut first = String::new();
            reader.read_line(&mut first).unwrap();
            let mut size = 0;
            loop {
                let mut header = String::new();
                reader.read_line(&mut header).unwrap();
                if header == "\r\n" {
                    break;
                }
                if let Some(length) = header.to_lowercase().strip_prefix("content-length:") {
                    size = length.trim().parse::<usize>().unwrap();
                }
            }
            let mut bytes = vec![0; size];
            reader.read_exact(&mut bytes).unwrap();
            requests.push((
                first.trim().to_string(),
                serde_json::from_slice(&bytes).unwrap_or(Value::Null),
            ));
            write!(stream, "HTTP/1.1 {status} Response\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len()).unwrap();
            let _ = stream.write_all(&body);
        }
        requests
    });
    (
        Client {
            origin,
            token: "fixture-token".into(),
            agent: agent(),
        },
        worker,
    )
}

#[test]
fn resolves_wiki_bases_and_preserves_view_scope_in_real_http_requests() {
    let (client, worker) = mock_client(vec![
        json!({"node":{"obj_type":"bitable","obj_token":"BaseA"}}),
        json!({"app":{"name":"Engineering"}}),
        json!({"items":[{"table_id":"TableA","name":"Bugs"}],"has_more":false}),
        json!({"items":[{"field_id":"title","field_name":"Title","type":1,"is_primary":true}],"has_more":false}),
        json!({"items":[{"record_id":"recA","fields":{"Title":"Fix checkout"}}],"has_more":false}),
    ]);
    let previews = preview(
        &client,
        Realm::Lark,
        "https://team.larksuite.com/wiki/WikiA?table=TableA&view=ViewA",
    )
    .unwrap();
    assert_eq!(previews.len(), 1);
    assert_eq!(previews[0].source.token, "BaseA");
    assert_eq!(previews[0].source.kind, SourceKind::Base);
    assert!(previews[0].samples[0].contains("Fix checkout"));
    let requests = worker.join().unwrap();
    assert!(requests[0]
        .0
        .starts_with("GET /wiki/v2/spaces/get_node?token=WikiA "));
    assert!(requests[4]
        .0
        .starts_with("POST /bitable/v1/apps/BaseA/tables/TableA/records/search?"));
    assert_eq!(requests[4].1["view_id"], "ViewA");
    assert!(requests[4].1.get("filter").is_none());
    assert_eq!(requests[4].1["automatic_fields"], true);
    assert!(requests.iter().all(|(method, _)| !method.starts_with("PUT")
        && !method.starts_with("PATCH")
        && !method.starts_with("DELETE")));
}

#[test]
fn verifies_wiki_documents_by_reading_the_resolved_docx_content() {
    let (client, worker) = mock_client(vec![
        json!({"node":{"obj_type":"docx","obj_token":"DocA"}}),
        json!({"document":{"title":"Requirements","revision_id":3}}),
        json!({"content":"Document reference text"}),
    ]);
    let previews = preview(
        &client,
        Realm::Lark,
        "https://team.larksuite.com/wiki/WikiA",
    )
    .unwrap();
    assert_eq!(previews[0].source.kind, SourceKind::Document);
    assert!(previews[0].source.id.ends_with(":docx:DocA"));
    assert!(previews[0].source.mapping.title.is_empty());
    let requests = worker.join().unwrap();
    assert!(requests[2]
        .0
        .starts_with("GET /docx/v1/documents/DocA/raw_content "));
}

#[test]
fn record_details_preserve_typed_fields_attachments_and_exact_numbers_over_http() {
    let (client, worker) = mock_client(vec![
        json!({"items":[
            {"field_id":"due","field_name":"Due date","type":5,"property":{"date_formatter":"yyyy/MM/dd"}},
            {"field_id":"checked","field_name":"Verified","type":7},
            {"field_id":"image","field_name":"Screenshot","type":17},
            {"field_id":"exact","field_name":"Exact ID","type":2},
            {"field_id":"empty","field_name":"Empty","type":1}
        ],"has_more":false}),
        json!({"records":[{"record_id":"recA","fields":{
            "Due date":1792051200000_i64,
            "Verified":false,
            "Screenshot":[{"file_token":"imageA","name":"checkout.png","type":"image/png","size":42}],
            "Exact ID":9007199254740993123_u64
        }}]}),
    ]);
    let details = record_details(&client, &source(), "recA").unwrap();
    let serialized = serde_json::to_value(&details).unwrap();
    assert_eq!(serialized["fields"][0]["dateFormat"], "yyyy/MM/dd");
    assert_eq!(serialized["fields"][0]["value"], 1792051200000_i64);
    assert_eq!(serialized["fields"][1]["value"], false);
    assert_eq!(serialized["fields"][2]["value"][0]["file_token"], "imageA");
    assert_eq!(serialized["fields"][3]["value"], "9007199254740993123");
    assert_eq!(serialized["fields"][4]["value"], Value::Null);
    assert!(details.body.contains("2026-10-15T08:00:00Z"));
    let requests = worker.join().unwrap();
    assert_eq!(requests[1].1["record_ids"], json!(["recA"]));
    assert!(requests[1]
        .0
        .starts_with("POST /bitable/v1/apps/BaseA/tables/TableA/records/batch_get "));
}

fn attachment_responses(attachment: Value) -> Vec<Value> {
    vec![
        json!({"items":[{"field_id":"image","field_name":"Screenshot","type":17}],"has_more":false}),
        json!({"records":[{"record_id":"recA","fields":{"Screenshot":[attachment]}}]}),
    ]
}

#[test]
fn previews_only_verified_record_images_with_scoped_media_permission() {
    let mut responses: Vec<_> = attachment_responses(json!({"file_token":"imageA","name":"checkout.png","type":"image/png","size":8,"url":"https://evil.test/steal"}))
        .into_iter().map(|data| (200, "application/json", json!({"code":0,"data":data}).to_string().into_bytes())).collect();
    responses.push((200, "image/png", b"\x89PNG\r\n\x1a\n".to_vec()));
    let (client, worker) = mock_http_client(responses);
    let preview = attachment_preview(&client, &source(), "recA", "image", "imageA").unwrap();
    assert_eq!(preview, "data:image/png;base64,iVBORw0KGgo=");
    let requests = worker.join().unwrap();
    let path = requests[2].0.split_whitespace().nth(1).unwrap();
    let url = Url::parse(&format!("https://open.larksuite.com{path}")).unwrap();
    assert_eq!(url.path(), "/drive/v1/medias/imageA/download");
    let extra: Value =
        serde_json::from_str(&url.query_pairs().find(|(key, _)| key == "extra").unwrap().1)
            .unwrap();
    assert_eq!(
        extra,
        json!({"bitablePerm":{"tableId":"TableA","attachments":{"image":{"recA":["imageA"]}}}})
    );
    assert!(!preview.contains("fixture-token"));
}

#[test]
fn refuses_missing_non_image_oversized_and_unsafe_attachment_references() {
    for (attachment, message) in [
        (
            json!({"file_token":"different","type":"image/png","size":8}),
            "no longer accessible",
        ),
        (
            json!({"file_token":"imageA","type":"image/svg+xml","size":8}),
            "Only PNG",
        ),
        (
            json!({"file_token":"imageA","type":"image/png","size":MAX_IMAGE_BYTES+1}),
            "8 MB",
        ),
    ] {
        let (client, worker) = mock_client(attachment_responses(attachment));
        assert!(
            attachment_preview(&client, &source(), "recA", "image", "imageA")
                .unwrap_err()
                .contains(message)
        );
        assert_eq!(worker.join().unwrap().len(), 2);
    }
    let (client, worker) = mock_client(vec![]);
    assert!(
        attachment_preview(&client, &source(), "recA", "image", "../secret")
            .unwrap_err()
            .contains("Invalid")
    );
    assert!(worker.join().unwrap().is_empty());
}

#[test]
fn media_reader_rejects_spoofed_content_redirects_and_oversized_bodies() {
    for (status, content_type, bytes, expected) in [
        (
            200,
            "image/png",
            b"<svg onload='steal()'>secret</svg>".to_vec(),
            "not a supported image",
        ),
        (200, "image/png", vec![0; MAX_IMAGE_BYTES + 1], "8 MB"),
        (
            302,
            "application/json",
            br#"{"code":0,"data":{}}"#.to_vec(),
            "302",
        ),
        (
            403,
            "application/json",
            br#"{"code":91403,"msg":"secret-token"}"#.to_vec(),
            "access denied",
        ),
    ] {
        let (client, worker) = mock_http_client(vec![(status, content_type, bytes)]);
        let error = image_response(client.agent.get(&client.origin).call()).unwrap_err();
        assert!(error.contains(expected), "{error}");
        assert!(!error.contains("secret"));
        worker.join().unwrap();
    }
}

#[test]
fn refuses_nonzero_api_codes_without_reflecting_server_secrets() {
    use std::net::TcpListener;
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let worker = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut bytes = [0; 4096];
        let _ = stream.read(&mut bytes).unwrap();
        let body = r#"{"code":91403,"msg":"secret-access-token"}"#;
        write!(
            stream,
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        )
        .unwrap();
    });
    let error = response_json(agent().get(&origin).call()).unwrap_err();
    worker.join().unwrap();
    assert!(error.contains("access denied"));
    assert!(!error.contains("secret-access-token"));
}

fn response_error(status: u16, body: &str) -> String {
    use std::net::TcpListener;
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let body = body.to_string();
    let worker = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut bytes = [0; 4096];
        let _ = stream.read(&mut bytes).unwrap();
        write!(
            stream,
            "HTTP/1.1 {status} Response\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        )
        .unwrap();
    });
    let response = agent().get(&origin).call();
    worker.join().unwrap();
    response_json(response).unwrap_err()
}

#[test]
fn http_errors_preserve_missing_scope_diagnostics_without_exposing_credentials() {
    for (status, read_scope, write_scope) in [
        (400, "wiki:wiki:readonly", "wiki:wiki"),
        (400, "bitable:app:readonly", "bitable:app"),
        (200, "docx:document:readonly", "docx:document"),
    ] {
        let body = json!({
            "code": 99991672,
            "msg": "Access denied. Bearer secret-access-token",
            "error": {
                "permission_violations": [
                    {"type": "action_scope_required", "subject": write_scope},
                    {"type": "action_scope_required", "subject": read_scope},
                    {"type": "action_scope_required", "subject": read_scope}
                ]
            }
        });
        let error = response_error(status, &body.to_string());
        assert!(error.contains("99991672"), "{error}");
        assert!(error.contains("application API permission"), "{error}");
        assert!(error.contains("application identity"), "{error}");
        assert!(error.contains("publish"), "{error}");
        assert_eq!(error.matches(read_scope).count(), 1, "{error}");
        assert!(!error.contains("secret-access-token"), "{error}");
        if status != 200 {
            assert!(error.contains(&format!("HTTP {status}")), "{error}");
        }
    }
}

#[test]
fn preserves_resource_errors_and_http_fallbacks() {
    let error = response_error(403, r#"{"code":91403,"msg":"secret-access-token"}"#);
    assert!(error.contains("91403"), "{error}");
    assert!(error.contains("HTTP 403"), "{error}");
    assert!(error.contains("share this Base"), "{error}");
    assert!(!error.contains("secret-access-token"));

    for (status, body) in [
        (401, "<html>secret-access-token</html>"),
        (429, ""),
        (500, r#"{"msg":"secret-access-token"}"#),
        (400, r#"{"code":0,"data":{}}"#),
    ] {
        let error = response_error(status, body);
        assert!(error.contains(&status.to_string()), "{error}");
        assert!(!error.contains("secret-access-token"));
    }
}

#[test]
fn ignores_untrusted_permission_details() {
    let body = json!({
        "code": 99991672,
        "msg": "secret-access-token",
        "error": {
            "log_id": "secret-access-token",
            "permission_violations": [
                {"type": "action_scope_required", "subject": "wiki:wiki:readonly\nsecret-access-token"},
                {"type": "action_scope_required", "subject": "secret-access-token"},
                {"type": "resource_permission_required", "subject": "bitable:app:readonly"}
            ]
        }
    });
    let error = response_error(400, &body.to_string());
    assert!(error.contains("application API permission"), "{error}");
    assert!(!error.contains("secret-access-token"));
    assert!(!error.contains("bitable:app:readonly"));
}
