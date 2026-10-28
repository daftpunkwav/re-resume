//! Native shell for the ReResume desktop application.
//!
//! Responsibilities:
//! - Register the plugins the frontend is permitted to reach over IPC
//! - Hand the SQL plugin the migration file that the TypeScript layer owns
//! - Create the Stronghold salt location, which only the native side can resolve
//!
//! Constraints:
//! - This crate holds no business rule. Resume logic, query text beyond the
//!   plugin's own migrations, and model calls belong to the TypeScript layers;
//!   anything that encodes one of those here is a layering violation.
//! - The webview's reach is bounded by `capabilities/default.json5`, not by
//!   what is registered here. Registering a plugin grants nothing on its own.

mod backup;
mod connection;
mod export;

use tauri::Manager;
use tauri_plugin_sql::{Builder as SqlBuilder, Migration, MigrationKind};

/// Connection string of the application database. Relative to Tauri's app
/// config directory, which is the directory the SQL plugin resolves it against.
/// This string must match the one the frontend passes to `Database.load`: the
/// plugin runs the migrations registered below against a connection opened with
/// exactly this string, and a connection under any other name would start with
/// no schema.
///
/// The SQL plugin does not preload this connection; the frontend loads it after
/// it has asked the native side for the pre-migration backup.
const DATABASE_URL: &str = "sqlite:re-resume.db";

/// Schema files, owned by the TypeScript layer. Every file is compiled in rather
/// than copied, so editing one is a build error rather than a migration that
/// silently does not apply.
///
/// Version numbers are allocated once and never reused. An applied version's
/// body is immutable: the plugin's ledger validates the checksum of every
/// version a database recorded, so a new schema is a new version rather than an
/// edit of an existing one. Version 3 was registered empty and stays empty; the
/// information library schema is version 7, the conversation runtime version 8
/// and the resume document schema version 9.
const MIGRATION_001_INIT: &str =
    include_str!("../../src/infrastructure/persistence/migrations/001_init.sql");
const MIGRATION_002_SETTINGS: &str =
    include_str!("../../src/infrastructure/persistence/migrations/002_settings.sql");
const MIGRATION_003_INFO_RESERVED: &str =
    include_str!("../../src/infrastructure/persistence/migrations/003_info.sql");
const MIGRATION_004_CONVERSATION: &str =
    include_str!("../../src/infrastructure/persistence/migrations/004_conversation.sql");
const MIGRATION_005_RESUME: &str =
    include_str!("../../src/infrastructure/persistence/migrations/005_resume.sql");
const MIGRATION_006_DROP_LEGACY: &str =
    include_str!("../../src/infrastructure/persistence/migrations/006_drop_legacy.sql");
const MIGRATION_007_INFO: &str =
    include_str!("../../src/infrastructure/persistence/migrations/007_info.sql");
const MIGRATION_008_CONVERSATION: &str =
    include_str!("../../src/infrastructure/persistence/migrations/008_conversation.sql");
const MIGRATION_009_RESUME: &str =
    include_str!("../../src/infrastructure/persistence/migrations/009_resume.sql");

/// Name of the file holding the Stronghold key-derivation salt. The salt is not
/// a secret — it is the Argon2 parameter that makes a password produce the same
/// key across runs — but it must exist before the first unlock, and losing it
/// means every stored credential becomes unreadable.
const STRONGHOLD_SALT_FILE: &str = "stronghold-salt.bin";

/// Migrations the SQL plugin applies when the database is first connected.
///
/// Registration order is the version order, and the plugin applies each one at
/// most once. Which migrations have already run is recorded by the plugin's own
/// bookkeeping, so no schema-version table is created here; two ledgers would
/// drift. Adding a migration means adding a file under
/// `src/infrastructure/persistence/migrations/` and an entry here with the next
/// version number.
///
/// Versions 3 to 6 were registered while their files held a comment only, and
/// those bodies are immutable once a database records them. Feature schemas
/// therefore arrive as new versions: version 7 creates the information library
/// tables and version 8 the conversation schema, without changing any applied
/// body.
fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "initial schema",
            sql: MIGRATION_001_INIT,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "settings and provider configuration",
            sql: MIGRATION_002_SETTINGS,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "information library",
            sql: MIGRATION_003_INFO_RESERVED,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "conversation and agent runtime",
            sql: MIGRATION_004_CONVERSATION,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "resume document",
            sql: MIGRATION_005_RESUME,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "drop superseded tables",
            sql: MIGRATION_006_DROP_LEGACY,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "information library",
            sql: MIGRATION_007_INFO,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "conversation, messages and agent runs",
            sql: MIGRATION_008_CONVERSATION,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 9,
            description: "resume composition document",
            sql: MIGRATION_009_RESUME,
            kind: MigrationKind::Up,
        },
    ]
}

pub fn run() {
    tauri::Builder::default()
        .plugin(
            SqlBuilder::new()
                .add_migrations(DATABASE_URL, migrations())
                .build(),
        )
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            backup::backup_database_once,
            connection::pin_sqlite_connection,
            export::publish_export
        ])
        .setup(|app| {
            // Stronghold needs a salt file to derive the snapshot key from, and
            // it writes that file on first use. Its parent is the app's local
            // data directory, which the path resolver names but does not
            // create, so the directory is made here — on a fresh install this
            // is the only thing standing between the first unlock and a failure
            // to write the salt.
            let salt_directory = app.path().app_local_data_dir()?;
            std::fs::create_dir_all(&salt_directory)?;

            app.handle().plugin(
                tauri_plugin_stronghold::Builder::with_argon2(
                    &salt_directory.join(STRONGHOLD_SALT_FILE),
                )
                .build(),
            )?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("ReResume failed to start; see the message above for the cause");
}
