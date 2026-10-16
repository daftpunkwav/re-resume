//! Pins the application database to a single SQLite connection.
//!
//! `tauri-plugin-sql` opens a `sqlx` pool whose default ceiling is ten
//! connections, and every `execute`/`select` call acquires one of them for the
//! duration of that statement. Two properties this build relies on therefore
//! are not guaranteed by the pool it opens:
//!
//! - A transaction. `BEGIN IMMEDIATE` and `COMMIT` issued as separate calls can
//!   land on different connections, and a `ROLLBACK` then reaches a connection
//!   that never began the transaction.
//! - Foreign keys. `PRAGMA foreign_keys` is connection-local, so setting it once
//!   leaves the rest of the pool with `ON DELETE CASCADE` disabled.
//!
//! Replacing the pool with a one-connection pool settles both: there is only one
//! connection to be on, and the connect option applies `PRAGMA foreign_keys = ON`
//! to it. Retirement is disabled as well, because a pool that replaces its one
//! connection does so between statements, and a transaction is a series of
//! statements. The TypeScript seam keeps a statement mutex on top, so two write
//! transactions still cannot interleave on that single connection.

use sqlx::sqlite::SqlitePoolOptions;
use sqlx::sqlite::SqliteConnectOptions;
use tauri::State;
use tauri_plugin_sql::{DbInstances, DbPool};

/// Swaps the pool registered under `db` for a one-connection pool that turns
/// foreign keys on for every connection it opens.
///
/// `db` is the connection string the frontend passed to `Database.load`; the
/// plugin keys its registry by exactly that string, so a different spelling
/// would name a pool that does not exist.
#[tauri::command]
pub async fn pin_sqlite_connection(
    db_instances: State<'_, DbInstances>,
    db: String,
) -> Result<(), String> {
    let mut instances = db_instances.0.write().await;
    let Some(DbPool::Sqlite(pool)) = instances.get(&db) else {
        return Err(format!("database {db} is not a loaded SQLite database"));
    };
    let options: SqliteConnectOptions = pool.connect_options().as_ref().clone();
    // Retirement is off: the plugin acquires a connection per statement, so a
    // connection closed between BEGIN IMMEDIATE and COMMIT would roll the
    // transaction back on one connection and let the statements that follow run
    // in autocommit on another. The default lifetime (30 min) and idle timeout
    // (10 min) are both long enough to catch a slow application, and neither
    // is observable from here - a database this application opens is opened
    // once per process and closed with it.
    let pinned = SqlitePoolOptions::new()
        .max_connections(1)
        .max_lifetime(None)
        .idle_timeout(None)
        .connect_with(options.foreign_keys(true))
        .await
        .map_err(|error| error.to_string())?;
    instances.insert(db, DbPool::Sqlite(pinned));
    Ok(())
}
