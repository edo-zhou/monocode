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
    use std::io::{BufRead, BufReader};
    use std::net::TcpListener;
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let worker = std::thread::spawn(move || {
        let mut requests = vec![];
        for data in responses {
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
            let body = json!({ "code": 0, "data": data }).to_string();
            write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body).unwrap();
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
