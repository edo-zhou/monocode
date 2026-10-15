use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::fs;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};
use url::Url;

const MAX_SOURCES: usize = 50;
const MAX_RECORDS: usize = 1000;
const MAX_BODY: usize = 32_000;
static STATE: Mutex<State> = Mutex::new(State { token: None });
static DOCUMENT_REQUEST: Mutex<Option<Instant>> = Mutex::new(None);

struct State {
    token: Option<CachedToken>,
}

struct CachedToken {
    identity: String,
    value: String,
    expires: Instant,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Realm {
    #[default]
    Lark,
    Feishu,
}

impl Realm {
    fn domain(self) -> &'static str {
        match self {
            Self::Lark => "larksuite.com",
            Self::Feishu => "feishu.cn",
        }
    }

    fn api(self) -> String {
        format!("https://open.{}/open-apis", self.domain())
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SourceKind {
    Base,
    Document,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldMapping {
    pub title: String,
    pub status: String,
    pub assignee: String,
    pub closed_values: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub id: String,
    pub kind: SourceKind,
    pub name: String,
    pub url: String,
    pub token: String,
    pub table_id: String,
    pub view_id: String,
    pub enabled: bool,
    pub mapping: FieldMapping,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Config {
    realm: Realm,
    app_id: String,
    sources: Vec<Source>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    connected: bool,
    realm: Realm,
    app_id: String,
    sources: Vec<Source>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Field {
    id: String,
    name: String,
    kind: u64,
    primary: bool,
    options: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    source: Source,
    fields: Vec<Field>,
    samples: Vec<String>,
    warning: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    id: String,
    source_id: String,
    record_id: String,
    source_name: String,
    kind: SourceKind,
    title: String,
    url: String,
    state: String,
    closed: bool,
    updated_at: String,
    assignees: Vec<String>,
}

#[derive(Default, Serialize)]
pub struct Inbox {
    items: Vec<Item>,
    errors: Vec<String>,
}

#[derive(Serialize)]
pub struct Details {
    body: String,
    truncated: bool,
}

struct Client {
    origin: String,
    token: String,
    agent: ureq::Agent,
}

impl Client {
    fn request(&self, path: &str, body: Option<Value>) -> Result<Value, String> {
        if path.starts_with("/docx/") {
            let mut previous = DOCUMENT_REQUEST
                .lock()
                .map_err(|_| "Document reader is busy")?;
            if let Some(last) = *previous {
                std::thread::sleep(Duration::from_millis(250).saturating_sub(last.elapsed()));
            }
            *previous = Some(Instant::now());
        }
        let request = self
            .agent
            .request(
                if body.is_some() { "POST" } else { "GET" },
                &format!("{}{path}", self.origin),
            )
            .set("Authorization", &format!("Bearer {}", self.token))
            .set("Content-Type", "application/json");
        let response = match body {
            Some(value) => request.send_string(&value.to_string()),
            None => request.call(),
        };
        let value = response_json(response)?;
        Ok(value.get("data").cloned().unwrap_or(Value::Null))
    }

    fn fields(&self, source: &Source) -> Result<Vec<Field>, String> {
        let (items, truncated) = pages(1000, |page_token| {
            self.request(
                &with_page(
                    &format!("{}/fields?page_size=100", table_path(source)),
                    page_token,
                ),
                None,
            )
        })?;
        if truncated {
            return Err("Too many fields to validate this table safely".into());
        }
        Ok(items.iter().map(parse_field).collect())
    }

    fn records(&self, source: &Source, limit: usize) -> Result<(Vec<Value>, bool), String> {
        pages(limit, |page_token| {
            let mut body = json!({ "automatic_fields": true });
            if !source.view_id.is_empty() {
                body["view_id"] = json!(source.view_id);
            }
            self.request(
                &with_page(
                    &format!(
                        "{}/records/search?page_size={}",
                        table_path(source),
                        limit.min(500)
                    ),
                    page_token,
                ),
                Some(body),
            )
        })
    }
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce(&mut State) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut state = STATE.lock().map_err(|_| "Lark connection is busy")?;
        work(&mut state)
    })
    .await
    .map_err(|_| "Lark operation could not finish".to_string())?
}

#[tauri::command]
pub async fn lark_status(app: AppHandle) -> Result<Status, String> {
    blocking(move |_| Ok(status(read_config(&app)?))).await
}

#[tauri::command]
pub async fn lark_connect(
    app: AppHandle,
    realm: Realm,
    app_id: String,
    app_secret: String,
) -> Result<Status, String> {
    blocking(move |state| {
        let app_id = app_id.trim().to_string();
        let app_secret = app_secret.trim();
        if !valid_id(&app_id) || app_secret.is_empty() || app_secret.len() > 4096 {
            return Err("Enter a valid App ID and App Secret".into());
        }
        let token = fetch_token(realm, &app_id, app_secret)?;
        let previous = read_config(&app)?;
        let sources = previous
            .filter(|config| config.realm == realm && config.app_id == app_id)
            .map(|config| config.sources)
            .unwrap_or_default();
        let config = Config {
            realm,
            app_id,
            sources,
        };
        let entry = credential(&app)?;
        let old_secret = match entry.get_password() {
            Ok(value) => Some(value),
            Err(keyring::Error::NoEntry) => None,
            Err(_) => return Err("Unlock the system credential store and try again".into()),
        };
        let secret = json!({ "realm": realm, "appId": config.app_id, "secret": app_secret });
        entry
            .set_password(&secret.to_string())
            .map_err(|_| "Could not save Lark credentials in the system credential store")?;
        if let Err(error) = write_config(&app, &config) {
            if let Some(value) = old_secret {
                let _ = entry.set_password(&value);
            } else {
                let _ = entry.delete_credential();
            }
            return Err(error);
        }
        state.token = Some(CachedToken {
            identity: identity(&app, &config)?,
            ..token
        });
        Ok(status(Some(config)))
    })
    .await
}

#[tauri::command]
pub async fn lark_check_connection(app: AppHandle) -> Result<(), String> {
    blocking(move |state| {
        state.token = None;
        let config = require_config(&app)?;
        client(&app, &config, state).map(|_| ())
    })
    .await
}

#[tauri::command]
pub async fn lark_disconnect(app: AppHandle) -> Result<(), String> {
    blocking(move |state| {
        match credential(&app)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(_) => {
                return Err(
                    "Could not remove Lark credentials from the system credential store".into(),
                )
            }
        }
        state.token = None;
        match fs::remove_file(config_path(&app)?) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(_) => {
                Err("Credentials removed, but Lark source settings could not be deleted".into())
            }
        }
    })
    .await
}

#[tauri::command]
pub async fn lark_preview_source(app: AppHandle, url: String) -> Result<Vec<Preview>, String> {
    blocking(move |state| {
        let config = require_config(&app)?;
        let client = client(&app, &config, state)?;
        preview(&client, config.realm, &url)
    })
    .await
}

#[tauri::command]
pub async fn lark_save_source(app: AppHandle, source: Source) -> Result<Source, String> {
    blocking(move |state| {
        let mut config = require_config(&app)?;
        let client = client(&app, &config, state)?;
        let mut verified = preview(&client, config.realm, &source.url)?
            .into_iter()
            .find(|candidate| candidate.source.id == source.id)
            .ok_or("The source no longer matches this link. Validate it again.")?;
        validate_mapping(&verified.source.kind, &source.mapping, &verified.fields)?;
        verified.source.mapping = source.mapping;
        verified.source.enabled = source.enabled;
        if !source.name.trim().is_empty() {
            verified.source.name = source.name.trim().chars().take(200).collect();
        }
        let saved = verified.source;
        if let Some(existing) = config.sources.iter_mut().find(|entry| entry.id == saved.id) {
            *existing = saved.clone();
        } else {
            if config.sources.len() >= MAX_SOURCES {
                return Err(format!("At most {MAX_SOURCES} Lark sources can be enabled"));
            }
            config.sources.push(saved.clone());
        }
        write_config(&app, &config)?;
        Ok(saved)
    })
    .await
}

#[tauri::command]
pub async fn lark_toggle_source(app: AppHandle, id: String, enabled: bool) -> Result<(), String> {
    blocking(move |_| {
        let mut config = require_config(&app)?;
        let source = config
            .sources
            .iter_mut()
            .find(|source| source.id == id)
            .ok_or("Lark source not found")?;
        source.enabled = enabled;
        write_config(&app, &config)
    })
    .await
}

#[tauri::command]
pub async fn lark_remove_source(app: AppHandle, id: String) -> Result<(), String> {
    blocking(move |_| {
        let mut config = require_config(&app)?;
        config.sources.retain(|source| source.id != id);
        write_config(&app, &config)
    })
    .await
}

#[tauri::command]
pub async fn lark_inbox(app: AppHandle) -> Result<Inbox, String> {
    blocking(move |state| {
        let Some(config) = read_config(&app)? else {
            return Ok(Inbox::default());
        };
        if !config.sources.iter().any(|source| source.enabled) {
            return Ok(Inbox::default());
        }
        let client = client(&app, &config, state)?;
        let mut result = Inbox::default();
        for source in config.sources.iter().filter(|source| source.enabled) {
            match source_items(&client, source) {
                Ok((items, truncated)) => {
                    result.items.extend(items);
                    if truncated {
                        result.errors.push(format!(
                            "{}: showing only the first {MAX_RECORDS} records. Use a narrower Base view.",
                            source.name
                        ));
                    }
                }
                Err(error) => result.errors.push(format!("{}: {error}", source.name)),
            }
        }
        Ok(result)
    })
    .await
}

#[tauri::command]
pub async fn lark_item_details(
    app: AppHandle,
    source_id: String,
    record_id: String,
) -> Result<Details, String> {
    blocking(move |state| {
        let config = require_config(&app)?;
        let source = config
            .sources
            .iter()
            .find(|source| source.id == source_id && source.enabled)
            .ok_or("This Lark source was removed or disabled")?;
        let client = client(&app, &config, state)?;
        if source.kind == SourceKind::Document {
            return document_content(&client, &source.token);
        }
        if !valid_id(&record_id) {
            return Err("Invalid Lark record ID".into());
        }
        let fields = client.fields(source)?;
        let data = client.request(
            &format!("{}/records/batch_get", table_path(source)),
            Some(json!({ "record_ids": [record_id], "automatic_fields": true })),
        )?;
        let record = data["records"]
            .as_array()
            .and_then(|records| {
                records
                    .iter()
                    .find(|record| string(record, "record_id") == record_id)
            })
            .ok_or("Record is missing or no longer accessible")?;
        Ok(limit_body(record_body(record, &fields)))
    })
    .await
}

fn status(config: Option<Config>) -> Status {
    match config {
        Some(config) => Status {
            connected: true,
            realm: config.realm,
            app_id: config.app_id,
            sources: config.sources,
        },
        None => Status {
            connected: false,
            realm: Realm::Lark,
            app_id: String::new(),
            sources: vec![],
        },
    }
}

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(20))
        .redirects(0)
        .build()
}

fn fetch_token(realm: Realm, app_id: &str, secret: &str) -> Result<CachedToken, String> {
    let value = response_json(
        agent()
            .post(&format!(
                "{}/auth/v3/tenant_access_token/internal",
                realm.api()
            ))
            .set("Content-Type", "application/json")
            .send_string(&json!({ "app_id": app_id, "app_secret": secret }).to_string()),
    )?;
    let token = string(&value, "tenant_access_token");
    let expires = value["expire"].as_u64().unwrap_or(0);
    if token.is_empty() || expires == 0 {
        return Err(
            "Lark did not return a valid access token. Check the app credentials and region."
                .into(),
        );
    }
    Ok(CachedToken {
        identity: String::new(),
        value: token,
        expires: Instant::now() + Duration::from_secs(expires.saturating_sub(60).min(7200)),
    })
}

fn client(app: &AppHandle, config: &Config, state: &mut State) -> Result<Client, String> {
    let identity = identity(app, config)?;
    if !state
        .token
        .as_ref()
        .is_some_and(|token| token.identity == identity && token.expires > Instant::now())
    {
        let secret = credential(app)?.get_password().map_err(|_| {
            "Lark credentials are unavailable. Unlock the system credential store or reconnect."
        })?;
        let saved: Value = serde_json::from_str(&secret)
            .map_err(|_| "Lark credentials are invalid. Reconnect the app.")?;
        if saved["appId"] != config.app_id || saved["realm"] != json!(config.realm) {
            return Err("Lark credentials do not match this connection. Reconnect the app.".into());
        }
        let token = fetch_token(config.realm, &config.app_id, &string(&saved, "secret"))?;
        state.token = Some(CachedToken { identity, ..token });
    }
    Ok(Client {
        origin: config.realm.api(),
        token: state
            .token
            .as_ref()
            .ok_or("Lark token unavailable")?
            .value
            .clone(),
        agent: agent(),
    })
}

fn response_json(response: Result<ureq::Response, ureq::Error>) -> Result<Value, String> {
    let response = match response {
        Ok(response) => response,
        Err(ureq::Error::Status(code, _)) => return Err(api_error(code.into())),
        Err(_) => return Err("Could not reach Lark. Check your network and retry.".into()),
    };
    if !(200..300).contains(&response.status()) {
        return Err(api_error(response.status().into()));
    }
    let mut body = String::new();
    response
        .into_reader()
        .take(8 * 1024 * 1024 + 1)
        .read_to_string(&mut body)
        .map_err(|_| "Could not read the Lark response")?;
    if body.len() > 8 * 1024 * 1024 {
        return Err("Lark response is too large. Use a narrower view.".into());
    }
    let value: Value =
        serde_json::from_str(&body).map_err(|_| "Lark returned an invalid response")?;
    let code = value["code"]
        .as_i64()
        .ok_or("Lark response is missing its result code")?;
    if code != 0 {
        return Err(api_error(code));
    }
    Ok(value)
}

fn api_error(code: i64) -> String {
    match code {
        401 | 99991661 | 99991663 | 99991664 | 99991668 => format!("Lark authorization expired or is invalid ({code}). Recheck the connection."),
        403 | 91403 | 99991672 | 99991679 | 1254302 | 1770032 => format!("Lark access denied ({code}). Publish the read scopes and share this Base, document or Wiki with the app. API scopes alone do not grant document access."),
        429 | 99991400 | 1254290 | 1254291 => format!("Lark rate limit reached ({code}). Wait briefly, then refresh."),
        _ => format!("Lark request failed ({code}). Check the app region, published read scopes, resource permissions and link."),
    }
}

#[derive(Debug)]
struct ParsedLink {
    url: Url,
    kind: String,
    token: String,
    table_id: String,
    view_id: String,
}

fn parse_link(raw: &str, realm: Realm) -> Result<ParsedLink, String> {
    let mut url = Url::parse(raw.trim()).map_err(|_| "Enter a complete Lark HTTPS link")?;
    let host = url.host_str().unwrap_or("");
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || !(host == realm.domain() || host.ends_with(&format!(".{}", realm.domain())))
    {
        return Err(format!(
            "Use an HTTPS {} link matching the connected region",
            realm.domain()
        ));
    }
    let parts: Vec<_> = url.path().trim_matches('/').split('/').collect();
    if parts.len() != 2 || !valid_id(parts[1]) {
        return Err("Use a direct Base, Docx or Wiki link, not a short/share link".into());
    }
    let kind = parts[0].to_string();
    let token = parts[1].to_string();
    if !["base", "docx", "wiki"].contains(&kind.as_str()) {
        return Err("This version supports Base and Docx/Wiki documents. Sheets and legacy /doc/ links are not supported.".into());
    }
    let parameter = |key: &str| -> Result<String, String> {
        let values: Vec<_> = url
            .query_pairs()
            .filter(|(name, _)| name == key)
            .map(|(_, value)| value.into_owned())
            .collect();
        if values.len() > 1 || values.first().is_some_and(|value| !valid_id(value)) {
            return Err(format!("Invalid {key} in Lark link"));
        }
        Ok(values.first().cloned().unwrap_or_default())
    };
    let table_id = parameter("table")?;
    let view_id = parameter("view")?;
    if table_id.is_empty() && !view_id.is_empty() {
        return Err("A Base view link must also include its table ID".into());
    }
    url.set_query(None);
    url.set_fragment(None);
    Ok(ParsedLink {
        url,
        kind,
        token,
        table_id,
        view_id,
    })
}

fn preview(client: &Client, realm: Realm, raw: &str) -> Result<Vec<Preview>, String> {
    let mut link = parse_link(raw, realm)?;
    if link.kind == "wiki" {
        let node = client.request(
            &format!("/wiki/v2/spaces/get_node?token={}", link.token),
            None,
        )?;
        link.kind = match string(&node["node"], "obj_type").as_str() {
            "bitable" => "base".into(),
            "docx" => "docx".into(),
            _ => return Err("This Wiki node is not a Base or Docx document".into()),
        };
        link.token = string(&node["node"], "obj_token");
        if !valid_id(&link.token) {
            return Err("Wiki did not return a valid resource token".into());
        }
    }
    if link.kind == "docx" {
        let data = client.request(&format!("/docx/v1/documents/{}", link.token), None)?;
        let content = document_content(client, &link.token)?;
        return Ok(vec![Preview {
            source: Source {
                id: format!("{}:docx:{}", realm.domain(), link.token),
                kind: SourceKind::Document,
                name: string(&data["document"], "title"),
                url: link.url.to_string(),
                token: link.token,
                table_id: String::new(),
                view_id: String::new(),
                enabled: true,
                mapping: FieldMapping::default(),
            },
            fields: vec![],
            samples: vec![content.body.chars().take(600).collect()],
            warning: "Read-only plain-text preview. Embedded tables, images and comments are not imported; add Base links separately.".into(),
        }]);
    }
    let app = client.request(&format!("/bitable/v1/apps/{}", link.token), None)?;
    let (tables, truncated) = pages(1000, |page| {
        client.request(
            &with_page(
                &format!("/bitable/v1/apps/{}/tables?page_size=100", link.token),
                page,
            ),
            None,
        )
    })?;
    if truncated {
        return Err("Too many tables. Use a link to a specific table.".into());
    }
    let selected: Vec<_> = tables
        .iter()
        .filter(|table| link.table_id.is_empty() || string(table, "table_id") == link.table_id)
        .collect();
    if selected.is_empty() {
        return Err("No accessible table matches this link".into());
    }
    if selected.len() > 20 {
        return Err(
            "This Base has more than 20 tables. Paste links to individual tables instead.".into(),
        );
    }
    let mut previews = vec![];
    for table in selected {
        let table_id = string(table, "table_id");
        if !valid_id(&table_id) {
            return Err("Lark returned an invalid table ID".into());
        }
        let mut url = link.url.clone();
        url.query_pairs_mut().append_pair("table", &table_id);
        if !link.view_id.is_empty() {
            url.query_pairs_mut().append_pair("view", &link.view_id);
        }
        let mut source = Source {
            id: format!("{}:base:{}:{table_id}", realm.domain(), link.token),
            kind: SourceKind::Base,
            name: format!(
                "{} / {}",
                string(&app["app"], "name"),
                string(table, "name")
            ),
            url: url.to_string(),
            token: link.token.clone(),
            table_id,
            view_id: link.view_id.clone(),
            enabled: true,
            mapping: FieldMapping::default(),
        };
        let fields = client.fields(&source)?;
        source.mapping = default_mapping(&fields);
        let (records, _) = client.records(&source, 3)?;
        let samples = records
            .iter()
            .map(|record| record_body(record, &fields).chars().take(1200).collect())
            .collect();
        previews.push(Preview {
            source,
            fields,
            samples,
            warning: if records.is_empty() {
                "No visible records. Confirm that this view is empty and the app has access under Base advanced permissions.".into()
            } else {
                String::new()
            },
        });
    }
    Ok(previews)
}

fn source_items(client: &Client, source: &Source) -> Result<(Vec<Item>, bool), String> {
    if source.kind == SourceKind::Document {
        let data = client.request(&format!("/docx/v1/documents/{}", source.token), None)?;
        return Ok((
            vec![Item {
                id: source.id.clone(),
                source_id: source.id.clone(),
                record_id: String::new(),
                source_name: source.name.clone(),
                kind: SourceKind::Document,
                title: string(&data["document"], "title"),
                url: source.url.clone(),
                state: "Document".into(),
                closed: false,
                updated_at: String::new(),
                assignees: vec![],
            }],
            false,
        ));
    }
    let fields = client.fields(source)?;
    validate_mapping(&source.kind, &source.mapping, &fields)?;
    let (records, truncated) = client.records(source, MAX_RECORDS)?;
    Ok((
        records
            .iter()
            .map(|record| record_item(source, record, &fields))
            .collect(),
        truncated,
    ))
}

fn document_content(client: &Client, token: &str) -> Result<Details, String> {
    let data = client.request(&format!("/docx/v1/documents/{token}/raw_content"), None)?;
    let body = data["content"]
        .as_str()
        .ok_or("Lark did not return readable document content")?;
    Ok(limit_body(body.to_string()))
}

fn record_item(source: &Source, record: &Value, fields: &[Field]) -> Item {
    let value = |id: &str| {
        fields
            .iter()
            .find(|field| field.id == id)
            .map(|field| &record["fields"][&field.name])
            .unwrap_or(&Value::Null)
    };
    let record_id = string(record, "record_id");
    let title = cell_text(value(&source.mapping.title));
    let state = cell_text(value(&source.mapping.status));
    let assignees = value(&source.mapping.assignee)
        .as_array()
        .map(|people| {
            people
                .iter()
                .map(|person| string(person, "name"))
                .filter(|name| !name.is_empty())
                .collect()
        })
        .unwrap_or_default();
    let updated = record["last_modified_time"].as_i64().or_else(|| {
        record["last_modified_time"]
            .as_str()
            .and_then(|value| value.parse().ok())
    });
    let updated_at = updated
        .and_then(|millis| time::OffsetDateTime::from_unix_timestamp(millis / 1000).ok())
        .map(|date| {
            format!(
                "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
                date.year(),
                u8::from(date.month()),
                date.day(),
                date.hour(),
                date.minute(),
                date.second()
            )
        })
        .unwrap_or_default();
    let mut url = Url::parse(&source.url).expect("validated source URL");
    url.query_pairs_mut().append_pair("record", &record_id);
    Item {
        id: format!("{}:{record_id}", source.id),
        source_id: source.id.clone(),
        record_id: record_id.clone(),
        source_name: source.name.clone(),
        kind: SourceKind::Base,
        title: if title.trim().is_empty() {
            record_id
        } else {
            title
        },
        url: url.to_string(),
        closed: source
            .mapping
            .closed_values
            .iter()
            .any(|value| value.eq_ignore_ascii_case(state.trim())),
        state,
        updated_at,
        assignees,
    }
}

fn parse_field(value: &Value) -> Field {
    Field {
        id: string(value, "field_id"),
        name: string(value, "field_name"),
        kind: value["type"].as_u64().unwrap_or(0),
        primary: value["is_primary"].as_bool().unwrap_or(false),
        options: value["property"]["options"]
            .as_array()
            .map(|options| {
                options
                    .iter()
                    .map(|option| string(option, "name"))
                    .collect()
            })
            .unwrap_or_default(),
    }
}

fn default_mapping(fields: &[Field]) -> FieldMapping {
    let status = fields.iter().find(|field| {
        ["status", "状态", "bug状态", "任务状态"]
            .contains(&field.name.trim().to_lowercase().as_str())
    });
    FieldMapping {
        title: fields
            .iter()
            .find(|field| field.primary)
            .or_else(|| fields.first())
            .map(|field| field.id.clone())
            .unwrap_or_default(),
        status: status.map(|field| field.id.clone()).unwrap_or_default(),
        assignee: fields
            .iter()
            .find(|field| field.kind == 11)
            .map(|field| field.id.clone())
            .unwrap_or_default(),
        closed_values: status
            .map(|field| {
                field
                    .options
                    .iter()
                    .filter(|option| {
                        ["done", "closed", "completed", "已完成", "已关闭"]
                            .contains(&option.trim().to_lowercase().as_str())
                    })
                    .cloned()
                    .collect()
            })
            .unwrap_or_default(),
    }
}

fn validate_mapping(
    kind: &SourceKind,
    mapping: &FieldMapping,
    fields: &[Field],
) -> Result<(), String> {
    if *kind == SourceKind::Document {
        return Ok(());
    }
    if mapping.title.is_empty() {
        return Err("Choose a title field before enabling the table".into());
    }
    for id in [&mapping.title, &mapping.status, &mapping.assignee] {
        if !id.is_empty() && !fields.iter().any(|field| field.id == *id) {
            return Err(
                "A mapped field was removed. Validate the source and update its field mapping."
                    .into(),
            );
        }
    }
    if !mapping.assignee.is_empty()
        && !fields
            .iter()
            .any(|field| field.id == mapping.assignee && field.kind == 11)
    {
        return Err("The assignee mapping must use a Person field".into());
    }
    Ok(())
}

fn record_body(record: &Value, fields: &[Field]) -> String {
    fields
        .iter()
        .map(|field| {
            format!(
                "{}: {}",
                field.name,
                cell_text(&record["fields"][&field.name])
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn cell_text(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::String(value) => value.clone(),
        Value::Array(values) => values
            .iter()
            .map(cell_text)
            .filter(|text| !text.is_empty())
            .collect::<Vec<_>>()
            .join(" "),
        Value::Object(_) if value["text"].is_string() && value["link"].is_string() => {
            format!("{} ({})", string(value, "text"), string(value, "link"))
        }
        Value::Object(_) => ["text", "name", "link", "url", "file_token", "id"]
            .iter()
            .find_map(|key| value.get(*key).and_then(Value::as_str).map(str::to_string))
            .unwrap_or_else(|| value.to_string()),
        _ => value.to_string(),
    }
}

fn limit_body(body: String) -> Details {
    let truncated = body.chars().count() > MAX_BODY;
    let mut body: String = body.chars().take(MAX_BODY).collect();
    if truncated {
        body.push_str("\n\n[Content truncated. Open the source in Lark for the full content.]");
    }
    Details { body, truncated }
}

fn pages(
    limit: usize,
    mut fetch: impl FnMut(Option<&str>) -> Result<Value, String>,
) -> Result<(Vec<Value>, bool), String> {
    let mut items = vec![];
    let mut token: Option<String> = None;
    let mut seen = HashSet::new();
    for _ in 0..100 {
        let data = fetch(token.as_deref())?;
        let page = data["items"]
            .as_array()
            .ok_or("Lark response is missing items")?;
        let overflow = items.len() + page.len() > limit;
        items.extend(page.iter().take(limit.saturating_sub(items.len())).cloned());
        let more = data["has_more"].as_bool().unwrap_or(false);
        if !more {
            return Ok((items, overflow));
        }
        if items.len() >= limit {
            return Ok((items, true));
        }
        let next = string(&data, "page_token");
        if next.is_empty() || !seen.insert(next.clone()) {
            return Err("Lark pagination did not advance. Refresh to retry.".into());
        }
        token = Some(next);
    }
    Err("Lark pagination exceeded its safety limit".into())
}

fn with_page(path: &str, token: Option<&str>) -> String {
    match token {
        Some(token) => format!(
            "{path}&{}",
            url::form_urlencoded::Serializer::new(String::new())
                .append_pair("page_token", token)
                .finish()
        ),
        None => path.into(),
    }
}

fn table_path(source: &Source) -> String {
    format!(
        "/bitable/v1/apps/{}/tables/{}",
        source.token, source.table_id
    )
}

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 200
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

fn string(value: &Value, key: &str) -> String {
    value[key].as_str().unwrap_or_default().to_string()
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|_| "Could not find the app data directory")?
        .join("lark-config.json"))
}

fn identity(app: &AppHandle, config: &Config) -> Result<String, String> {
    Ok(format!(
        "{}:{}:{}",
        config_path(app)?.display(),
        config.realm.domain(),
        config.app_id
    ))
}

fn credential(app: &AppHandle) -> Result<keyring::Entry, String> {
    keyring::Entry::new("monocode.lark", &config_path(app)?.to_string_lossy())
        .map_err(|_| "System credential store is unavailable".into())
}

fn read_config(app: &AppHandle) -> Result<Option<Config>, String> {
    match fs::read_to_string(config_path(app)?) {
        Ok(raw) => {
            let config: Config = serde_json::from_str(&raw)
                .map_err(|_| "Lark settings are invalid. Reconnect the app.")?;
            for source in &config.sources {
                parse_link(&source.url, config.realm)?;
                if !valid_id(&source.token)
                    || (source.kind == SourceKind::Base && !valid_id(&source.table_id))
                    || (!source.view_id.is_empty() && !valid_id(&source.view_id))
                {
                    return Err("Lark source settings are invalid".into());
                }
            }
            Ok(Some(config))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err("Could not read Lark settings".into()),
    }
}

fn require_config(app: &AppHandle) -> Result<Config, String> {
    read_config(app)?.ok_or_else(|| "Connect Lark in Settings → Inbox first".into())
}

fn write_config(app: &AppHandle, config: &Config) -> Result<(), String> {
    let path = config_path(app)?;
    fs::create_dir_all(path.parent().ok_or("Invalid settings path")?)
        .map_err(|_| "Could not create Lark settings directory")?;
    let temp = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let result = (|| {
        let mut file = options
            .open(&temp)
            .map_err(|_| "Could not save Lark settings")?;
        file.write_all(
            serde_json::to_string_pretty(config)
                .map_err(|_| "Invalid Lark settings")?
                .as_bytes(),
        )
        .map_err(|_| "Could not write Lark settings")?;
        file.sync_all()
            .map_err(|_| "Could not sync Lark settings")?;
        drop(file);
        fs::rename(&temp, path).map_err(|_| "Could not replace Lark settings")
    })();
    if result.is_err() {
        let _ = fs::remove_file(temp);
    }
    result.map_err(str::to_string)
}

#[cfg(test)]
mod tests;
