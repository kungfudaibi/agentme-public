use std::{
    fs::{self, File},
    io::{BufRead, BufReader, Write},
    net::{Shutdown, TcpStream},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};

use serde::Serialize;
use tauri::{
    Manager, RunEvent, State, WindowEvent,
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt as AutostartManagerExt};

const HOST_PREFIX: &str = "AgentMe host listening at ";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConnectionInfo {
    base_url: String,
    auth_token: String,
}

struct HostProcess {
    child: Child,
    connection: ConnectionInfo,
}

struct LocalVoiceConfiguration {
    executable: PathBuf,
    arguments: Vec<PathBuf>,
}

impl LocalVoiceConfiguration {
    fn is_ready(&self) -> bool {
        self.executable.is_file()
            && [0_usize, 2, 4]
                .iter()
                .all(|index| self.arguments[*index].exists())
    }

    fn json_arguments(&self) -> Result<String, String> {
        let arguments = self
            .arguments
            .iter()
            .map(|argument| json_string(&argument.to_string_lossy()))
            .collect::<Vec<_>>();
        Ok(format!("[{}]", arguments.join(",")))
    }
}

fn json_string(value: &str) -> String {
    let mut output = String::from("\"");
    for character in value.chars() {
        match character {
            '"' => output.push_str("\\\""),
            '\\' => output.push_str("\\\\"),
            '\u{0008}' => output.push_str("\\b"),
            '\u{000C}' => output.push_str("\\f"),
            '\n' => output.push_str("\\n"),
            '\r' => output.push_str("\\r"),
            '\t' => output.push_str("\\t"),
            character if character <= '\u{001F}' => {
                output.push_str(&format!("\\u{:04x}", character as u32));
            }
            character => output.push(character),
        }
    }
    output.push('"');
    output
}

#[derive(Default)]
struct DesktopState {
    host: Mutex<Option<HostProcess>>,
}

fn auth_token() -> Result<String, String> {
    let mut bytes = [0_u8; 32];
    getrandom::fill(&mut bytes).map_err(|_| "Could not create local authentication".to_string())?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn project_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..")
}

fn portable_command_path(path: PathBuf) -> PathBuf {
    #[cfg(windows)]
    {
        let value = path.to_string_lossy();
        if let Some(value) = value.strip_prefix(r"\\?\UNC\") {
            return PathBuf::from(format!(r"\\{value}"));
        }
        if let Some(value) = value.strip_prefix(r"\\?\") {
            return PathBuf::from(value);
        }
    }
    path
}

fn host_script(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if cfg!(debug_assertions) {
        return Ok(project_root().join("dist/apps/host/src/main.js"));
    }
    app.path()
        .resource_dir()
        .map(|directory| portable_command_path(directory.join("dist/apps/host/src/main.js")))
        .map_err(|_| "Could not resolve the packaged host".to_string())
}

fn runtime_executable(resource_directory: &std::path::Path) -> PathBuf {
    resource_directory
        .join("runtime")
        .join(if cfg!(windows) { "node.exe" } else { "node" })
}

fn local_voice_configuration(
    resource_directory: &std::path::Path,
    data_directory: &std::path::Path,
) -> LocalVoiceConfiguration {
    let executable = data_directory.join("voice-python").join(if cfg!(windows) {
        "Scripts/python.exe"
    } else {
        "bin/python"
    });
    LocalVoiceConfiguration {
        executable,
        arguments: vec![
            resource_directory.join("services/voice-python/sherpa_service.py"),
            PathBuf::from("--asr-model-dir"),
            data_directory.join("models/local-voice/sensevoice"),
            PathBuf::from("--tts-model-dir"),
            data_directory.join("models/local-voice/piper-zh"),
            PathBuf::from("--num-threads"),
            PathBuf::from("2"),
        ],
    }
}

fn repository_configuration(configuration_directory: &std::path::Path) -> Option<PathBuf> {
    let path = configuration_directory.join("repositories.json");
    path.is_file().then_some(path)
}

fn start_host(app: &tauri::AppHandle) -> Result<HostProcess, String> {
    let data_directory = portable_command_path(
        app.path()
            .app_data_dir()
            .map_err(|_| "Could not resolve application data".to_string())?,
    );
    fs::create_dir_all(&data_directory)
        .map_err(|_| "Could not create application data".to_string())?;
    let script = host_script(app)?;
    if !script.is_file() {
        return Err("Host build is missing; run the AgentMe build first".to_string());
    }
    let resource_directory = portable_command_path(
        app.path()
            .resource_dir()
            .map_err(|_| "Could not resolve packaged resources".to_string())?,
    );
    let working_directory = if cfg!(debug_assertions) {
        project_root()
    } else {
        resource_directory.clone()
    };
    let configuration_directory = if cfg!(debug_assertions) {
        project_root().join(".agentme")
    } else {
        data_directory.clone()
    };
    fs::create_dir_all(&configuration_directory)
        .map_err(|_| "Could not create application configuration".to_string())?;
    let executable = if cfg!(debug_assertions) {
        PathBuf::from(std::env::var("AGENTME_NODE_EXECUTABLE").unwrap_or_else(|_| "node".into()))
    } else {
        runtime_executable(&resource_directory)
    };
    let local_voice = (!cfg!(debug_assertions))
        .then(|| local_voice_configuration(&resource_directory, &data_directory))
        .filter(LocalVoiceConfiguration::is_ready);
    spawn_host(
        executable,
        script,
        working_directory,
        data_directory,
        configuration_directory,
        local_voice,
    )
}

fn spawn_host(
    executable: PathBuf,
    script: PathBuf,
    working_directory: PathBuf,
    data_directory: PathBuf,
    configuration_directory: PathBuf,
    local_voice: Option<LocalVoiceConfiguration>,
) -> Result<HostProcess, String> {
    let token = auth_token()?;
    let error_log = File::create(data_directory.join("host.stderr.log"))
        .map_err(|_| "Could not create host diagnostics".to_string())?;
    let mut command = Command::new(executable);
    command
        .arg(script)
        .current_dir(working_directory)
        .env("AGENTME_AUTH_TOKEN", &token)
        .env(
            "AGENTME_DATABASE_PATH",
            data_directory.join("agentme.sqlite"),
        )
        .env("AGENTME_PORT", "0")
        .env(
            "AGENTME_SETTINGS_PATH",
            configuration_directory.join("settings.json"),
        )
        .env(
            "AGENTME_SECRETS_DIRECTORY",
            configuration_directory.join("secrets"),
        )
        .env("AGENTME_TASK_ROOT", data_directory.join("worktrees"))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::from(error_log));
    if let Some(configuration) = local_voice {
        let arguments = configuration.json_arguments()?;
        command
            .env("AGENTME_LOCAL_VOICE_EXECUTABLE", &configuration.executable)
            .env("AGENTME_LOCAL_VOICE_ARGS", arguments);
    }
    if let Some(repository_config) = repository_configuration(&configuration_directory) {
        command.env("AGENTME_REPOSITORIES_CONFIG", repository_config);
    }
    let mut child = command
        .spawn()
        .map_err(|_| "Could not start the AgentMe host".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Could not read host startup".to_string())?;
    let mut line = String::new();
    BufReader::new(stdout)
        .read_line(&mut line)
        .map_err(|_| "Could not read host startup".to_string())?;
    let base_url = line
        .trim()
        .strip_prefix(HOST_PREFIX)
        .filter(|value| value.starts_with("http://127.0.0.1:"))
        .ok_or_else(|| "Host did not report a loopback address".to_string())?
        .to_string();
    Ok(HostProcess {
        child,
        connection: ConnectionInfo {
            base_url,
            auth_token: token,
        },
    })
}

fn request_shutdown(connection: &ConnectionInfo) {
    let Some(address) = connection.base_url.strip_prefix("http://") else {
        return;
    };
    let Ok(mut stream) = TcpStream::connect_timeout(
        &match address.parse() {
            Ok(address) => address,
            Err(_) => return,
        },
        Duration::from_millis(500),
    ) else {
        return;
    };
    let request = format!(
        "POST /shutdown HTTP/1.1\r\nHost: {address}\r\nAuthorization: Bearer {}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        connection.auth_token
    );
    let _ = stream.write_all(request.as_bytes());
    let _ = stream.shutdown(Shutdown::Write);
}

fn stop_host(app: &tauri::AppHandle) {
    let state = app.state::<DesktopState>();
    if let Ok(mut host) = state.host.lock()
        && let Some(mut process) = host.take()
    {
        stop_process(&mut process);
    }
}

fn stop_process(process: &mut HostProcess) {
    request_shutdown(&process.connection);
    let deadline = Instant::now() + Duration::from_secs(3);
    while Instant::now() < deadline {
        if matches!(process.child.try_wait(), Ok(Some(_))) {
            return;
        }
        thread::sleep(Duration::from_millis(50));
    }
    let _ = process.child.kill();
    let _ = process.child.wait();
}

#[tauri::command]
fn connection_info(state: State<'_, DesktopState>) -> Result<ConnectionInfo, String> {
    let host = state
        .host
        .lock()
        .map_err(|_| "Desktop state is unavailable".to_string())?;
    host.as_ref()
        .map(|process| process.connection.clone())
        .ok_or_else(|| "Host is not running".to_string())
}

#[tauri::command]
fn autostart_status(app: tauri::AppHandle) -> Result<bool, String> {
    app.autolaunch()
        .is_enabled()
        .map_err(|_| "Could not read autostart status".to_string())
}

#[tauri::command]
fn set_autostart(app: tauri::AppHandle, enabled: bool) -> Result<bool, String> {
    let manager = app.autolaunch();
    if enabled {
        manager.enable()
    } else {
        manager.disable()
    }
    .map_err(|_| "Could not update autostart status".to_string())?;
    manager
        .is_enabled()
        .map_err(|_| "Could not verify autostart status".to_string())
}

fn autostart_smoke_requested() -> bool {
    std::env::var("AGENTME_DESKTOP_SMOKE_AUTOSTART").as_deref() == Ok("1")
}

fn exercise_autostart(app: &tauri::AppHandle) -> Result<(), String> {
    let manager = app.autolaunch();
    let was_enabled = manager
        .is_enabled()
        .map_err(|_| "Could not read autostart status for smoke test".to_string())?;
    manager
        .enable()
        .map_err(|_| "Could not enable autostart for smoke test".to_string())?;
    if !manager
        .is_enabled()
        .map_err(|_| "Could not verify enabled autostart".to_string())?
    {
        return Err("Autostart did not become enabled".to_string());
    }
    if was_enabled {
        manager.enable()
    } else {
        manager.disable()
    }
    .map_err(|_| "Could not restore autostart after smoke test".to_string())?;
    if manager
        .is_enabled()
        .map_err(|_| "Could not verify restored autostart".to_string())?
        != was_enabled
    {
        return Err("Autostart smoke test did not restore prior state".to_string());
    }
    Ok(())
}

fn show_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .manage(DesktopState::default())
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            show_main(app)
        }))
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .invoke_handler(tauri::generate_handler![
            connection_info,
            autostart_status,
            set_autostart
        ])
        .setup(|app| {
            let host = start_host(app.handle())?;
            *app.state::<DesktopState>()
                .host
                .lock()
                .map_err(|_| "Desktop state is unavailable")? = Some(host);
            if autostart_smoke_requested() {
                exercise_autostart(app.handle())?;
            }
            let show = MenuItem::with_id(app, "show", "显示 AgentMe", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            TrayIconBuilder::new()
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_main(app),
                    "quit" => {
                        stop_host(app);
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;
            if let Ok(delay) = std::env::var("AGENTME_DESKTOP_SMOKE_EXIT_MS")
                && let Ok(delay) = delay.parse::<u64>()
                && (250..=10_000).contains(&delay)
            {
                let handle = app.handle().clone();
                thread::spawn(move || {
                    thread::sleep(Duration::from_millis(delay));
                    stop_host(&handle);
                    handle.exit(0);
                });
            }
            Ok(())
        });

    builder
        .build(tauri::generate_context!())
        .expect("error while building AgentMe desktop")
        .run(|app, event| match event {
            RunEvent::WindowEvent {
                label,
                event: WindowEvent::CloseRequested { api, .. },
                ..
            } if label == "main" => {
                api.prevent_close();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }
            RunEvent::ExitRequested { .. } | RunEvent::Exit => stop_host(app),
            _ => {}
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_a_256_bit_local_token() {
        let token = auth_token().expect("token");
        assert_eq!(token.len(), 64);
        assert!(token.chars().all(|character| character.is_ascii_hexdigit()));
    }

    #[test]
    fn autostart_smoke_requires_an_explicit_opt_in() {
        // The process environment is intentionally not mutated in parallel tests.
        assert!(!autostart_smoke_requested());
    }

    #[test]
    fn resolves_the_bundled_native_runtime_without_a_shell() {
        let resource_directory = PathBuf::from("app-resources");
        let expected = if cfg!(windows) { "node.exe" } else { "node" };
        assert_eq!(
            runtime_executable(&resource_directory),
            resource_directory.join("runtime").join(expected)
        );
    }

    #[test]
    fn resolves_installed_local_voice_from_application_data() {
        let resource_directory = PathBuf::from("app-resources");
        let data_directory = PathBuf::from("app-data");
        let configuration = local_voice_configuration(&resource_directory, &data_directory);
        let python = if cfg!(windows) {
            data_directory.join("voice-python/Scripts/python.exe")
        } else {
            data_directory.join("voice-python/bin/python")
        };

        assert_eq!(configuration.executable, python);
        assert_eq!(
            configuration.arguments,
            vec![
                resource_directory.join("services/voice-python/sherpa_service.py"),
                PathBuf::from("--asr-model-dir"),
                data_directory.join("models/local-voice/sensevoice"),
                PathBuf::from("--tts-model-dir"),
                data_directory.join("models/local-voice/piper-zh"),
                PathBuf::from("--num-threads"),
                PathBuf::from("2"),
            ]
        );
        assert!(
            configuration
                .json_arguments()
                .expect("json")
                .starts_with("[\"")
        );
    }

    #[test]
    fn discovers_an_explicit_repository_registry_from_application_data() {
        let directory = std::env::temp_dir().join(format!(
            "agentme-repository-config-{}-{}",
            std::process::id(),
            auth_token().expect("suffix")
        ));
        fs::create_dir_all(&directory).expect("temp directory");
        let path = directory.join("repositories.json");
        fs::write(&path, "[]").expect("repository config");

        assert_eq!(repository_configuration(&directory), Some(path));

        fs::remove_dir_all(directory).expect("remove temp directory");
    }

    #[test]
    fn escapes_local_voice_arguments_as_json() {
        assert_eq!(
            json_string("C:\\voice\\say \"hi\"\n"),
            "\"C:\\\\voice\\\\say \\\"hi\\\"\\n\""
        );
    }

    #[cfg(windows)]
    #[test]
    fn converts_verbatim_windows_paths_for_the_bundled_node_runtime() {
        assert_eq!(
            portable_command_path(PathBuf::from(
                r"\\?\C:\Users\example\AppData\Local\AgentMe\dist",
            )),
            PathBuf::from(r"C:\Users\example\AppData\Local\AgentMe\dist")
        );
    }

    #[test]
    fn starts_and_reaps_the_real_node_host() {
        let directory = std::env::temp_dir().join(format!(
            "agentme-desktop-smoke-{}-{}",
            std::process::id(),
            auth_token().expect("suffix")
        ));
        fs::create_dir_all(&directory).expect("temp directory");
        let mut host = spawn_host(
            PathBuf::from(
                std::env::var("AGENTME_NODE_EXECUTABLE").unwrap_or_else(|_| "node".into()),
            ),
            project_root().join("dist/apps/host/src/main.js"),
            project_root(),
            directory.clone(),
            directory.clone(),
            None,
        )
        .expect("start host");
        assert!(host.connection.base_url.starts_with("http://127.0.0.1:"));

        stop_process(&mut host);

        assert!(matches!(host.child.try_wait(), Ok(Some(_))));
        fs::remove_dir_all(directory).expect("remove temp directory");
    }
}
