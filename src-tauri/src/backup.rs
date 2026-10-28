//! One-time copy of the database as it stood before the schema rebuild.
//!
//! Responsibilities:
//! - Copy `<app config>/re-resume.db` to `<app config>/re-resume.pre-v2.db` once
//! - Report which of the three outcomes happened: copied, already copied, no
//!   database to copy
//!
//! Contracts:
//! - `backup_database_once` returns a one-word outcome plus the destination
//!   path (`created: …`, `exists: …`) or `no-source` when the database file is
//!   absent. The frontend records the outcome and does not act on it.
//!
//! Constraints:
//! - The source is resolved under `app_config_dir()`: the SQL plugin resolves a
//!   relative `sqlite:` URL against the application configuration directory, so
//!   the copy must read from that same directory rather than from app data,
//!   which only happens to be the same path on some platforms.
//! - The copy happens before the frontend loads the SQL plugin, which is what
//!   runs the migrations; once the plugin has connected, the file it would copy
//!   already holds the rebuilt schema. The frontend calls this command before
//!   the first `Database.load`.
//! - The destination is named here, not by the caller: a path from the webview
//!   would be a write outside the application configuration directory.
//! - An existing destination is never overwritten. It is the copy of the
//!   pre-rebuild state, and a later launch must not replace it with the rebuilt
//!   schema.

use std::path::{Path, PathBuf};

use tauri::Manager;

/// File name of the database the SQL plugin opens, relative to the app config
/// directory. Must match `DATABASE_URL` in `lib.rs`.
const DATABASE_FILE_NAME: &str = "re-resume.db";

/// File name of the preserved pre-rebuild copy.
const BACKUP_FILE_NAME: &str = "re-resume.pre-v2.db";

/// Copies the database file as it is before any migration runs.
///
/// The command runs on the async runtime: the copy is file I/O and the window
/// shows its boot state while the frontend waits for the answer.
#[tauri::command(async)]
pub fn backup_database_once<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Result<String, String> {
    let config_directory = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("cannot resolve the application config directory: {error}"))?;
    copy_once(&config_directory)
}

/// The copy itself, separated from the Tauri handle so the decision logic can
/// be read and tested without a running application.
fn copy_once(config_directory: &Path) -> Result<String, String> {
    let source = config_directory.join(DATABASE_FILE_NAME);
    let destination: PathBuf = config_directory.join(BACKUP_FILE_NAME);

    if destination.exists() {
        return Ok(format!("exists: {}", destination.display()));
    }
    if !source.exists() {
        return Ok("no-source".to_string());
    }
    std::fs::copy(&source, &destination).map_err(|error| {
        format!(
            "cannot copy {} to {}: {error}",
            source.display(),
            destination.display()
        )
    })?;
    Ok(format!("created: {}", destination.display()))
}

#[cfg(test)]
mod tests {
    use super::copy_once;
    use std::fs;

    fn temporary_directory(name: &str) -> std::path::PathBuf {
        let directory = std::env::temp_dir().join(format!("re-resume-backup-{name}"));
        let _ = fs::remove_dir_all(&directory);
        fs::create_dir_all(&directory).expect("temporary directory");
        directory
    }

    #[test]
    fn copies_the_database_when_a_backup_is_absent() {
        let directory = temporary_directory("created");
        fs::write(directory.join("re-resume.db"), b"legacy bytes").expect("write source");

        let outcome = copy_once(&directory).expect("copy succeeds");

        assert!(outcome.starts_with("created: "));
        assert_eq!(
            fs::read(directory.join("re-resume.pre-v2.db")).expect("backup exists"),
            b"legacy bytes"
        );
        fs::remove_dir_all(directory).expect("cleanup");
    }

    #[test]
    fn keeps_an_existing_backup() {
        let directory = temporary_directory("exists");
        fs::write(directory.join("re-resume.db"), b"rebuilt").expect("write source");
        fs::write(directory.join("re-resume.pre-v2.db"), b"original").expect("write backup");

        let outcome = copy_once(&directory).expect("copy succeeds");

        assert!(outcome.starts_with("exists: "));
        assert_eq!(
            fs::read(directory.join("re-resume.pre-v2.db")).expect("backup exists"),
            b"original"
        );
        fs::remove_dir_all(directory).expect("cleanup");
    }

    #[test]
    fn reports_a_missing_database() {
        let directory = temporary_directory("no-source");

        let outcome = copy_once(&directory).expect("no source is not an error");

        assert_eq!(outcome, "no-source");
        fs::remove_dir_all(directory).expect("cleanup");
    }
}
