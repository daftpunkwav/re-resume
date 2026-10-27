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

mod connection;
mod export;

use tauri::Manager;
use tauri_plugin_sql::{Builder as SqlBuilder, Migration, MigrationKind};

/// Connection string of the application database. Relative to Tauri's app data
/// directory. This string must match the one the frontend passes to
/// `Database.load`, and the one listed under `plugins.sql.preload` in
/// tauri.conf.json: the plugin runs the migrations registered below against a
/// connection opened with exactly this string, and a connection under any other
/// name would start with no schema.
const DATABASE_URL: &str = "sqlite:re-resume.db";

/// Initial schema, owned by the TypeScript layer.
///
/// The file is compiled in rather than copied so that editing it is a build
/// error rather than a migration that silently does not apply.
const MIGRATION_001_INIT: &str =
    include_str!("../../src/infrastructure/persistence/migrations/001_init.sql");

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
fn migrations() -> Vec<Migration> {
    vec![Migration {
        version: 1,
        description: "initial schema",
        sql: MIGRATION_001_INIT,
        kind: MigrationKind::Up,
    }]
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
            connection::pin_sqlite_connection,
            export::allow_export_directory
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
